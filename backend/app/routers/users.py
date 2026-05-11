"""
app/routers/users.py
--------------------
Handles User Profile management.
Includes:
- Profile Retrieval/Initialization
- Profile Updates with Validation
- Avatar Uploads
"""

import logging
import os
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..constants.subjects import (
    get_all_subjects,
    get_max_score,
    get_profile_subjects,
    is_valid_profile_subject_pair,
    normalize_subject_name,
)
from ..database import get_db
from ..models import LanguagePreference, StudentProfile, UniversityDetail, User

# Import cache utility
from ..utils.cache import cache
from ..utils.onboarding import is_onboarding_completed
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

# --- CONSTANTS ---

# Get valid subjects from canonical constants
VALID_SUBJECTS = set(get_all_subjects())
VALID_PROFILE_SUBJECTS = set(get_profile_subjects())

# Subject name mapping is now handled by normalize_subject_name()
# No need for manual mapping anymore

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/jpg"}

# --- PYDANTIC SCHEMAS ---

# F-19 (s23+, 2026-04-26): cap display name + bio at sane lengths so
# `PUT /users/me` can no longer accept a 269-char "display name" that
# breaks downstream rendering. Trim leading/trailing whitespace too.
NAME_MAX_LEN = 80
BIO_MAX_LEN = 500


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=NAME_MAX_LEN)
    bio: str | None = Field(default=None, max_length=BIO_MAX_LEN)
    target_university_id: int | None = None
    chosen_subjects: list[str] | None = None
    language_preference: str | None = None
    target_majors: list[str] | None = None
    target_universities: list[int] | None = None
    last_test_results: dict[str, list[int]] | None = None
    weakest_subject: str | None = None
    # s26 phase 7: persisted quota choice. Accept the canonical English
    # tokens the rest of the stack already uses (HistoricalGrantThreshold
    # and AcceptanceScore both store them as plain strings).
    competition_quota: str | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            # An all-whitespace value is treated like "no change" rather
            # than blanking the user's display name.
            return None
        if len(stripped) > NAME_MAX_LEN:
            # Defence-in-depth even though Field(max_length=…) already
            # rejects this. Belt + suspenders for callers that bypass
            # the schema (e.g. ad-hoc tests).
            raise ValueError(f"Имя слишком длинное (макс. {NAME_MAX_LEN} символов)")
        return stripped


class UserProfileResponse(BaseModel):
    id: int
    email: str
    name: str
    bio: str | None = None
    avatar_url: str | None = None
    target_university_id: int | None = None
    chosen_subjects: list[str] | None = None
    honor_score: int | None = 100
    is_shadow_banned: bool | None = False
    language_preference: str | None = "RU"
    target_majors: list[str] | None = None
    target_universities: list[int] | None = None
    last_test_results: dict[str, list[int]] | None = None
    weakest_subject: str | None = None
    competition_quota: str | None = None
    onboarding_completed: bool = False


# --- HELPER FUNCTIONS ---


def get_upload_path() -> Path:
    """Returns the absolute path to the uploads directory."""
    # Assuming app structure: /backend/app/routers/users.py
    # We want: /backend/uploads/avatars
    base_path = Path(__file__).parent.parent.parent
    upload_dir = base_path / "uploads" / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _normalize_test_results(results: dict[str, list[int]] | None) -> dict[str, list[int]] | None:
    if results is None:
        return None

    normalized: dict[str, list[int]] = {}
    for raw_subject, raw_scores in results.items():
        subject = normalize_subject_name(str(raw_subject))
        if subject not in VALID_SUBJECTS:
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимый предмет в результатах: {raw_subject}",
            )
        if not isinstance(raw_scores, list):
            raise HTTPException(
                status_code=422,
                detail="Результаты тестов должны быть списком баллов по каждому предмету.",
            )
        if len(raw_scores) > 5:
            raise HTTPException(
                status_code=422,
                detail="Можно указать максимум 5 последних результатов по каждому предмету.",
            )

        max_score = get_max_score(subject)
        scores: list[int] = []
        for raw_score in raw_scores:
            try:
                score = int(raw_score)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="Баллы должны быть числами.") from None
            if score < 0 or score > max_score:
                raise HTTPException(
                    status_code=422,
                    detail=f"Балл по предмету {subject} должен быть в диапазоне от 0 до {max_score}.",
                )
            scores.append(score)

        if scores:
            normalized[subject] = scores

    return normalized


def _is_onboarding_completed(profile: StudentProfile | None) -> bool:
    return is_onboarding_completed(profile)


def _serialize_profile(user: User) -> dict:
    profile = user.profile
    language_preference = user.language_preference
    language_value = (
        language_preference.value
        if hasattr(language_preference, "value")
        else language_preference or "RU"
    )
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "bio": profile.bio if profile else None,
        "avatar_url": profile.avatar_url if profile else None,
        "target_university_id": profile.target_university_id if profile else None,
        "chosen_subjects": profile.chosen_subjects if profile else None,
        "honor_score": user.honor_score,
        "is_shadow_banned": user.is_shadow_banned,
        "language_preference": language_value,
        "target_majors": profile.target_majors if profile else None,
        "target_universities": profile.target_universities if profile else None,
        "last_test_results": profile.last_test_results if profile else None,
        "weakest_subject": profile.weakest_subject if profile else None,
        "competition_quota": profile.competition_quota if profile else None,
        "onboarding_completed": _is_onboarding_completed(profile),
    }


# --- ENDPOINTS ---


@router.get("/me", response_model=UserProfileResponse)
async def read_users_me(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get current user profile with 5-minute caching.

    User profiles don't change frequently, so caching reduces
    database load for dashboard and navigation requests.
    """
    # Generate cache key based on user ID
    key = f"user_profile:{current_user.id}"

    # Check cache first
    cached_profile = await cache.get(key)
    if cached_profile is not None:
        return cached_profile

    # Cache miss - query database
    # FIX: Eagerly load the profile relationship to prevent null errors in async context.
    user_with_profile_stmt = (
        select(User).options(selectinload(User.profile)).where(User.id == current_user.id)
    )

    result = await db.execute(user_with_profile_stmt)
    user_with_profile = result.scalars().first()

    # Ensure profile exists (needed for initialization logic)
    if not user_with_profile.profile:
        new_profile = StudentProfile(user_id=user_with_profile.id)
        db.add(new_profile)
        await db.commit()
        result = await db.execute(user_with_profile_stmt)
        user_with_profile = result.scalars().first()

    profile_data = _serialize_profile(user_with_profile)

    # Store in cache for 5 minutes
    await cache.set(key, profile_data, ttl_seconds=300)

    return profile_data


@router.put("/me", response_model=UserProfileResponse)
async def update_user_me(
    profile_update: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update user profile with validation and cache invalidation."""

    # 1. Update basic User fields
    if profile_update.name:
        current_user.name = profile_update.name

    if profile_update.language_preference:
        current_user.language_preference = LanguagePreference(profile_update.language_preference)

    # Ensure profile exists
    if not current_user.profile:
        new_profile = StudentProfile(user_id=current_user.id)
        db.add(new_profile)
        await db.commit()
        await db.refresh(current_user)

    # 2. Update Profile fields
    if profile_update.bio is not None:
        # Truncate bio to 500 characters to prevent UI layout issues
        bio = profile_update.bio[:500] if len(profile_update.bio) > 500 else profile_update.bio
        current_user.profile.bio = bio

    # 3. Validate and Update University
    if profile_update.target_university_id is not None:
        # Check if university exists in UniversityDetail (canonical source)
        uni_res = await db.execute(
            select(UniversityDetail).where(
                UniversityDetail.id == profile_update.target_university_id
            )
        )
        uni = uni_res.scalar_one_or_none()
        if not uni:
            raise HTTPException(
                status_code=400,
                detail=f"Недействительный ID университета: {profile_update.target_university_id}",
            )
        current_user.profile.target_university_id = profile_update.target_university_id

    # 4. Validate and Update Subjects
    if profile_update.chosen_subjects is not None:
        # Business Rule: Enforce 2-subject limit (UNT requirement)
        if len(profile_update.chosen_subjects) != 2:
            raise HTTPException(
                status_code=422,
                detail="Нужно выбрать ровно 2 профильных предмета. / Дәл 2 бейіндік пән таңдаңыз.",
            )

        # Normalize subject names to canonical English
        normalized_subjects = [
            normalize_subject_name(subj) for subj in profile_update.chosen_subjects
        ]

        # Validate profile subjects and their official UNT combination.
        invalid_subjects = [s for s in normalized_subjects if s not in VALID_PROFILE_SUBJECTS]
        if invalid_subjects:
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимые профильные предметы: {invalid_subjects}. Разрешённые: {list(VALID_PROFILE_SUBJECTS)}",
            )
        if len(set(normalized_subjects)) != 2:
            raise HTTPException(
                status_code=422,
                detail="Профильные предметы должны быть разными. / Бейіндік пәндер әртүрлі болуы керек.",
            )
        if not is_valid_profile_subject_pair(normalized_subjects):
            raise HTTPException(
                status_code=422,
                detail="Недопустимая комбинация профильных предметов. / Бейіндік пәндер комбинациясы жарамсыз.",
            )
        current_user.profile.chosen_subjects = normalized_subjects

    if profile_update.last_test_results is not None:
        current_user.profile.last_test_results = _normalize_test_results(
            profile_update.last_test_results
        )

    if profile_update.weakest_subject is not None:
        weakest_subject = normalize_subject_name(profile_update.weakest_subject)
        if weakest_subject not in VALID_PROFILE_SUBJECTS:
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимый слабый предмет: {profile_update.weakest_subject}",
            )
        current_subjects = [
            normalize_subject_name(subject)
            for subject in (current_user.profile.chosen_subjects or [])
        ]
        if current_subjects and weakest_subject not in current_subjects:
            raise HTTPException(
                status_code=422,
                detail="Слабый предмет должен быть одним из выбранных профильных предметов.",
            )
        current_user.profile.weakest_subject = weakest_subject

    # 5. Update target majors and universities
    if profile_update.target_majors is not None:
        current_user.profile.target_majors = profile_update.target_majors

    if profile_update.target_universities is not None:
        current_user.profile.target_universities = profile_update.target_universities

    # 6. Update competition quota (s26 phase 7).
    # Accept "GENERAL", "RURAL", or null. Anything else gets normalised
    # via uppercase + whitespace strip before validation so frontend
    # spelling drift ("general", " RURAL ") doesn't 422.
    if profile_update.competition_quota is not None:
        raw_quota = (profile_update.competition_quota or "").strip().upper()
        if raw_quota and raw_quota not in {"GENERAL", "RURAL"}:
            raise HTTPException(
                status_code=400,
                detail=("Допустимые квоты: GENERAL, RURAL. / Жарамды квоталар: GENERAL, RURAL."),
            )
        current_user.profile.competition_quota = raw_quota or None

    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.profile)).where(User.id == current_user.id)
    )
    updated_user = result.scalars().first()

    # IMPORTANT: Invalidate user profile cache after update
    await cache.invalidate(f"user_profile:{current_user.id}")

    return _serialize_profile(updated_user)


@router.post("/me/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a profile picture.
    Saves to /uploads/avatars/ and serves via /static/avatars/.
    """
    # 1. Validate File Type
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400, detail="Недопустимый тип файла. Разрешены только JPEG и PNG."
        )

    # 2. Prepare Path
    upload_dir = get_upload_path()
    file_extension = os.path.splitext(file.filename)[1]
    # Unique filename: user_id + timestamp
    new_filename = f"{current_user.id}_{int(time.time())}{file_extension}"
    file_path = upload_dir / new_filename

    # 3. Save File
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.exception(
            "avatar save failed user_id=%s path=%s",
            current_user.id,
            file_path,
        )
        raise HTTPException(status_code=500, detail="Не удалось сохранить файл") from e

    # 4. Update Database
    # URL path relative to the static mount point defined in main.py
    static_url = f"/static/avatars/{new_filename}"

    if not current_user.profile:
        new_profile = StudentProfile(user_id=current_user.id)
        db.add(new_profile)

    current_user.profile.avatar_url = static_url
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.profile)).where(User.id == current_user.id)
    )
    updated_user = result.scalars().first()

    return _serialize_profile(updated_user)
