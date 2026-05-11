"""v3.42 (2026-05-01) — block partial-AC auto-close keywords in
commit messages and PR titles.

## Why this script exists

On 2026-05-01 a v3.35 ship used ``Closes #44`` in the squash subject
even though it only addressed AC1-AC3 of issue #44. GitHub
auto-closed the issue, and we had to retro-reopen it. The lesson
was banked in ``feedback_partial_ac_no_close_keyword.md``: when a
PR addresses *part* of an issue's acceptance criteria, the commit
subject must say ``Refs #N`` (or be silent) — never
``Closes/Fixes/Resolves #N AC...``.

This script is the belt-and-braces enforcer. It scans a commit
message and flags any ``Closes/Fixes/Resolves #N`` reference that
appears near the token ``AC`` (case-insensitive, with or without a
trailing digit). The husky ``commit-msg`` hook calls it with the
path to the commit message file as ``$1``. Exit 0 on clean, 1 on
match (with a friendly explanation pointing at the memory).

## What this script does (and doesn't do)

- **Pure stdin/file parsing.** No DB, no httpx, no GitHub API.
- **Conservative matcher**: only flags ``Closes|Fixes|Resolves``
  followed by ``#<digits>`` and then ``AC`` within ~30 chars on
  the SAME line. ``Closes #44`` alone is NOT flagged — that's a
  full-issue close and is sometimes correct.
- **Case-insensitive**: ``CLOSES`` / ``Fixes`` / ``RESOLVES`` all
  hit. ``ac1`` / ``AC1`` / ``AC #5`` all hit.
- **One-line scope**: the keyword and the AC token must be on the
  same line. A `Closes #N` on one line and a `(also AC5)` on
  another line stays clean — that's a structurally different
  thing.
- **Comment-line aware**: lines starting with ``#`` are GitHub
  comment markers in commit-msg buffers and are skipped, so the
  scissors-line + commented diff doesn't false-positive.
- **No fancy normalization**: no Cyrillic, no project convention (mojibake)
  trap to worry about — we only match ASCII tokens.

## What this script does NOT do

- Does not validate that the issue actually exists.
- Does not check PR titles directly (that's a separate CI step,
  out of scope for this commit-msg hook).
- Does not auto-rewrite the commit message. It just blocks.

## Usage

    # commit-msg hook (called by git):
    python backend/scripts/check_partial_ac_keyword.py .git/COMMIT_EDITMSG

    # ad-hoc / pipeline:
    cat msg.txt | python backend/scripts/check_partial_ac_keyword.py -

## Exit codes

- 0: clean — no partial-AC close keyword found.
- 1: match found — message printed to stderr, commit blocked.
- 2: file unreadable.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Distance (in characters) within which an "AC" token after the
# issue ref still counts as "the same partial-AC pattern". 30 is
# wide enough to catch ``Closes #44 AC5`` and
# ``Closes #44, AC1 + AC2`` but tight enough that
# ``Closes #44. Unrelated paragraph mentions ACL.`` doesn't fire.
_LOOKAHEAD_CHARS = 30

# Issue-ref + close-keyword regex. Captures the keyword and the
# numeric issue id; the AC scan is done in a follow-up window.
_CLOSE_KEYWORD_RE = re.compile(
    r"\b(?P<kw>close[ds]?|fix(?:e[ds])?|resolve[ds]?)\s+#(?P<num>\d+)",
    re.IGNORECASE,
)

# AC token regex. Matches "AC", "AC1", "AC #5", "AC: foo", but not
# words that merely contain the letters "ac" like "facade",
# "acceptance", "ACL". The non-letter look-around guards the left
# side; the right side requires either a digit (AC1 / AC5) or a
# non-letter follow (so AC followed by space / # / colon / EOL hits
# but ACL / ACfoo doesn't).
_AC_TOKEN_RE = re.compile(
    r"(?:^|[^a-zA-Z])AC(?:\d|[^a-zA-Z\d]|$)",
    re.IGNORECASE,
)


def find_violations(message: str) -> list[dict[str, object]]:
    """Return a list of violation dicts. Empty list = clean.

    Each dict has ``line``, ``keyword``, ``issue``, and ``snippet``.
    """
    violations: list[dict[str, object]] = []
    for line_no, raw_line in enumerate(message.splitlines(), start=1):
        # Skip commit-msg comment lines (git scissors / template
        # text). Only ``# `` at the very start counts; markdown
        # headings inside an issue title don't appear at column 0
        # in a commit-msg buffer.
        if raw_line.lstrip().startswith("#") and not raw_line.lstrip().startswith(
            "#" + "0123456789"
        ):
            # Could still be ``#123 ...`` (rare) — only skip pure
            # comment lines, those starting with "# " or just "#".
            stripped = raw_line.lstrip()
            if stripped == "#" or stripped.startswith("# "):
                continue

        for kw_match in _CLOSE_KEYWORD_RE.finditer(raw_line):
            tail = raw_line[kw_match.end() : kw_match.end() + _LOOKAHEAD_CHARS]
            if _AC_TOKEN_RE.search(tail):
                violations.append(
                    {
                        "line": line_no,
                        "keyword": kw_match.group("kw"),
                        "issue": kw_match.group("num"),
                        "snippet": raw_line.strip()[:120],
                    }
                )
    return violations


# ---------- formatters -----------------------------------------------


def format_violation_report(violations: list[dict[str, object]]) -> str:
    """Multi-line stderr report. ASCII-only."""
    lines: list[str] = []
    lines.append("[commit-msg] BLOCKED: partial-AC close keyword detected.")
    lines.append("")
    for v in violations:
        lines.append(
            f"  line {v['line']}: '{v['keyword']} #{v['issue']}' followed by"
            f" an AC token within {_LOOKAHEAD_CHARS} chars"
        )
        lines.append(f"    > {v['snippet']}")
    lines.append("")
    lines.append("Why: 'Closes/Fixes/Resolves #N' auto-closes the GitHub")
    lines.append("issue when the PR is squashed. If your PR only addresses")
    lines.append("PART of issue #N's acceptance criteria, use 'Refs #N'")
    lines.append("instead so the issue stays open for the remaining ACs.")
    lines.append("")
    lines.append("Lesson banked in feedback_partial_ac_no_close_keyword.md after")
    lines.append("v3.35 prematurely closed issue #44.")
    lines.append("")
    lines.append("To fix: edit the commit message to use 'Refs #N' (or")
    lines.append("'Refs #N ACx') instead of the auto-close keyword. If")
    lines.append("your PR really does close the entire issue, reword to")
    lines.append("avoid the trailing AC token (e.g. 'Closes #N. (covers")
    lines.append("AC1-AC5.)' on a separate sentence).")
    return "\n".join(lines)


# ---------- CLI ------------------------------------------------------


def _read_input(path_arg: str) -> str:
    """Read commit message from a path or '-' (stdin)."""
    if path_arg == "-":
        return sys.stdin.read()
    p = Path(path_arg)
    if not p.is_file():
        raise FileNotFoundError(f"commit-msg file not found: {path_arg}")
    return p.read_text(encoding="utf-8", errors="replace")


def main_cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Block partial-AC auto-close keywords ('Closes/Fixes/"
            "Resolves #N AC...') in commit messages. Husky commit-msg "
            "hook entrypoint."
        )
    )
    ap.add_argument(
        "input",
        help="Path to commit-msg file (git supplies $1), or '-' for stdin.",
    )
    args = ap.parse_args(argv)

    try:
        message = _read_input(args.input)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    violations = find_violations(message)
    if not violations:
        return 0
    print(format_violation_report(violations), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main_cli())
