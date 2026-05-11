"""v3.41 (2026-05-01) — shadow runner for the v3.40 month-name parser.

## Why this script exists

v3.40 added a pure RU/KZ/EN month-name date parser at
``app/services/testcenter_kz_date_parser.py`` and wired it into
``fetch_testing_kz_sessions`` behind ``TESTCENTER_KZ_MONTH_PARSER=1``.
The flag is OFF in production until we have evidence that the
parser would have produced sensible dates against real testcenter.kz
bodies — flipping it blind is exactly the kind of silent-regression
risk that bit us in v3.28 (FE/BE param mismatch caught three days
late by QA).

This script is the **shadow runner** that closes that gap. It takes
a captured testcenter.kz body (HTML or text), runs the v3.40 parser
against it, and prints a structured report. It does NOT touch
production code paths and is read-only end-to-end.

## What this script does (and doesn't do)

- **Read-only.** No HTTP fetch (boss can curl + redirect). No DB.
  No mutation. No retake-guide cache touch.
- **Deterministic.** Same body → same report. Useful for diffing
  against new captures over time.
- **Report shape**: matched ISO dates, dominant language, raw match
  count (pre-validation), and a small sample of context windows
  showing the 30 chars before + 30 chars after each matched
  day-month-year span. The context windows are the
  highest-signal artifact for a human review — "did the parser
  pick this date out of a sentence that actually means a sitting
  date, or out of a 2024 archive footer?".
- **Two output modes**: human (default) and JSON
  (``--json``). JSON is pure stdout, suitable for piping into
  ``jq`` or saving as a fixture.
- **Exit code**: 0 on any successful parse run (even zero dates,
  which is itself a useful signal). 1 only when the input file
  is unreadable. 2 when ``--require-dates`` is set and zero dates
  are matched.

## What this script does NOT do

- Does not fetch testcenter.kz directly. The capture step is a
  separate manual ``curl > body.html`` so we keep network access
  out of the test loop. Adds reproducibility and avoids surprising
  ToS implications.
- Does not flip ``TESTCENTER_KZ_MONTH_PARSER`` for you. That stays
  a deliberate prod operator action.
- Does not mutate ``_FETCH_STATS``. Reads through the parser API,
  not the fetcher.

## Usage

    # human-readable report
    python backend/scripts/check_month_parser.py path/to/body.html

    # JSON report for diffs / fixtures
    python backend/scripts/check_month_parser.py path/to/body.html --json

    # smoke test on stdin
    cat body.html | python backend/scripts/check_month_parser.py -

    # CI gate (exit 2 if no dates parsed)
    python backend/scripts/check_month_parser.py body.html --require-dates
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make the script runnable from repo root without setting PYTHONPATH:
#   python backend/scripts/check_month_parser.py ...
# The same bootstrap pattern is used by db_audit_recheck.py.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.testcenter_kz_date_parser import (  # noqa: E402
    _EN_RE,
    _KZ_RE,
    _RU_RE,
    _YEAR_LOOKAHEAD,
    ParsedDates,
    parse_testcenter_kz_dates,
)

# ---------- context-window extraction --------------------------------


_CONTEXT_RADIUS = 30


def _extract_context_windows(body: str, limit: int = 12) -> list[dict[str, str]]:
    """Return up to ``limit`` ``(lang, snippet)`` rows showing the
    text around each parser match. Pure read-only — uses the same
    pre-compiled regexes the parser uses.

    The snippet shape is ``"<<< 30 chars before | day-month-year |
    30 chars after >>>"``. Newlines are flattened to single spaces
    so the report stays one-line-per-match.
    """
    lower = body.lower()
    windows: list[dict[str, str]] = []
    for lang, regex in (("ru", _RU_RE), ("kz", _KZ_RE), ("en", _EN_RE)):
        for m in regex.finditer(lower):
            # Find the first year token within lookahead; if none,
            # the parser would have dropped this match. Show the
            # window anyway with year="(none)" — it's a useful debug
            # signal.
            tail = lower[m.end() : m.end() + _YEAR_LOOKAHEAD]
            year_label = "(none in lookahead)"
            for token in tail.split():
                if token.isdigit() and len(token) == 4:
                    year_label = token
                    break
            start = max(0, m.start() - _CONTEXT_RADIUS)
            end = min(len(body), m.end() + _CONTEXT_RADIUS)
            before = body[start : m.start()].replace("\n", " ").strip()
            span = body[m.start() : m.end()].replace("\n", " ").strip()
            after = body[m.end() : end].replace("\n", " ").strip()
            windows.append(
                {
                    "lang": lang,
                    "year": year_label,
                    "snippet": f"...{before} >>>{span}<<< {after}...",
                }
            )
            if len(windows) >= limit:
                return windows
    return windows


# ---------- report shape ---------------------------------------------


def build_report(body: str) -> dict[str, object]:
    """Pure builder — returns a dict suitable for JSON dump."""
    parsed: ParsedDates = parse_testcenter_kz_dates(body)
    return {
        "body_chars": len(body),
        "iso_dates": parsed.iso_dates,
        "iso_date_count": len(parsed.iso_dates),
        "dominant_lang": parsed.lang,
        "raw_match_count": parsed.raw_count,
        "context_windows": _extract_context_windows(body),
    }


# ---------- formatters -----------------------------------------------


def format_report_human(report: dict[str, object]) -> str:
    """ASCII-only multi-line report. Honors project convention
    Windows-mojibake rule: no Cyrillic in stdout."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("v3.40 month-name parser shadow report")
    lines.append("=" * 60)
    lines.append(f"body chars        : {report['body_chars']}")
    lines.append(f"iso dates matched : {report['iso_date_count']}")
    lines.append(f"raw match count   : {report['raw_match_count']}")
    lines.append(f"dominant language : {report['dominant_lang'] or '(none)'}")
    lines.append("")
    iso_dates = report["iso_dates"]
    if isinstance(iso_dates, list) and iso_dates:
        lines.append("Matched ISO dates (sorted):")
        for d in iso_dates:
            lines.append(f"  - {d}")
    else:
        lines.append("No ISO dates matched.")
    lines.append("")
    windows = report["context_windows"]
    if isinstance(windows, list) and windows:
        lines.append(f"Context windows ({len(windows)} shown, max 12):")
        for w in windows:
            # Escape non-ASCII so Windows cp1251 stdout doesn't choke.
            safe_snippet = str(w.get("snippet", "")).encode("ascii", "replace").decode("ascii")
            lines.append(f"  [{w.get('lang')}] year={w.get('year')}  {safe_snippet}")
    else:
        lines.append("No context windows (no parser matches).")
    lines.append("=" * 60)
    return "\n".join(lines)


# ---------- CLI ------------------------------------------------------


def _read_input(path_arg: str) -> str:
    """Read body from a path or '-' (stdin)."""
    if path_arg == "-":
        return sys.stdin.read()
    p = Path(path_arg)
    if not p.is_file():
        raise FileNotFoundError(f"input file not found: {path_arg}")
    return p.read_text(encoding="utf-8", errors="replace")


def main_cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Shadow runner for the v3.40 testcenter.kz month-name parser. "
            "Reads a captured body from a file (or stdin via '-') and prints "
            "what the parser would extract. Read-only."
        )
    )
    ap.add_argument(
        "input",
        help="Path to a captured HTML/text body, or '-' for stdin.",
    )
    ap.add_argument(
        "--json",
        action="store_true",
        help="Emit a JSON report on stdout instead of the human report.",
    )
    ap.add_argument(
        "--require-dates",
        action="store_true",
        help=(
            "Exit 2 if zero ISO dates are matched. Useful as a CI gate "
            "before flipping TESTCENTER_KZ_MONTH_PARSER in prod."
        ),
    )
    args = ap.parse_args(argv)

    try:
        body = _read_input(args.input)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    report = build_report(body)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_report_human(report))

    if args.require_dates and not report["iso_date_count"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main_cli())
