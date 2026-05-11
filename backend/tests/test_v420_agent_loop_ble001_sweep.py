"""v4.2 (2026-05-05) — agent_loop BLE001 sweep.

Mirror of v3.89's `test_chat_router_passes_ble001_with_inline_rationales`
applied to `app/services/chat/agent_loop.py`. v3.89 explicitly noted
the deferral:

    "The same shape is intended to be applied to
    `app/services/agent_loop.py` in a follow-up; that module is not
    on disk in the agent-harness worktree today, so it's deferred
    (see v4.1 tracking issue)."

The file IS on disk now (under `app/services/chat/agent_loop.py`,
not `app/services/agent_loop.py` as the v3.89 comment guessed).
This test pins the post-sweep shape with the same three lanes:

  1. **Zero-tolerance lint** — no BLE001 may appear without an
     inline `# noqa: BLE001` rationale.
  2. **No silent except-pass** — `except Exception: pass` (body is
     literally a single `Pass`) is forbidden. Annotated `pass` with
     a `# noqa: BLE001 — <reason>` on the except line IS allowed,
     because the rationale documents the deliberate swallow.
  3. **Every `# noqa: BLE001` carries a rationale after a dash.**

agent_loop.py is the chat agent harness. Like chat.py, broad
catches are usually deliberate (don't tank the whole streaming
turn over a malformed citation row), but they must be annotated
so a future contributor can tell intent from oversight.
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path

_AGENT_LOOP_PATH = (
    Path(__file__).resolve().parent.parent / "app" / "services" / "chat" / "agent_loop.py"
)


# ---------------------------------------------------------------------------
# Lane 1: zero-tolerance ruff BLE001 check
# ---------------------------------------------------------------------------


def test_agent_loop_passes_ble001_with_inline_rationales() -> None:
    """ruff must report zero BLE001 in agent_loop.py.

    Every broad catch should have an inline `# noqa: BLE001 — <reason>`.
    New broad catches without an annotation will fail here.
    """
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--select",
            "BLE001",
            "--output-format",
            "concise",
            str(_AGENT_LOOP_PATH),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    diagnostics = [line for line in proc.stdout.splitlines() if "BLE001" in line]
    assert proc.returncode == 0 and not diagnostics, (
        "v4.2 expects zero un-annotated BLE001 in app/services/chat/agent_loop.py. "
        "If this fails, either add `# noqa: BLE001 — <rationale>` to the "
        "new broad catch, or narrow it to a specific exception type.\n\n"
        "ruff diagnostics:\n  " + "\n  ".join(diagnostics)
    )


# ---------------------------------------------------------------------------
# Lane 2: no silent `except Exception: pass` (without noqa)
# ---------------------------------------------------------------------------


def test_agent_loop_has_no_silent_except_pass() -> None:
    """A bare ``except Exception: pass`` swallows errors invisibly.

    Every broad catch must either log, set a fallback, or be marked
    with a ``# noqa: BLE001 — <reason>`` rationale on the except
    line so the deliberate swallow is documented at the site.

    AST-level so the check isn't gameable by a multi-line pass.
    """
    src = _AGENT_LOOP_PATH.read_text(encoding="utf-8")
    src_lines = src.splitlines()
    tree = ast.parse(src)
    silent: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        type_src = ast.unparse(node.type) if node.type else "<bare>"
        if "Exception" not in type_src and type_src != "<bare>":
            continue
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            # The except line itself may carry a `# noqa: BLE001 — <reason>`,
            # which is enough to document the deliberate swallow.
            line_text = src_lines[node.lineno - 1] if node.lineno - 1 < len(src_lines) else ""
            if "noqa: BLE001" in line_text:
                continue
            silent.append(f"line {node.lineno}: except {type_src}: pass")
    assert silent == [], (
        "v4.2: silent broad catches (except Exception: pass) must be gone "
        "from app/services/chat/agent_loop.py — at minimum annotate the "
        "except line with `# noqa: BLE001 — <reason>` so the deliberate "
        "swallow is documented. Found:\n  " + "\n  ".join(silent)
    )


# ---------------------------------------------------------------------------
# Lane 3: every `noqa: BLE001` carries a rationale after a dash
# ---------------------------------------------------------------------------


_NOQA_RE = re.compile(r"#\s*noqa:\s*BLE001(?P<after>.*)$")


def test_every_noqa_ble001_in_agent_loop_has_rationale_after_dash() -> None:
    """Every ``# noqa: BLE001`` line must include a rationale after
    an em-dash (or ``-`` / ``–`` / ``—``).

    A bare ``# noqa: BLE001`` is indistinguishable from forgetting
    to narrow the catch.
    """
    bad_lines: list[str] = []
    for lineno, line in enumerate(
        _AGENT_LOOP_PATH.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        m = _NOQA_RE.search(line)
        if not m:
            continue
        after = m.group("after").strip()
        if not (after.startswith("—") or after.startswith("–") or after.startswith("-")):
            bad_lines.append(f"line {lineno}: {line.strip()}")
            continue
        rationale = after.lstrip("—–- ").strip()
        if not re.search(r"\w", rationale):
            bad_lines.append(f"line {lineno}: {line.strip()}")
    assert bad_lines == [], (
        "v4.2: every `# noqa: BLE001` must include a rationale after "
        "an em-dash. Found bare/empty rationales:\n  " + "\n  ".join(bad_lines)
    )
