"""
app/services/gamification.py
----------------------------
Business logic for the "Strava-like" gamification system.
Handles XP calculation, League Promotion, Streak tracking, and Activity Logging.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ActivityLog, ActivityType, GamificationProfile, LeagueTier, Visibility

# --- CONSTANTS ---

# Points awarded for specific actions
XP_TABLE: dict[str, int] = {
    "DIAGNOSTIC_TEST": 50,
    "STREAK_7_DAYS": 500,
    "DAILY_LOGIN": 10,
    "PROFILE_UPDATE": 100,
    "STUDY_SESSION_30M": 30,
    "BADGE_EARNED": 200,
}

# XP required to reach each League Tier
LEAGUE_THRESHOLDS: dict[LeagueTier, int] = {
    LeagueTier.BRONZE: 0,
    LeagueTier.SILVER: 1000,
    LeagueTier.GOLD: 5000,
    LeagueTier.DIAMOND: 15000,
    LeagueTier.ELITE: 50000,
}

# --- HELPER FUNCTIONS ---


def calculate_tier(current_xp: int) -> LeagueTier:
    """
    Pure function to determine League Tier based on XP.
    Iterates thresholds in ascending order.
    """
    highest_tier = LeagueTier.BRONZE
    # Sort by threshold value to ensure correct progression check
    sorted_tiers = sorted(LEAGUE_THRESHOLDS.items(), key=lambda x: x[1])

    for tier, threshold in sorted_tiers:
        if current_xp >= threshold:
            highest_tier = tier
        else:
            break
    return highest_tier


async def get_or_create_gamification_profile(user_id: int, db: AsyncSession) -> GamificationProfile:
    """
    Retrieves a user's gamification profile, creating it if it doesn't exist.
    """
    result = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == user_id)
    )
    profile = result.scalars().first()

    if not profile:
        profile = GamificationProfile(
            user_id=user_id, total_xp=0, current_streak=0, league_tier=LeagueTier.BRONZE, badges=[]
        )
        db.add(profile)
        await db.commit()
        await db.refresh(profile)

    return profile


# --- CORE LOGIC ---


async def award_xp(
    user_id: int, action_type: str, db: AsyncSession, metadata: dict[str, Any] = None
) -> dict[str, Any]:
    """
    Awards XP, checks for League Promotion, and logs the activity.
    Returns a dict summary of the operation.
    """
    profile = await get_or_create_gamification_profile(user_id, db)

    # 1. Calculate XP
    # Check if action is in table, otherwise assume 0 or check metadata
    xp_amount = XP_TABLE.get(action_type, 0)

    # 2. Update Profile
    profile.total_xp += xp_amount

    # 3. Check for Promotion
    new_tier = calculate_tier(profile.total_xp)
    is_promoted = new_tier != profile.league_tier
    if is_promoted:
        profile.league_tier = new_tier

    # 4. Log Activity
    # Map string action to Enum if possible, default to TEST_COMPLETED or generic
    try:
        activity_enum = ActivityType[action_type]
    except KeyError:
        # Fallback mapping
        if "TEST" in action_type:
            activity_enum = ActivityType.TEST_COMPLETED
        elif "BADGE" in action_type:
            activity_enum = ActivityType.BADGE_EARNED
        else:
            activity_enum = ActivityType.STREAK_MILESTONE

    log = ActivityLog(
        user_id=user_id,
        activity_type=activity_enum,
        metadata_blob={"xp_gained": xp_amount, "action": action_type, **(metadata or {})},
        visibility=Visibility.PUBLIC,
    )
    db.add(log)

    await db.commit()
    await db.refresh(profile)

    return {
        "profile": profile,
        "xp_gained": xp_amount,
        "new_total": profile.total_xp,
        "promoted": is_promoted,
        "new_tier": new_tier,
    }


async def update_streak(user_id: int, db: AsyncSession) -> int:
    """
    Updates the user's daily login streak.
    Handles timezone-aware logic to prevent reset errors.
    Returns the new streak count.
    """
    profile = await get_or_create_gamification_profile(user_id, db)
    now_utc = datetime.now(UTC)

    if not profile.last_activity_date:
        # First ever activity
        profile.current_streak = 1
        profile.last_activity_date = now_utc
    else:
        # Ensure stored date is timezone aware
        last_date = profile.last_activity_date
        if last_date.tzinfo is None:
            last_date = last_date.replace(tzinfo=UTC)

        # Calculate difference in DAYS (ignoring hours/minutes)
        delta_days = (now_utc.date() - last_date.date()).days

        if delta_days == 1:
            # Consecutive day: Increment
            profile.current_streak += 1

            # Weekly Bonus Check
            if profile.current_streak % 7 == 0:
                # Recursively award XP (this handles the commit inside)
                await award_xp(user_id, "STREAK_7_DAYS", db, {"streak": profile.current_streak})
                # Re-fetch profile to avoid stale object state after nested commit
                await db.refresh(profile)

        elif delta_days > 1:
            # Missed a day: Reset
            profile.current_streak = 1

        # If delta_days == 0, do nothing (already tracked for today)

    profile.last_activity_date = now_utc
    await db.commit()
    return profile.current_streak
