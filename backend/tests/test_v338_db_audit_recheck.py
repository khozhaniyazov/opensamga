"""v3.38 (2026-05-01) — pin the JSON-backed P0 checks and the
emitters in ``backend/scripts/db_audit_recheck.py``.

DB-backed checks (#2 #3 #4) are not exercised here — they require
a live Postgres and the script already reports them as SKIPPED on
DB error. The pure helpers below cover every JSON branch + every
emitter branch + the overall-verdict rule + the CLI's exit-code
contract.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make ``backend/`` importable so the script's ``from app...`` path
# logic doesn't blow up when pytest collects this file.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import lazily-namespaced so we exercise the public surface only.
from scripts.db_audit_recheck import (  # noqa: E402
    FAIL,
    PASS,
    SKIPPED,
    CheckResult,
    check_cs_multi_indices,
    find_question_by_id,
    main_cli,
    overall_verdict,
    render_json,
    render_text,
    run_json_checks,
)

# ---------- find_question_by_id contract -----------------------------


def test_find_question_by_id_in_subjects_shape() -> None:
    payload = {
        "subjects": [
            {
                "questions": [
                    {"question_id": "q1"},
                    {"question_id": "q2"},
                ]
            }
        ]
    }
    assert find_question_by_id(payload, "q2") == {"question_id": "q2"}


def test_find_question_by_id_in_flat_questions_shape() -> None:
    payload = {"questions": [{"question_id": "qx"}, {"question_id": "qy"}]}
    assert find_question_by_id(payload, "qy") == {"question_id": "qy"}


def test_find_question_by_id_returns_none_when_missing() -> None:
    assert find_question_by_id({"subjects": []}, "nope") is None
    assert find_question_by_id({}, "nope") is None


# ---------- check_cs_multi_indices contract --------------------------


def _q(qid: str, opts_n: int, indices: list[int]) -> dict:
    return {
        "question_id": qid,
        "options_ru": [f"r{i}" for i in range(opts_n)],
        "options_kz": [f"k{i}" for i in range(opts_n)],
        "correct_answers_indices": indices,
    }


def _payload(*questions) -> dict:
    return {"subjects": [{"questions": list(questions)}]}


def test_cs_multi_in_range_passes() -> None:
    payload = _payload(_q("cs_multi_003", 6, [0, 1, 2, 3]))
    r = check_cs_multi_indices(payload, "cs_multi_003")
    assert r.verdict == PASS
    assert r.details["max_index"] == 3
    assert r.details["options_ru"] == 6


def test_cs_multi_out_of_range_fails() -> None:
    # Original audit shape: 4 options + indices=[0,1,2,3,4] → idx 4 OOR
    payload = _payload(_q("cs_multi_003", 4, [0, 1, 2, 3, 4]))
    r = check_cs_multi_indices(payload, "cs_multi_003")
    assert r.verdict == FAIL
    assert "still holds" in r.summary
    assert r.details["max_index"] == 4


def test_cs_multi_missing_question_skipped() -> None:
    payload = _payload(_q("cs_multi_001", 4, [0, 1]))
    r = check_cs_multi_indices(payload, "cs_multi_999")
    assert r.verdict == SKIPPED
    assert "not found" in r.summary


def test_cs_multi_empty_indices_fails() -> None:
    payload = _payload(_q("cs_multi_003", 4, []))
    r = check_cs_multi_indices(payload, "cs_multi_003")
    assert r.verdict == FAIL
    assert "empty" in r.summary


def test_cs_multi_uses_smallest_options_count_per_language() -> None:
    # If RU has 4 options but KZ only has 3, max_index=3 is OOR for KZ.
    q = {
        "question_id": "cs_multi_003",
        "options_ru": ["a", "b", "c", "d"],
        "options_kz": ["a", "b", "c"],
        "correct_answers_indices": [0, 1, 2, 3],
    }
    payload = _payload(q)
    r = check_cs_multi_indices(payload, "cs_multi_003")
    assert r.verdict == FAIL


# ---------- run_json_checks against the real file --------------------


def test_run_json_checks_against_real_informatika_file() -> None:
    """Both audit-flagged questions should now PASS — verified
    manually on 2026-05-01 (cs_multi_003 has 6 options, indices
    [0,1,2,3]; cs_multi_008 has 6 options, indices [0,1,2])."""
    results = run_json_checks()
    assert len(results) == 2
    assert {r.name for r in results} == {
        "cs_multi:cs_multi_003:indices_in_range",
        "cs_multi:cs_multi_008:indices_in_range",
    }
    for r in results:
        assert r.verdict == PASS, f"{r.name} regressed: {r.summary}"


# ---------- emitters -------------------------------------------------


def test_render_text_includes_overall_verdict_and_check_names() -> None:
    results = [
        CheckResult(name="alpha", verdict=PASS, summary="all good"),
        CheckResult(name="beta", verdict=FAIL, summary="bad"),
    ]
    out = render_text(results)
    assert "alpha" in out and "beta" in out
    assert "OVERALL: FAIL" in out
    # Banner present
    assert "db_audit_recheck" in out


def test_render_json_round_trips_and_carries_overall() -> None:
    results = [CheckResult(name="alpha", verdict=PASS, summary="ok", details={"x": 1})]
    out = json.loads(render_json(results))
    assert out["overall"] == PASS
    assert out["results"][0]["details"] == {"x": 1}


def test_overall_verdict_fail_dominates_skipped_and_pass() -> None:
    assert overall_verdict([CheckResult("a", PASS, ""), CheckResult("b", SKIPPED, "")]) == PASS
    assert (
        overall_verdict(
            [CheckResult("a", PASS, ""), CheckResult("b", FAIL, ""), CheckResult("c", SKIPPED, "")]
        )
        == FAIL
    )


def test_overall_verdict_all_skipped_is_pass() -> None:
    # SKIPPED alone is not actionable — should not flip the script red.
    assert overall_verdict([CheckResult("a", SKIPPED, "")]) == PASS


# ---------- CLI exit-code contract -----------------------------------


def test_main_cli_no_db_offline_run_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    """``--no-db`` skips the DB-backed checks entirely. The two real
    JSON checks pass, so the CLI must exit zero."""
    rc = main_cli(["--no-db"])
    captured = capsys.readouterr()
    assert rc == 0
    assert "db_audit_recheck" in captured.out
    assert "OVERALL: PASS" in captured.out


def test_main_cli_no_db_json_emits_parseable(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main_cli(["--no-db", "--json"])
    captured = capsys.readouterr()
    assert rc == 0
    parsed = json.loads(captured.out)
    assert parsed["overall"] == PASS
    assert len(parsed["results"]) == 2
