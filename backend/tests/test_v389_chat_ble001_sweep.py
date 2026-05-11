"""
v3.89 (2026-05-04) — chat hot-path BLE001 sweep.

`app/routers/chat.py` had 20 `except Exception:` / `except Exception
as e:` sites flagged BLE001 by ruff. Most are intentional broad
catches: this is the highest-traffic surface in the product and a
single uncaught exception will tank an entire chat turn. The fix
isn't to narrow them blindly — most need to remain broad to keep
the chat turn alive — it's to:

1. **Annotate every broad catch** with `# noqa: BLE001 — <reason>`,
   so a future contributor can tell a deliberate broad catch from
   one someone forgot to narrow. This is the same pattern the
   global lint config asks for.
2. **Bind the exception** (`except Exception as exc:`) wherever the
   handler can usefully surface it via logger, even at DEBUG. Pure
   `except Exception: pass` is forbidden — we want at least a debug
   line so silent failures are observable in dev.
3. **Chain with `from`** in error-handler blocks that re-raise
   HTTPException, so the real cause is still visible in tracebacks.

This test pins the post-sweep shape with three lanes:

1. **Zero-tolerance lint** — no BLE001 may appear in `chat.py`
   without an inline `# noqa: BLE001` rationale. ruff is run as a
   subprocess on just the file; if it returns any diagnostic, we
   fail with the diagnostic text.
2. **No silent except-pass** — `except Exception: pass` (with no
   logger / no comment / no re-raise) is gone from `chat.py`.
3. **Every BLE001 noqa carries a rationale** — every line that
   carries `noqa: BLE001` must also include an em-dash explanation
   so the rationale is visible at the call site, not just in this
   test.

The same shape is intended to be applied to `app/services/agent_loop.py`
in a follow-up; that module is not on disk in the agent-harness
worktree today, so it's deferred (see v4.1 tracking issue).
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path

_ROUTER_PATH = Path(__file__).resolve().parent.parent / "app" / "routers" / "chat.py"


# ---------------------------------------------------------------------------
# Lane 1: zero-tolerance ruff BLE001 check on chat.py
# ---------------------------------------------------------------------------


def test_chat_router_passes_ble001_with_inline_rationales():
    """
    v3.89: ruff must report zero BLE001 in app/routers/chat.py.
    Every broad catch should have an inline `# noqa: BLE001` with
    rationale. New broad catches without an annotation will fail
    here.
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
            str(_ROUTER_PATH),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    diagnostics = [line for line in proc.stdout.splitlines() if "BLE001" in line]
    assert proc.returncode == 0 and not diagnostics, (
        "v3.89 expects zero un-annotated BLE001 in app/routers/chat.py. "
        "If this fails, either add `# noqa: BLE001 — <rationale>` to the "
        "new broad catch, or narrow it to a specific exception type.\n\n"
        "ruff diagnostics:\n  " + "\n  ".join(diagnostics)
    )


# ---------------------------------------------------------------------------
# Lane 2: no silent `except Exception: pass`
# ---------------------------------------------------------------------------


def test_chat_router_has_no_silent_except_pass():
    """
    v3.89: a bare `except Exception:` whose body is just `pass`
    swallows errors invisibly. Every broad catch now must either
    log (DEBUG/INFO/WARNING/EXCEPTION), set a fallback value, or
    re-raise — never just `pass`. This is enforced at the AST
    level so the shape isn't gameable by a multi-line `pass`.
    """
    src = _ROUTER_PATH.read_text(encoding="utf-8")
    tree = ast.parse(src)
    silent: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        # We only care about broad catches (Exception or bare).
        type_src = ast.unparse(node.type) if node.type else "<bare>"
        if "Exception" not in type_src and type_src != "<bare>":
            continue
        # Body of length 1 that is exactly `pass` -> silent.
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            silent.append(f"line {node.lineno}: except {type_src}: pass")
    assert silent == [], (
        "v3.89: silent broad catches (except Exception: pass) must be gone "
        "from app/routers/chat.py — at minimum log at DEBUG so the "
        "regression is observable. Found:\n  " + "\n  ".join(silent)
    )


# ---------------------------------------------------------------------------
# Lane 3: every `noqa: BLE001` carries a rationale
# ---------------------------------------------------------------------------


_NOQA_RE = re.compile(r"#\s*noqa:\s*BLE001(?P<after>.*)$")


def test_every_noqa_ble001_has_rationale_after_dash():
    """
    v3.89: every `# noqa: BLE001` line must include a rationale
    after an em-dash (or `- ` / `— `). A bare `# noqa: BLE001` is
    indistinguishable from forgetting to narrow the catch.
    """
    bad_lines: list[str] = []
    for lineno, line in enumerate(
        _ROUTER_PATH.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        m = _NOQA_RE.search(line)
        if not m:
            continue
        after = m.group("after").strip()
        # Accept em-dash, en-dash, or " - " as the separator.
        if not (after.startswith("—") or after.startswith("–") or after.startswith("-")):
            bad_lines.append(f"line {lineno}: {line.strip()}")
            continue
        # And require at least one alphanumeric word after the dash.
        rationale = after.lstrip("—–- ").strip()
        if not re.search(r"\w", rationale):
            bad_lines.append(f"line {lineno}: {line.strip()}")
    assert bad_lines == [], (
        "v3.89: every `# noqa: BLE001` must include a rationale after "
        "an em-dash. Found bare/empty rationales:\n  " + "\n  ".join(bad_lines)
    )
