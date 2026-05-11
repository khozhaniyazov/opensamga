"""
app/routers/gamification.py
---------------------------
Handles all 'Strava-like' gamification features:
- XP Tracking & League Promotion
- Global Leaderboards
- User Stats & Rank Calculation
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import ActivityLog, ActivityType, GamificationProfile, LeagueTier, User, Visibility

# Import cache utility
from ..utils.cache import cache
from .auth import get_current_user

router = APIRouter(prefix="/gamification", tags=["gamification"])

# --- CONSTANTS & CONFIGURATION ---

# XP Thresholds for League Promotion
LEAGUE_THRESHOLDS: dict[LeagueTier, int] = {
    LeagueTier.BRONZE: 0,
    LeagueTier.SILVER: 1000,
    LeagueTier.GOLD: 5000,
    LeagueTier.DIAMOND: 15000,
    LeagueTier.ELITE: 50000,
}

# --- PYDANTIC SCHEMAS ---


class XPUpdate(BaseModel):
    amount: int
    action_type: str  # e.g., "DIAGNOSTIC_TEST", "DAILY_LOGIN", "STREAK_BONUS"


class TestSubmission(BaseModel):
    """Schema for submitting test/exam results"""

    subject: str  # e.g., "Mathematics", "History of Kazakhstan"
    score: int  # Points earned (can be 0)
    max_score: int  # Maximum possible score (e.g., 40)
    topic: str | None = None  # Optional topic/tag


class UserStats(BaseModel):
    total_xp: int
    league_tier: LeagueTier
    current_streak: int
    global_rank: int
    xp_to_next_tier: int


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    total_xp: int
    league_tier: LeagueTier
    avatar_url: str | None = None


# --- HELPER FUNCTIONS ---


async def get_or_create_profile(user: User, db: AsyncSession) -> GamificationProfile:
    """
    Ensures a GamificationProfile exists for the user.
    If missing (legacy user), creates one immediately.
    """
    if user.gamification_profile:
        return user.gamification_profile

    # If using selectinload in auth, this might be populated as None.
    # Double check via direct query if necessary, or just create.
    new_profile = GamificationProfile(
        user_id=user.id, total_xp=0, current_streak=0, league_tier=LeagueTier.BRONZE, badges=[]
    )
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)
    return new_profile


def calculate_tier(current_xp: int) -> LeagueTier:
    """Determines the correct League Tier based on total XP."""
    highest_tier = LeagueTier.BRONZE

    # Check thresholds in ascending order
    # (Note: Python 3.7+ guarantees dict insertion order, but explicit sorting is safer)
    sorted_tiers = sorted(LEAGUE_THRESHOLDS.items(), key=lambda x: x[1])

    for tier, threshold in sorted_tiers:
        if current_xp >= threshold:
            highest_tier = tier
        else:
            break
    return highest_tier


# --- ENDPOINTS ---


@router.post("/add-xp")
async def add_xp(
    update: XPUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Award XP to a user. automatically handles League Promotion.
    Uses atomic database operations to prevent race conditions.
    Invalidates stats cache after update.
    """
    profile = await get_or_create_profile(current_user, db)

    # FIX: Use atomic increment to prevent race conditions
    # This ensures concurrent requests don't lose updates
    # Use raw SQL for guaranteed atomicity
    await db.execute(
        text(
            "UPDATE gamification_profiles SET total_xp = total_xp + :amount WHERE id = :profile_id"
        ),
        {"amount": update.amount, "profile_id": profile.id},
    )
    await db.commit()

    # Refresh to get the updated value
    await db.refresh(profile)

    # 2. Check for Promotion
    new_tier = calculate_tier(profile.total_xp)
    if new_tier != profile.league_tier:
        profile.league_tier = new_tier
        await db.commit()
        await db.refresh(profile)
        # TODO: Add Notification logic here (e.g., "You reached Gold League!")

    # Invalidate stats cache
    await cache.invalidate(f"stats:{current_user.id}")

    return {
        "new_xp": profile.total_xp,
        "league_tier": profile.league_tier,
        "promoted": new_tier != profile.league_tier,
    }


@router.post("/submit-test")
async def submit_test(
    test_data: TestSubmission,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a test/exam result. Creates an ActivityLog entry with TEST_COMPLETED type.
    This is critical for the Strategy service to calculate grant probability.
    Invalidates stats cache after update.
    """
    profile = await get_or_create_profile(current_user, db)

    # Calculate XP based on score (simple formula: score = XP)
    # Even 0 scores should be saved to track progress
    xp_amount = max(0, test_data.score)  # Ensure non-negative

    # Update XP atomically
    await db.execute(
        text(
            "UPDATE gamification_profiles SET total_xp = total_xp + :amount WHERE id = :profile_id"
        ),
        {"amount": xp_amount, "profile_id": profile.id},
    )

    # Create ActivityLog entry with TEST_COMPLETED type
    # This is what the Strategy service queries to calculate scores
    activity_log = ActivityLog(
        user_id=current_user.id,
        activity_type=ActivityType.TEST_COMPLETED,
        metadata_blob={
            "subject": test_data.subject,
            "score": test_data.score,  # Can be 0
            "max_score": test_data.max_score,
            "topic": test_data.topic,
            "xp_gained": xp_amount,
        },
        visibility=Visibility.PUBLIC,
    )
    db.add(activity_log)

    await db.commit()
    await db.refresh(profile)
    await db.refresh(activity_log)

    # Check for promotion
    new_tier = calculate_tier(profile.total_xp)
    if new_tier != profile.league_tier:
        profile.league_tier = new_tier
        await db.commit()
        await db.refresh(profile)

    # Invalidate stats cache
    await cache.invalidate(f"stats:{current_user.id}")

    return {
        "success": True,
        "activity_id": activity_log.id,
        "score": test_data.score,
        "max_score": test_data.max_score,
        "subject": test_data.subject,
        "new_xp": profile.total_xp,
        "league_tier": profile.league_tier,
        "promoted": new_tier != profile.league_tier,
    }


@router.get("/stats", response_model=UserStats)
async def get_user_stats(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get the current user's gamification stats and global rank with 1-minute caching.

    Stats change frequently (tests, XP), so use short TTL for freshness.
    """
    # Generate cache key
    key = f"stats:{current_user.id}"

    # Check cache first
    cached_stats = await cache.get(key)
    if cached_stats is not None:
        return cached_stats

    # Cache miss - calculate stats
    profile = await get_or_create_profile(current_user, db)

    # 1. Calculate Global Rank (Count users with MORE XP)
    # Equivalent SQL: SELECT COUNT(*) FROM gamification_profiles WHERE total_xp > :my_xp
    rank_query = select(func.count()).where(GamificationProfile.total_xp > profile.total_xp)
    rank_result = await db.execute(rank_query)
    global_rank = rank_result.scalar() + 1  # +1 because if 0 people are better, I am #1

    # 2. Calculate XP to next tier
    next_tier_xp = 999999  # Max cap
    sorted_thresholds = sorted(LEAGUE_THRESHOLDS.values())
    for threshold in sorted_thresholds:
        if threshold > profile.total_xp:
            next_tier_xp = threshold - profile.total_xp
            break

    if next_tier_xp == 999999:
        next_tier_xp = 0  # Max level reached

    stats_data = {
        "total_xp": profile.total_xp,
        "league_tier": profile.league_tier,
        "current_streak": profile.current_streak,
        "global_rank": global_rank,
        "xp_to_next_tier": next_tier_xp,
    }

    # Store in cache for 1 minute (stats change frequently)
    await cache.set(key, stats_data, ttl_seconds=60)

    return stats_data


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(db: AsyncSession = Depends(get_db)):
    """
    Get top 50 users ordered by Total XP.
    """
    # Join with User to get names/avatars efficiently
    query = (
        select(GamificationProfile)
        .options(selectinload(GamificationProfile.user))
        .order_by(desc(GamificationProfile.total_xp))
        .limit(50)
    )
    result = await db.execute(query)
    profiles = result.scalars().all()

    leaderboard_data = []
    for idx, profile in enumerate(profiles):
        # Fallback if user relationship is somehow missing (rare)
        user_name = (
            profile.user.full_name
            if profile.user and profile.user.full_name
            else f"User {profile.user_id}"
        )

        leaderboard_data.append(
            {
                "rank": idx + 1,
                "username": user_name,
                "total_xp": profile.total_xp,
                "league_tier": profile.league_tier,
                "avatar_url": None,  # profile.user.profile.avatar_url if connected
            }
        )

    return leaderboard_data
