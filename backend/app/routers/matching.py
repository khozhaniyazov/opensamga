"""
app/routers/matching.py
-----------------------
API endpoints for the "Study Buddy" social graph.
Delegates complex scoring logic to the Matchmaker Service.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import UniversityData, User
from ..services.matchmaker import find_study_buddies
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/matching", tags=["matching"])

# --- PYDANTIC SCHEMAS ---


class MatchProfile(BaseModel):
    user_id: int
    name: str
    avatar_url: str | None = None
    bio: str | None = None
    target_uni: str | None = None  # Resolved University Name
    match_score: int
    match_reasons: list[str] = Field(default_factory=list)  # Defensive: Default to empty list
    subjects: list[str] = Field(default_factory=list)  # Defensive: Default to empty list
    streak: int = 0  # Defensive: Default to 0 if missing
    telegram_id: str | None = None


# --- ENDPOINTS ---


@router.get("/buddies", response_model=list[MatchProfile])
async def find_buddies(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Finds compatible study partners for the current user.
    Uses weighted scoring (Skills, University, Activity).
    """
    try:
        # 1. Delegate Logic to Service
        raw_matches = await find_study_buddies(current_user.id, db)

        if not raw_matches:
            return []

        # 2. Batch Fetch University Names (Optimization)
        # The service returns uni_ids, but frontend needs names.
        # Collect all unique IDs to fetch in one go.
        # DEFENSIVE: Filter out None values and ensure all are integers
        uni_ids = set()
        for m in raw_matches:
            uni_id = m.get("target_uni_id")
            if uni_id is not None:
                try:
                    if isinstance(uni_id, str):
                        if uni_id.isdigit():
                            uni_ids.add(int(uni_id))
                    elif isinstance(uni_id, int):
                        uni_ids.add(uni_id)
                except (ValueError, TypeError):
                    continue  # Skip invalid IDs

        uni_map = {}
        if uni_ids:  # Only query if we have valid IDs
            try:
                uni_query = select(UniversityData.id, UniversityData.uni_name).where(
                    UniversityData.id.in_(uni_ids)
                )
                uni_result = await db.execute(uni_query)
                # DEFENSIVE: Handle None values in row.id
                uni_map = {
                    int(row.id): (row.uni_name or "Unknown")
                    for row in uni_result.all()
                    if row.id is not None
                }
            except Exception:
                # Log but don't crash - we'll use "Undecided" as fallback.
                logger.warning(
                    "Could not fetch university names for matching",
                    exc_info=True,
                )
                uni_map = {}

        # 3. Map to Response Model
        response = []
        for match in raw_matches:
            try:
                # Resolve Uni Name (defensive with fallback)
                target_uni_id = match.get("target_uni_id")
                uni_name = "Undecided"
                if target_uni_id is not None:
                    try:
                        uni_id_int = (
                            int(target_uni_id) if isinstance(target_uni_id, str) else target_uni_id
                        )
                        uni_name = uni_map.get(uni_id_int, "Undecided")
                    except (ValueError, TypeError):
                        uni_name = "Undecided"

                # DEFENSIVE: Ensure all required fields have valid types
                user_id = match.get("user_id")
                if user_id is None:
                    continue  # Skip invalid matches

                name = match.get("name") or "Unknown User"
                if not isinstance(name, str):
                    name = str(name)

                # DEFENSIVE: Handle None/NoneType for optional fields
                avatar_url = match.get("avatar_url")
                if avatar_url is not None and not isinstance(avatar_url, str):
                    avatar_url = str(avatar_url) if avatar_url else None

                # DEFENSIVE: Ensure match_score is int
                match_score = match.get("match_score", 0)
                if not isinstance(match_score, int):
                    try:
                        match_score = int(match_score)
                    except (ValueError, TypeError):
                        match_score = 0

                # DEFENSIVE: Ensure match_reasons is a list
                match_reasons = match.get("match_reasons")
                if not isinstance(match_reasons, list):
                    match_reasons = list(match_reasons) if match_reasons else []

                # DEFENSIVE: Ensure subjects is a list
                subjects = match.get("subjects")
                if not isinstance(subjects, list):
                    subjects = list(subjects) if subjects else []

                # DEFENSIVE: Ensure streak is int
                streak = match.get("streak")
                if not isinstance(streak, int):
                    try:
                        streak = int(streak) if streak is not None else 0
                    except (ValueError, TypeError):
                        streak = 0

                profile = MatchProfile(
                    user_id=int(user_id),
                    name=name,
                    avatar_url=avatar_url,
                    bio=None,  # Service doesn't return bio yet, placeholder
                    target_uni=uni_name,
                    match_score=match_score,
                    match_reasons=match_reasons,
                    subjects=subjects,
                    streak=streak,
                    telegram_id=None,  # Privacy: Don't reveal contact info until connected
                )
                response.append(profile)
            except Exception:
                # Log but continue processing other matches.
                # match dict logged via %s arg so it's structured / not
                # crammed into an f-string in the message format.
                logger.warning(
                    "Skipping invalid match data: %s",
                    match,
                    exc_info=True,
                )
                continue

        return response

    except HTTPException:
        # Re-raise HTTP exceptions (auth errors, etc.)
        raise
    except Exception:
        # Catch-all for any unexpected errors. Stack attached via
        # logger.exception; return empty list rather than crashing.
        logger.exception("Error in find_buddies endpoint")
        return []
