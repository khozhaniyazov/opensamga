from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import StudentProfile
from app.routers.users import _normalize_test_results
from app.utils.onboarding import is_onboarding_completed


def test_profile_result_validation_uses_subject_maximums():
    with pytest.raises(HTTPException) as exc:
        _normalize_test_results({"Geography": [51]})

    assert exc.value.status_code == 422
    assert "0 до 50" in exc.value.detail

    with pytest.raises(HTTPException) as exc:
        _normalize_test_results({"Mathematical Literacy": [11]})

    assert exc.value.status_code == 422
    assert "0 до 10" in exc.value.detail


def test_onboarding_completion_requires_all_five_subject_results():
    # s26 phase 7: in addition to all-five-results, completion now also
    # requires target_majors[0] and competition_quota ∈ {GENERAL, RURAL}
    # so the chat agent has every input for "какие шансы?" without
    # asking follow-up questions. Build the fully-onboarded profile and
    # then ablate one field at a time to confirm each is required.
    profile = StudentProfile(
        chosen_subjects=["Geography", "Foreign Language"],
        weakest_subject="Geography",
        target_university_id=1,
        target_majors=["B057"],
        competition_quota="GENERAL",
        last_test_results={
            "Geography": [50],
            "Foreign Language": [45],
        },
    )

    # Missing 3 compulsory results.
    assert is_onboarding_completed(profile) is False

    profile.last_test_results = {
        "History of Kazakhstan": [18],
        "Mathematical Literacy": [9],
        "Reading Literacy": [8],
        "Geography": [50],
        "Foreign Language": [45],
    }

    # All five results + target_majors + quota → onboarding done.
    assert is_onboarding_completed(profile) is True

    # s26 phase 7 ablation: drop quota → blocks.
    profile.competition_quota = None
    assert is_onboarding_completed(profile) is False
    profile.competition_quota = "GENERAL"

    # Drop target_majors → blocks.
    profile.target_majors = []
    assert is_onboarding_completed(profile) is False
    profile.target_majors = ["B057"]
    assert is_onboarding_completed(profile) is True
