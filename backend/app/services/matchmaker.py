import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import GamificationProfile, StudentProfile, User

# v3.49 (2026-05-02): replaced 4x print() (3x DEBUG + 1x CRITICAL ERROR
# with traceback.print_exc) with module logger. The DEBUG prints fired
# on every find_study_buddies call; the CRITICAL ERROR on any failure.
# Both routed around the standard logging pipeline that the rest of
# the backend uses.
logger = logging.getLogger(__name__)


async def find_study_buddies(user_id: int, db: AsyncSession) -> list[dict[str, Any]]:
    try:
        logger.debug("matchmaker.find_study_buddies: user_id=%s", user_id)

        # 1. Simple User Fetch (No complex options first)
        stmt = select(User).where(User.id == user_id)
        result = await db.execute(stmt)
        me = result.scalars().first()

        if not me:
            logger.debug("matchmaker.find_study_buddies: user_id=%s not found", user_id)
            return []

        # 2. Manual Profile Fetch (Avoid selectinload for now if it's causing issues)
        p_stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
        p_res = await db.execute(p_stmt)
        my_profile = p_res.scalars().first()

        if not my_profile:
            logger.debug("matchmaker.find_study_buddies: user_id=%s profile not found", user_id)
            return []

        set(my_profile.chosen_subjects or [])
        my_uni_id = my_profile.target_university_id

        # 3. Fetch Candidates
        query = select(User).limit(10)  # Simple fetch
        result = await db.execute(query)
        candidates = result.scalars().all()

        matches = []
        for candidate in candidates:
            if candidate.id == user_id:
                continue

            # Manual lazy fetch for candidate profile
            cp_stmt = select(StudentProfile).where(StudentProfile.user_id == candidate.id)
            cp_res = await db.execute(cp_stmt)
            c_profile = cp_res.scalars().first()

            if not c_profile:
                continue

            # Manual fetch for gamification
            gp_stmt = select(GamificationProfile).where(GamificationProfile.user_id == candidate.id)
            gp_res = await db.execute(gp_stmt)
            c_gamif = gp_res.scalars().first()

            score = 10  # Base score
            reasons = ["Активный студент"]

            if my_uni_id and c_profile.target_university_id == my_uni_id:
                score += 30
                reasons.append("Одинаковый целевой ВУЗ")

            matches.append(
                {
                    "user_id": candidate.id,
                    "name": candidate.full_name or candidate.name or "User",
                    "avatar_url": c_profile.avatar_url,
                    "match_score": score,
                    "match_reasons": reasons,
                    "target_uni_id": c_profile.target_university_id,
                    "subjects": c_profile.chosen_subjects or [],
                    "streak": c_gamif.current_streak if c_gamif else 0,
                }
            )

        matches.sort(key=lambda x: x["match_score"], reverse=True)
        return matches

    except Exception:
        logger.exception("matchmaker.find_study_buddies: unexpected failure user_id=%s", user_id)
        return []
