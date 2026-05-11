"""
Tests for v3.8 — DB audit P0 follow-up (2026-04-30).

The 2026-04-28 audit memo flagged five P0 items:

  (a) `exam_questions` `cs_multi_003` / `cs_multi_008`:
      `max(correct_answers_indices) >= len(options)`.
  (b) `university_details` water-uni triplicate (codes 000 / 000_96 / 529).
  (c) `student_profiles` orphan `target_university_id = 126`.
  (d) `university_data.min_score_paid = 50` sentinel on ~half the rows.
  (e) regression test for (a).

Live-DB recon on 2026-04-30 found:

  - (a) is clean: no current multi-choice row violates the
    in-range invariant (verified across all 100 multi rows). The
    audit was written off an older snapshot or different ingest.
    We still ship the regression test (e) because the invariant is
    universal and a future ingest can re-introduce the bug.
  - (b) the water-university now has exactly one row (id=109,
    code=529). The triplicate has already been cleaned up,
    presumably as part of a prior session-22c cleanup that didn't
    get logged. No-op.
  - (c) zero orphan `target_university_id` rows. No-op.
  - (d) confirmed: 921 of 1,915 rows hold the literal `50`
    sentinel. Fixed at the serializer layer, not in the DB
    (the real fix is a backfill from a source document which
    boss hasn't sourced yet).

Tests below cover the items we actually touched: (d) the mask
behavior and (e) the universal multi-choice regression guard.
The water-uni and orphan-profile guards are pure data invariants
and would require a live DB to test; they're documented in the
v3.8 changelog but not pinned here.
"""

from __future__ import annotations

import inspect

import pytest

# ---------------------------------------------------------------------------
# Item (d) — min_score_paid=50 sentinel mask.
# ---------------------------------------------------------------------------


def test_unmask_paid_score_returns_none_for_sentinel():
    from app.services.university_search import _unmask_paid_score

    assert _unmask_paid_score(50) is None


def test_unmask_paid_score_returns_none_for_none():
    from app.services.university_search import _unmask_paid_score

    assert _unmask_paid_score(None) is None


@pytest.mark.parametrize("value", [0, 1, 49, 51, 65, 90, 140])
def test_unmask_paid_score_returns_real_values(value):
    """Anything that's not the sentinel is preserved verbatim,
    including the unlikely real-50 case (we accept the conservative
    loss documented in the helper's docstring)."""
    from app.services.university_search import _unmask_paid_score

    assert _unmask_paid_score(value) == value


def test_university_search_serializer_uses_unmask():
    """All four `min_score_paid` serializer sites must funnel through
    `_unmask_paid_score`. A regression here would re-leak the
    sentinel into API responses."""
    from app.services import university_search

    src = inspect.getsource(university_search)

    # Every serialized appearance of `min_score_paid` should be the
    # call form, not bare attribute access.
    bad_lines = [
        line.strip()
        for line in src.splitlines()
        if '"min_score_paid"' in line and "_unmask_paid_score" not in line
    ]
    assert not bad_lines, (
        'every "min_score_paid" key in the response payload must be '
        "wrapped in _unmask_paid_score(). Offending lines:\n  " + "\n  ".join(bad_lines)
    )


def test_eligibility_uses_unmasked_threshold_or_none():
    """When `min_score_paid` is the sentinel, `eligible` must be
    None (we don't know), NOT `True` because score >= 50. The
    audit flagged this as the highest-impact downstream
    consequence of the sentinel leak."""
    from app.services import university_search

    # Source-level guard. `data["eligible"] = ...` must reference
    # `_unmask_paid_score` or `unmasked_paid`, not the bare
    # `major.min_score_paid`.
    src = (
        inspect.getsource(university_search.search_majors_by_uni_id)
        if hasattr(university_search, "search_majors_by_uni_id")
        else inspect.getsource(university_search)
    )

    # Find the line where eligibility is computed.
    elig_lines = [line for line in src.splitlines() if 'data["eligible"]' in line]
    assert elig_lines, "expected to find an eligibility computation in university_search"
    # None of them may reference `major.min_score_paid` directly —
    # they must go through the unmasked helper or its result.
    for line in elig_lines:
        assert "major.min_score_paid" not in line, (
            f"eligibility computation must use unmasked value, not raw column: {line.strip()}"
        )


# ---------------------------------------------------------------------------
# Item (e) — universal multi-choice in-range invariant.
# ---------------------------------------------------------------------------


def test_multi_choice_indices_in_range_invariant():
    """Pure-Python invariant that any multiple_choice row must
    satisfy `max(correct_answers_indices) < len(options_ru)`.

    Implemented as a static checker against the project's source
    JSON files under `database/`. CI doesn't have a live DB, but
    these JSONs are the seeds for `exam_questions`, so violating
    the invariant here would re-introduce the audit bug on the
    next reseed."""
    import json
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent.parent
    db_dir = repo_root / "database"
    if not db_dir.is_dir():
        pytest.skip("database/ snapshot not present in this checkout")

    violations: list[str] = []

    for json_path in sorted(db_dir.glob("*.json")):
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        # Files like `universities.json` have no `subjects` key — skip.
        if not isinstance(data, dict) or "subjects" not in data:
            continue

        for subj in data.get("subjects") or []:
            for q in subj.get("questions") or []:
                if q.get("format") != "multiple_choice":
                    continue
                idx = q.get("correct_answers_indices") or []
                opts_ru = q.get("options_ru") or []
                opts_kz = q.get("options_kz") or []
                if not idx:
                    continue
                if max(idx) >= len(opts_ru):
                    violations.append(
                        f"{json_path.name}: source_id={q.get('source_id')} "
                        f"max(idx)={max(idx)} >= len(options_ru)={len(opts_ru)}"
                    )
                if opts_kz and max(idx) >= len(opts_kz):
                    violations.append(
                        f"{json_path.name}: source_id={q.get('source_id')} "
                        f"max(idx)={max(idx)} >= len(options_kz)={len(opts_kz)}"
                    )

    assert not violations, (
        "Multi-choice questions with out-of-range correct_answers_indices. "
        "Audit memo (2026-04-28) item (a). Fix the source JSON before reseeding.\n"
        + "\n".join(violations)
    )
