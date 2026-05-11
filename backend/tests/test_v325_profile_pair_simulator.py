"""
test_v325_profile_pair_simulator.py
-----------------------------------

Pure no-DB contract tests for the v3.25 profile-pair simulator service.

The async ``build_profile_pair_simulator_response`` orchestrator is
DB-touching and integration-tested elsewhere; here we pin the helpers,
the curated career copy registry, the CSV-split fix (so
``Mathematics`` doesn't collide with ``Mathematical Literacy``), and the
risk classifier thresholds.
"""

from __future__ import annotations

from app.constants.subjects import (
    PROFILE_SUBJECT_COMBINATIONS,
    is_valid_profile_subject_pair,
)
from app.services.profile_pair_simulator import (
    PAIR_CAREER_COPY,
    RISK_HIGH_COMPETITION_MIN_THRESHOLD,
    RISK_LOW_GRANT_COUNT_MAX,
    RISK_NARROW_MAJOR_RANGE_MAX,
    aggregate_thresholds,
    canonical_pair_key,
    classify_pair_risks,
    expected_pairs,
    major_matches_pair,
    pair_career_copy,
    split_unt_subjects,
)

# ──────────────────────────────────────────────────────────────────────────
# canonical_pair_key
# ──────────────────────────────────────────────────────────────────────────


def test_canonical_pair_key_is_sorted_and_normalized():
    assert canonical_pair_key("Mathematics", "Physics") == ("Mathematics", "Physics")
    assert canonical_pair_key("Physics", "Mathematics") == ("Mathematics", "Physics")


def test_canonical_pair_key_normalizes_ru_and_kz_aliases():
    # Either RU "Математика" or KZ "Математика" must normalize to canonical.
    key = canonical_pair_key("Математика", "Physics")
    assert key == ("Mathematics", "Physics")


def test_canonical_pair_key_for_history_pair_uses_canonical_name():
    # Issue #15 says "World History+Law"; canonical name is
    # "Fundamentals of Law", and the sorted key must reflect that.
    key = canonical_pair_key("World History", "Fundamentals of Law")
    assert key == ("Fundamentals of Law", "World History")


# ──────────────────────────────────────────────────────────────────────────
# pair_career_copy
# ──────────────────────────────────────────────────────────────────────────


def test_career_copy_has_entry_for_every_profile_combination():
    """Every entry in PROFILE_SUBJECT_COMBINATIONS must have curated copy.

    If a future refactor adds a new pair, this fails loudly so the curator
    knows to author RU+KZ copy before shipping.
    """
    keys = {canonical_pair_key(p[0], p[1]) for p in PROFILE_SUBJECT_COMBINATIONS}
    missing = keys - set(PAIR_CAREER_COPY.keys())
    assert missing == set(), f"missing curated copy for: {missing}"


def test_career_copy_returned_for_known_pair():
    copy = pair_career_copy(("Mathematics", "Physics"))
    assert copy is not None
    payload = copy.to_dict()
    assert "ru" in payload and "kz" in payload
    for lang in ("ru", "kz"):
        for field in ("title", "majors", "pressure", "next"):
            assert payload[lang][field], f"empty {lang}.{field}"


def test_career_copy_returns_none_for_unknown_pair():
    assert pair_career_copy(("Mathematics", "Mathematics")) is None
    assert pair_career_copy(("Foo", "Bar")) is None


def test_career_copy_dict_keys_stable():
    """The to_dict() shape is what the FE consumes — pin it."""
    copy = pair_career_copy(("Biology", "Chemistry"))
    assert copy is not None
    payload = copy.to_dict()
    assert set(payload.keys()) == {"ru", "kz"}
    assert set(payload["ru"].keys()) == {"title", "majors", "pressure", "next"}
    assert set(payload["kz"].keys()) == {"title", "majors", "pressure", "next"}


# ──────────────────────────────────────────────────────────────────────────
# split_unt_subjects + major_matches_pair (the CSV-substring fix)
# ──────────────────────────────────────────────────────────────────────────


def test_split_unt_subjects_handles_blank_and_whitespace():
    assert split_unt_subjects(None) == []
    assert split_unt_subjects("") == []
    assert split_unt_subjects(" , , ,") == []
    assert split_unt_subjects("Mathematics, Physics ,Informatics") == [
        "Mathematics",
        "Physics",
        "Informatics",
    ]


def test_split_unt_subjects_normalizes_aliases():
    # KZ alias "Математика" should normalize to canonical English.
    parts = split_unt_subjects("Математика,Physics")
    assert parts == ["Mathematics", "Physics"]


def test_major_matches_pair_exact_match():
    csv = "Mathematics,Physics,Informatics"
    assert major_matches_pair(csv, ("Mathematics", "Physics")) is True
    assert major_matches_pair(csv, ("Mathematics", "Informatics")) is True


def test_major_matches_pair_does_not_substring_collide():
    """Mathematics must NOT match a row whose csv only has Mathematical Literacy.

    This is the chat-tool ILIKE bug we are fixing: %Mathematics% in SQL
    matches ``Mathematical Literacy``. The CSV-split exact-match shape must
    treat them as distinct subjects.
    """
    csv = "Mathematical Literacy,Reading Literacy"
    assert major_matches_pair(csv, ("Mathematics", "Physics")) is False
    # Confirms split alone is what saves us, not a normalize quirk.
    assert "Mathematics" not in split_unt_subjects(csv)


def test_major_matches_pair_requires_both_subjects():
    csv = "Mathematics,Informatics"
    assert major_matches_pair(csv, ("Mathematics", "Physics")) is False


def test_major_matches_pair_handles_missing_csv():
    assert major_matches_pair(None, ("Mathematics", "Physics")) is False
    assert major_matches_pair("", ("Mathematics", "Physics")) is False


# ──────────────────────────────────────────────────────────────────────────
# aggregate_thresholds
# ──────────────────────────────────────────────────────────────────────────


def test_aggregate_thresholds_empty():
    assert aggregate_thresholds(grant_thresholds=[]) == {"median": None, "max": None}


def test_aggregate_thresholds_drops_nones():
    assert aggregate_thresholds(grant_thresholds=[None, None]) == {
        "median": None,
        "max": None,
    }


def test_aggregate_thresholds_computes_median_and_max():
    out = aggregate_thresholds(grant_thresholds=[100, 110, 120, None])
    # statistics.median([100,110,120]) == 110
    assert out == {"median": 110, "max": 120}


def test_aggregate_thresholds_int_coerces_floats():
    out = aggregate_thresholds(grant_thresholds=[100, 105])
    # median([100,105]) = 102.5 → int() floor = 102
    assert out["median"] == 102
    assert out["max"] == 105


# ──────────────────────────────────────────────────────────────────────────
# classify_pair_risks
# ──────────────────────────────────────────────────────────────────────────


def test_classify_pair_risks_no_flags_is_low_severity():
    out = classify_pair_risks(
        major_count=RISK_NARROW_MAJOR_RANGE_MAX + 5,
        median_threshold=RISK_HIGH_COMPETITION_MIN_THRESHOLD - 10,
        total_grants_awarded=RISK_LOW_GRANT_COUNT_MAX + 10,
    )
    assert out == {"flags": [], "severity": "low"}


def test_classify_pair_risks_narrow_major_range():
    out = classify_pair_risks(
        major_count=2,
        median_threshold=80,
        total_grants_awarded=200,
    )
    assert out["flags"] == ["narrow_major_range"]
    assert out["severity"] == "medium"


def test_classify_pair_risks_high_competition():
    out = classify_pair_risks(
        major_count=10,
        median_threshold=130,
        total_grants_awarded=200,
    )
    assert out["flags"] == ["high_competition"]
    assert out["severity"] == "medium"


def test_classify_pair_risks_low_grant_count():
    out = classify_pair_risks(
        major_count=10,
        median_threshold=80,
        total_grants_awarded=10,
    )
    assert out["flags"] == ["low_grant_count"]
    assert out["severity"] == "medium"


def test_classify_pair_risks_multiple_flags_is_high_severity():
    out = classify_pair_risks(
        major_count=2,
        median_threshold=130,
        total_grants_awarded=10,
    )
    assert set(out["flags"]) == {
        "narrow_major_range",
        "high_competition",
        "low_grant_count",
    }
    assert out["severity"] == "high"


def test_classify_pair_risks_handles_missing_threshold():
    """If we have no threshold data, high_competition can't be flagged."""
    out = classify_pair_risks(
        major_count=10,
        median_threshold=None,
        total_grants_awarded=200,
    )
    assert out["flags"] == []
    assert out["severity"] == "low"


# ──────────────────────────────────────────────────────────────────────────
# expected_pairs
# ──────────────────────────────────────────────────────────────────────────


def test_expected_pairs_matches_profile_subject_combinations():
    expected = {canonical_pair_key(p[0], p[1]) for p in PROFILE_SUBJECT_COMBINATIONS}
    assert set(expected_pairs()) == expected
    # All pairs in the registry must also be valid per the constants module.
    for s1, s2 in expected_pairs():
        assert is_valid_profile_subject_pair([s1, s2])
