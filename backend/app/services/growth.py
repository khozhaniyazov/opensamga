"""
app/services/growth.py
----------------------
Business logic for Squads, Battles, and Viral Loops.
Optimized for performance using SQL aggregations instead of Python loops.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BattleStatus, GamificationProfile, Squad, SquadBattle, SquadMember


async def create_squad(user_id: int, squad_name: str, db: AsyncSession) -> Squad:
    """Create a new squad with the user as leader."""
    # TODO: Check if user is already in a squad? (Business rule dependent)

    squad = Squad(name=squad_name, created_by=user_id)
    db.add(squad)
    await db.commit()
    await db.refresh(squad)

    # Add creator as leader
    member = SquadMember(squad_id=squad.id, user_id=user_id, is_leader=True)
    db.add(member)
    await db.commit()

    return squad


async def invite_to_squad(
    squad_id: int, inviter_id: int, target_user_id: int, db: AsyncSession
) -> dict[str, Any]:
    """
    Invite a user to squad.
    Returns XP multiplier details if successful.
    """
    # 1. Check squad capacity
    result = await db.execute(select(func.count()).where(SquadMember.squad_id == squad_id))
    count = result.scalar()

    if count >= 5:
        raise ValueError("Squad is full (max 5 members)")

    # 2. Check if already a member
    existing = await db.execute(
        select(SquadMember).where(
            SquadMember.squad_id == squad_id, SquadMember.user_id == target_user_id
        )
    )
    if existing.scalar():
        raise ValueError("User is already in this squad")

    # 3. Add member
    member = SquadMember(squad_id=squad_id, user_id=target_user_id)
    db.add(member)

    # 4. Apply Viral Boost (XP Multiplier)
    # We update the inviter's GamificationProfile
    prof_res = await db.execute(
        select(GamificationProfile).where(GamificationProfile.user_id == inviter_id)
    )
    inviter_profile = prof_res.scalars().first()

    if inviter_profile:
        # We assume badges/metadata is a list of dicts or strings.
        # Here we treat 'badges' as a JSON store for active effects (MVP shortcut).
        # In a strict schema, this might be a separate 'ActiveEffects' table.
        current_badges = list(inviter_profile.badges) if inviter_profile.badges else []

        boost = {
            "type": "REFERRAL_BOOST",
            "multiplier": 1.1,
            "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        }
        current_badges.append(boost)
        inviter_profile.badges = current_badges

    await db.commit()

    return {"success": True, "xp_multiplier": 1.1, "duration_hours": 24}


async def calculate_squad_xp(squad_id: int, db: AsyncSession) -> int:
    """Calculate total XP contributed by squad members."""
    # Optimized: SQL Sum instead of fetching all objects
    result = await db.execute(
        select(func.sum(SquadMember.xp_contributed)).where(SquadMember.squad_id == squad_id)
    )
    total_xp = result.scalar()
    return total_xp or 0


async def start_weekly_battle(db: AsyncSession) -> SquadBattle:
    """Start a new weekly squad battle and reset contribution counters."""
    now = datetime.now(UTC)
    end_date = now + timedelta(days=7)

    # 1. Create Battle Record
    battle = SquadBattle(start_date=now, end_date=end_date, status=BattleStatus.ACTIVE)
    db.add(battle)

    # 2. Reset Squad Member XP (Bulk Update)
    await db.execute(update(SquadMember).values(xp_contributed=0))

    await db.commit()
    await db.refresh(battle)

    return battle


async def finalize_battle(battle_id: int, db: AsyncSession) -> int | None:
    """
    Determine winning squad and distribute rewards.
    Optimized to use a single SQL aggregation query.
    """
    # 1. Find the Squad with the highest sum of xp_contributed
    stmt = (
        select(SquadMember.squad_id, func.sum(SquadMember.xp_contributed).label("total_xp"))
        .group_by(SquadMember.squad_id)
        .order_by(desc("total_xp"))
        .limit(1)
    )

    result = await db.execute(stmt)
    winner_row = result.first()

    winning_squad_id = None
    if winner_row:
        winning_squad_id = winner_row.squad_id

        # 2. Update Battle
        battle_res = await db.execute(select(SquadBattle).where(SquadBattle.id == battle_id))
        battle = battle_res.scalars().first()
        if battle:
            battle.winning_squad_id = winning_squad_id
            battle.status = BattleStatus.COMPLETED

            # TODO: Award "Battle Winner" Badge to all members of winning squad?

            await db.commit()

    return winning_squad_id
