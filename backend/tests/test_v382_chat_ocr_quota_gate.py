"""
v3.82 (2026-05-03) — quota gate for POST /api/chat/ocr.

Pre-v3.82 the endpoint accepted unbounded calls to qwen-vl-ocr-latest
(a paid vision model) — a FREE user could submit thousands of
images per day. v3.82 wires the existing ``chat_messages`` daily
quota into ``chat_image_ocr``:

- Quota PRE-CHECK after structural validation (content-type / size /
  empty body) but BEFORE the upstream OCR call.
- Counter incremented AFTER successful OCR (v3.3 charge-after-success
  pattern). Upstream failures do NOT consume budget.
- Classifier failures (blank page / empty OCR) DO consume budget
  because the upstream call ran.

Three lanes pinned:

1. **Static AST shape** on ``app/routers/chat.py:chat_image_ocr``
   — confirms the function signature includes ``db: AsyncSession``,
   the body imports plan_guards, and the quota check appears in
   the function source. Catches anyone who reverts the gate.
2. **Behavioral via TestClient + dependency_overrides** on the
   429 path (counter at limit), the success path (quota
   incremented), the upstream-failure path (quota NOT incremented),
   and the structural-failure path (415 / 413 / 400 short-circuit
   without counter side effects).
3. **Two-lane regression** sanity: the existing pure-helper suite
   in ``test_v312_image_ocr.py`` still covers the helpers; this
   file is purely about the gate.
"""

from __future__ import annotations

import ast
import io
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import SubscriptionTier, UsageCounter, User

# ---------------------------------------------------------------------------
# Lane 1: static AST shape
# ---------------------------------------------------------------------------


_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "chat.py"


def _load_chat_image_ocr_ast() -> ast.AsyncFunctionDef:
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "chat_image_ocr":
            return node
    raise AssertionError("chat_image_ocr not found in app/routers/chat.py")


def test_chat_image_ocr_takes_db_dependency():
    """The function signature must include ``db: AsyncSession = Depends(get_db)``."""
    fn = _load_chat_image_ocr_ast()
    arg_names = [a.arg for a in fn.args.args] + [a.arg for a in fn.args.kwonlyargs]
    assert "db" in arg_names, (
        "chat_image_ocr must take a `db: AsyncSession = Depends(get_db)` "
        "parameter so the v3.82 quota gate can read/write usage counters."
    )


def test_chat_image_ocr_imports_plan_guards():
    """Quota-gate primitives must be imported in the function body."""
    fn = _load_chat_image_ocr_ast()
    src = ast.unparse(fn)
    assert "from ..dependencies.plan_guards import" in src, (
        "chat_image_ocr must import plan_guards primitives "
        "(_get_or_create_counter, PLAN_QUOTAS, _is_premium) for the v3.82 quota gate."
    )
    for name in ("_get_or_create_counter", "PLAN_QUOTAS", "_is_premium"):
        assert name in src, f"chat_image_ocr is missing v3.82 quota-gate primitive `{name}`."


def test_chat_image_ocr_checks_quota_before_upstream_call():
    """
    Body order must be: structural checks → quota check → upstream
    OCR call → quota increment. We pin this by relative substring
    positions in the unparsed source so anyone who shuffles the
    order gets a clear failure.
    """
    fn = _load_chat_image_ocr_ast()
    src = ast.unparse(fn)
    quota_idx = src.find("counter.chat_messages >= limit")
    # Use the actual call site, not the docstring mention. We
    # intentionally don't strip the docstring to keep the AST
    # walk simple — match on the call expression instead.
    upstream_idx = src.find("asyncio.to_thread(ocr_image_bytes")
    # v3.85 (2026-05-03): the inline `counter.chat_messages += 1`
    # was replaced with `_atomic_charge_counter(...)`. Match on
    # the call expression now.
    increment_idx = src.find("_atomic_charge_counter(")

    assert quota_idx > 0, "v3.82 quota guard not found in chat_image_ocr"
    assert upstream_idx > 0, "ocr_image_bytes call not found in chat_image_ocr"
    assert increment_idx > 0, "v3.82 counter increment not found in chat_image_ocr"

    assert quota_idx < upstream_idx, (
        "v3.82 quota check MUST run before the upstream OCR call. "
        "Otherwise a user at the cap burns a paid vision call."
    )
    assert upstream_idx < increment_idx, (
        "v3.82 counter increment MUST run AFTER the upstream OCR call. "
        "Otherwise upstream failures consume the user's daily budget."
    )


def test_chat_image_ocr_increment_lives_outside_except_branch():
    """
    The increment must be on the success path, not inside the
    upstream try/except. If anyone moves it inside the except: arm
    they'd be charging users for failures (the inverse of v3.3).
    """
    # v3.85: the increment is now an Await Call to
    # _atomic_charge_counter (not an AugAssign). Walk the AST and
    # confirm none of the call sites is inside an ExceptHandler.
    fn = _load_chat_image_ocr_ast()
    found_outside = False
    for handler in ast.walk(fn):
        if isinstance(handler, ast.ExceptHandler):
            for node in ast.walk(handler):
                if isinstance(node, ast.Call):
                    callee = ast.unparse(node.func)
                    if "_atomic_charge_counter" in callee:
                        pytest.fail(
                            "v3.82/v3.85: charge call inside an except handler "
                            "would charge users for upstream OCR failures."
                        )
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            callee = ast.unparse(node.func)
            if "_atomic_charge_counter" in callee:
                found_outside = True
                break
    assert found_outside, "v3.82/v3.85 charge call not detected in chat_image_ocr"


# ---------------------------------------------------------------------------
# Lane 2: behavioral via TestClient + dependency_overrides
# ---------------------------------------------------------------------------


def _mk_user(*, premium: bool = False) -> User:
    """Minimal in-memory User. Avoids the real fixture's DB roundtrip."""
    u = User(
        id=42,
        email="t@x.test",
        name="OCR Tester",
        subscription_tier=(SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE),
    )
    return u


def _mk_counter(chat_messages: int) -> UsageCounter:
    return UsageCounter(
        user_id=42,
        date=date.today(),
        chat_messages=chat_messages,
    )


def _mk_db_stub(counter: UsageCounter):
    """
    AsyncSession stub. There are two execute() shapes hit by the
    OCR success path:

      1. SELECT inside _get_or_create_counter →
         result.scalar_one_or_none() → existing UsageCounter row.
      2. v3.85 atomic UPDATE inside _atomic_charge_counter →
         result.scalar_one_or_none() → post-increment integer.

    A naive ``return_value`` mock collapses both into the
    counter-object reply, which trips ``int(new_value)`` inside
    the helper. Use ``side_effect`` with an unbounded SELECT
    repeater + an UPDATE responder that mirrors the in-memory
    counter increment.
    """
    db = AsyncMock()

    def _make_select_result():
        m = MagicMock()
        m.scalar_one_or_none = MagicMock(return_value=counter)
        return m

    def _on_execute(stmt, *_, **__):
        # Compile-string sniff is fine here: the v3.85 charge stmt
        # is the only UPDATE on usage_counters in this code path.
        try:
            compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
        except Exception:
            compiled = ""
        if "UPDATE" in compiled.upper() and "usage_counters" in compiled.lower():
            counter.chat_messages += 1
            upd = MagicMock()
            upd.scalar_one_or_none = MagicMock(return_value=counter.chat_messages)
            return upd
        return _make_select_result()

    db.execute = AsyncMock(side_effect=_on_execute)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _client_with(db, user):
    async def _get_db():
        yield db

    from app.database import get_db
    from app.routers.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = _get_db
    return TestClient(app)


def _cleanup():
    app.dependency_overrides.clear()


# 1×1 PNG in memory. Just enough to pass content-type + size checks.
_PNG_1X1 = bytes.fromhex(
    "89504E470D0A1A0A"
    "0000000D49484452"
    "00000001000000010806000000"
    "1F15C4890000000A4944415478DA63"
    "0000000050000180000000004A45"
    "454E44AE426082"
)


def test_v382_free_user_at_quota_returns_429_without_calling_ocr():
    """At-cap FREE user must get 429 BEFORE the upstream OCR runs."""
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=20)  # FREE limit = 20

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        with patch(
            "app.services.qwen_dashscope.ocr_image_bytes",
            new=MagicMock(return_value="should not run"),
        ) as ocr_mock:
            r = c.post(
                "/api/chat/ocr",
                files={"image": ("a.png", io.BytesIO(_PNG_1X1), "image/png")},
            )
            assert ocr_mock.call_count == 0, (
                "v3.82: at-cap user reached the upstream OCR call — "
                "quota gate did not short-circuit."
            )
    finally:
        _cleanup()

    assert r.status_code == 429
    body = r.json()
    assert body["detail"]["error"] == "quota_exceeded"
    assert body["detail"]["resource"] == "chat_messages"
    assert body["detail"]["limit"] == 20
    assert body["detail"]["used"] == 20
    assert body["detail"]["plan"] == "FREE"
    # Counter was NOT incremented for the refused request.
    assert counter.chat_messages == 20


def test_v382_premium_user_at_free_limit_is_NOT_429():
    """
    A premium user with 20 chat_messages already used MUST NOT get
    429 — premium limit is 200, not 20. Pre-v3.82 this case never
    existed because the gate didn't exist; pinning so a future
    refactor doesn't accidentally use the wrong limit.
    """
    user = _mk_user(premium=True)
    counter = _mk_counter(chat_messages=20)

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        with patch(
            "app.services.qwen_dashscope.ocr_image_bytes",
            new=MagicMock(return_value="Page 12 — Newton's third law."),
        ) as ocr_mock:
            r = c.post(
                "/api/chat/ocr",
                files={"image": ("a.png", io.BytesIO(_PNG_1X1), "image/png")},
            )
            assert ocr_mock.call_count == 1
    finally:
        _cleanup()

    assert r.status_code == 200
    # Premium successful call: counter should now be 21.
    assert counter.chat_messages == 21


def test_v382_success_path_increments_counter_after_ocr():
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=5)  # well under the FREE 20 cap

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        with patch(
            "app.services.qwen_dashscope.ocr_image_bytes",
            new=MagicMock(return_value="Newton's third law states..."),
        ):
            r = c.post(
                "/api/chat/ocr",
                files={"image": ("a.png", io.BytesIO(_PNG_1X1), "image/png")},
            )
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    assert body["transcribed"].startswith("Newton")
    assert counter.chat_messages == 6, "v3.82 counter must increment on success"


def test_v382_upstream_failure_does_NOT_charge_quota():
    """
    Upstream OCR failure surfaces as 502 AND does not consume the
    user's daily budget. Mirrors v3.3 charge-after-success pattern.
    """
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=5)

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        with patch(
            "app.services.qwen_dashscope.ocr_image_bytes",
            new=MagicMock(side_effect=RuntimeError("upstream blew up")),
        ):
            r = c.post(
                "/api/chat/ocr",
                files={"image": ("a.png", io.BytesIO(_PNG_1X1), "image/png")},
            )
    finally:
        _cleanup()

    assert r.status_code == 502
    # Counter unchanged.
    assert counter.chat_messages == 5, (
        "v3.82: upstream OCR failure must NOT consume the user's daily quota."
    )


def test_v382_structural_failure_short_circuits_without_counter_touch():
    """
    A bad content-type returns 415 before the quota gate even
    reads the counter — the SELECT must not run, the counter must
    not increment.
    """
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=5)

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/chat/ocr",
            files={"image": ("a.gif", io.BytesIO(_PNG_1X1), "image/gif")},
        )
    finally:
        _cleanup()

    assert r.status_code == 415
    # No DB touch, no increment.
    db.execute.assert_not_called()
    assert counter.chat_messages == 5


def test_v382_empty_body_short_circuits_without_counter_touch():
    """
    An empty upload is rejected with 400 BEFORE the quota gate.
    Mirrors the structural-failure short-circuit.
    """
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=5)

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        r = c.post(
            "/api/chat/ocr",
            files={"image": ("a.png", io.BytesIO(b""), "image/png")},
        )
    finally:
        _cleanup()

    assert r.status_code == 400
    db.execute.assert_not_called()
    assert counter.chat_messages == 5


def test_v382_classifier_failure_DOES_charge_quota():
    """
    When OCR succeeds but returns blank-page-classified text, the
    upstream model call DID run — same convention as the WS path,
    a model that returned an empty string still counted.
    """
    user = _mk_user(premium=False)
    counter = _mk_counter(chat_messages=5)

    db = _mk_db_stub(counter)
    c = _client_with(db, user)
    try:
        # Trigger classifier "blank" path by returning empty string.
        with patch(
            "app.services.qwen_dashscope.ocr_image_bytes",
            new=MagicMock(return_value=""),
        ):
            r = c.post(
                "/api/chat/ocr",
                files={"image": ("a.png", io.BytesIO(_PNG_1X1), "image/png")},
            )
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    # Classifier-driven failure: classification is set, error_message
    # populated, but the call counted.
    assert body["classification"] != "ok"
    assert counter.chat_messages == 6
