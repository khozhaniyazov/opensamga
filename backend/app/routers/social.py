"""
app/routers/social.py
---------------------
The Social Graph Engine.
Handles:
- Leaderboards (Optimized)
- Sending/Accepting Connection Requests
- Viewing Profiles (with Privacy Logic)
- Activity Feeds (What are my friends doing?)
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    ActivityLog,
    Connection,
    ConnectionStatus,
    GamificationProfile,
    StudyMatchRequest,
    User,
    Visibility,
)
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/social", tags=["social"])

# --- PYDANTIC SCHEMAS ---


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    name: str
    xp: int
    league: str
    avatar_url: str | None = None


class ConnectionRequestOut(BaseModel):
    id: int
    sender_name: str
    sender_avatar: str | None
    match_reason: str | None
    status: str
    created_at: datetime


class UserProfilePublic(BaseModel):
    user_id: int
    name: str
    avatar_url: str | None
    league_tier: str
    total_xp: int
    streak: int
    # Conditional Fields (only if connected)
    bio: str | None = None
    telegram_id: str | None = None
    target_uni: str | None = None
    is_connected: bool


class ActivityFeedItem(BaseModel):
    user_name: str
    user_avatar: str | None
    action: str
    metadata: dict
    timestamp: datetime


# --- ENDPOINTS ---


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(db: AsyncSession = Depends(get_db)):
    """
    Global Leaderboard.
    Optimized to fetch User, Gamification, and Profile data in one go.
    """
    query = (
        select(User)
        .join(GamificationProfile)
        .options(selectinload(User.gamification_profile), selectinload(User.profile))
        .order_by(desc(GamificationProfile.total_xp))
        .limit(50)
    )
    result = await db.execute(query)
    users = result.scalars().all()

    leaderboard = []
    for idx, user in enumerate(users):
        g_profile = user.gamification_profile
        s_profile = user.profile

        leaderboard.append(
            {
                "rank": idx + 1,
                "user_id": user.id,
                "name": user.full_name or user.name or f"User {user.id}",
                "xp": g_profile.total_xp if g_profile else 0,
                "league": g_profile.league_tier if g_profile else "BRONZE",
                "avatar_url": s_profile.avatar_url if s_profile else None,
            }
        )
    return leaderboard


@router.post("/connect/{target_user_id}")
async def send_connection_request(
    target_user_id: int,
    reason: str = "Давай учиться вместе!",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sends a study buddy request."""
    try:
        if target_user_id == current_user.id:
            raise HTTPException(status_code=400, detail="Нельзя подключиться к самому себе")

        # Check if target user exists
        target_user_q = select(User).where(User.id == target_user_id)
        target_user_result = await db.execute(target_user_q)
        target_user = target_user_result.scalar_one_or_none()
        if not target_user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        # Check if existing connection or pending request
        existing_q = select(Connection).where(
            Connection.follower_id == current_user.id, Connection.following_id == target_user_id
        )
        existing = await db.execute(existing_q)
        if existing.scalar():
            raise HTTPException(status_code=400, detail="Уже подключены")

        pending_q = select(StudyMatchRequest).where(
            StudyMatchRequest.sender_id == current_user.id,
            StudyMatchRequest.receiver_id == target_user_id,
            StudyMatchRequest.status == ConnectionStatus.PENDING,
        )
        pending = await db.execute(pending_q)
        if pending.scalar():
            raise HTTPException(status_code=400, detail="Запрос уже отправлен")

        # Create Request
        req = StudyMatchRequest(
            sender_id=current_user.id,
            receiver_id=target_user_id,
            match_reason=reason,
            status=ConnectionStatus.PENDING,
        )
        db.add(req)
        await db.commit()
        return {"message": "Запрос отправлен"}
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other exceptions and return 500 with a generic message.
        # Internal details go to the log only — exception strings can leak
        # SQL fragments / file paths to authenticated users.
        logger.exception("social connection request failed user_id=%s", current_user.id)
        raise HTTPException(
            status_code=500, detail="Внутренняя ошибка при обработке запроса"
        ) from e


@router.get("/requests", response_model=list[ConnectionRequestOut])
async def get_pending_requests(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """View incoming requests."""
    query = (
        select(StudyMatchRequest)
        .options(
            selectinload(StudyMatchRequest.sender).selectinload(User.profile)
        )  # Eager load sender info
        .where(
            StudyMatchRequest.receiver_id == current_user.id,
            StudyMatchRequest.status == ConnectionStatus.PENDING,
        )
    )
    result = await db.execute(query)
    reqs = result.scalars().all()

    response = []
    for r in reqs:
        sender_name = r.sender.full_name or r.sender.name
        sender_avatar = r.sender.profile.avatar_url if r.sender.profile else None
        response.append(
            {
                "id": r.id,
                "sender_name": sender_name,
                "sender_avatar": sender_avatar,
                "match_reason": r.match_reason,
                "status": r.status,
                "created_at": r.created_at,
            }
        )
    return response


@router.post("/requests/{request_id}/{action}")
async def respond_to_request(
    request_id: int,
    action: str,  # "accept" or "reject"
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept or Reject a connection request."""
    req_q = select(StudyMatchRequest).where(
        StudyMatchRequest.id == request_id, StudyMatchRequest.receiver_id == current_user.id
    )
    result = await db.execute(req_q)
    req = result.scalar_one_or_none()

    if not req:
        raise HTTPException(status_code=404, detail="Запрос не найден")

    if action == "accept":
        req.status = ConnectionStatus.ACTIVE

        # Create Bidirectional Connections
        conn1 = Connection(
            follower_id=req.sender_id, following_id=req.receiver_id, status=ConnectionStatus.ACTIVE
        )
        conn2 = Connection(
            follower_id=req.receiver_id, following_id=req.sender_id, status=ConnectionStatus.ACTIVE
        )
        db.add_all([conn1, conn2])

        message = "Запрос принят"

    elif action == "reject":
        req.status = ConnectionStatus.BLOCKED  # Or just delete
        message = "Запрос отклонён"
    else:
        raise HTTPException(status_code=400, detail="Недействительное действие")

    await db.commit()
    return {"message": message}


@router.get("/profile/{user_id}", response_model=UserProfilePublic)
async def get_user_profile(
    user_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get a user's profile.
    Hides sensitive data (bio, telegram_id) unless connected.
    """
    # 1. Fetch User Data
    query = (
        select(User)
        .options(selectinload(User.profile), selectinload(User.gamification_profile))
        .where(User.id == user_id)
    )
    result = await db.execute(query)
    target_user = result.scalars().first()

    if not target_user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 2. Check Connection Status
    is_connected = False
    if user_id != current_user.id:
        conn_q = select(Connection).where(
            Connection.follower_id == current_user.id,
            Connection.following_id == user_id,
            Connection.status == ConnectionStatus.ACTIVE,
        )
        conn_res = await db.execute(conn_q)
        if conn_res.scalar():
            is_connected = True
    else:
        is_connected = True  # I am connected to myself

    # 3. Construct Response
    g_profile = target_user.gamification_profile
    s_profile = target_user.profile

    return {
        "user_id": target_user.id,
        "name": target_user.full_name or target_user.name,
        "avatar_url": s_profile.avatar_url if s_profile else None,
        "league_tier": g_profile.league_tier if g_profile else "BRONZE",
        "total_xp": g_profile.total_xp if g_profile else 0,
        "streak": g_profile.current_streak if g_profile else 0,
        "is_connected": is_connected,
        # Private Fields
        "bio": s_profile.bio if is_connected and s_profile else None,
        "telegram_id": target_user.telegram_id if is_connected else None,
        # We can show Target Uni publicly if desired, or keep private
        "target_uni": str(s_profile.target_university_id) if is_connected and s_profile else None,
    }


@router.get("/feed", response_model=list[ActivityFeedItem])
async def get_activity_feed(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    See what my friends are doing.
    """
    # 1. Get List of Friend IDs
    friends_q = select(Connection.following_id).where(
        Connection.follower_id == current_user.id, Connection.status == ConnectionStatus.ACTIVE
    )
    friends_res = await db.execute(friends_q)
    friend_ids = friends_res.scalars().all()

    # Include self in feed? Optional. Let's say yes.
    feed_ids = list(friend_ids) + [current_user.id]

    if not feed_ids:
        return []

    # 2. Query Activity Logs (filter out future dates)
    logs_q = (
        select(ActivityLog)
        .options(selectinload(ActivityLog.user).selectinload(User.profile))
        .where(
            ActivityLog.user_id.in_(feed_ids),
            ActivityLog.visibility == Visibility.PUBLIC,
            ActivityLog.created_at <= func.now(),  # Filter out future dates
        )
        .order_by(desc(ActivityLog.created_at))
        .limit(20)
    )

    result = await db.execute(logs_q)
    logs = result.scalars().all()

    feed = []
    for log in logs:
        feed.append(
            {
                "user_name": log.user.full_name or log.user.name,
                "user_avatar": log.user.profile.avatar_url if log.user.profile else None,
                "action": log.activity_type,
                "metadata": log.metadata_blob or {},
                "timestamp": log.created_at,
            }
        )

    return feed
