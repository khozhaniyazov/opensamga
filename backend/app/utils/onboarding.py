"""Shared onboarding-completion rules.

The frontend can guide users through onboarding, but the backend must be the
source of truth for whether an authenticated user can enter the product.
"""

from app.constants.subjects import (
    get_compulsory_subjects,
    get_max_score,
    get_profile_subjects,
    is_valid_profile_subject_pair,
    normalize_subject_name,
)
from app.models import StudentProfile

ONBOARDING_VALID_SUBJECTS = set(get_profile_subjects())


def is_onboarding_completed(profile: StudentProfile | None) -> bool:
    """Return True only when all required registration context is present.

    s26 phase 7: tightened to require ``target_majors[0]`` and
    ``competition_quota`` so the chat agent has every input it needs to
    answer "what are my chances?" without follow-up questions. Legacy
    profiles created before this rule will fail the check and get sent
    back through onboarding to fill in the missing two fields.
    """
    if not profile:
        return False

    subjects = [normalize_subject_name(subject) for subject in (profile.chosen_subjects or [])]
    if len(subjects) != 2 or len(set(subjects)) != 2:
        return False
    if any(subject not in ONBOARDING_VALID_SUBJECTS for subject in subjects):
        return False
    if not is_valid_profile_subject_pair(subjects):
        return False
    if not profile.target_university_id:
        return False

    weakest = normalize_subject_name(profile.weakest_subject) if profile.weakest_subject else None
    if not weakest or weakest not in subjects:
        return False

    # s26 phase 7: chat-agent fuel. Without these two the agent has to
    # re-ask uni/major/quota on every "какие мои шансы?" turn.
    target_majors = list(profile.target_majors or [])
    if not target_majors or not str(target_majors[0]).strip():
        return False
    quota = (profile.competition_quota or "").strip().upper()
    if quota not in {"GENERAL", "RURAL"}:
        return False

    results = profile.last_test_results or {}
    if not isinstance(results, dict):
        return False

    required_subjects = [*get_compulsory_subjects(), *subjects]
    if len(required_subjects) != 5:
        return False

    for subject in required_subjects:
        scores = results.get(subject)
        if not isinstance(scores, list) or not 1 <= len(scores) <= 5:
            return False
        max_score = get_max_score(subject)
        for score in scores:
            try:
                value = int(score)
            except (TypeError, ValueError):
                return False
            if value < 0 or value > max_score:
                return False

    return True
