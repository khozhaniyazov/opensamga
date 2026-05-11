"""
app/routers/growth.py
---------------------
Handles Viral Loops: Squads, Invites, and Social Competition.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..services.growth import calculate_squad_xp, create_squad, invite_to_squad
from ..services.safety import moderate_content
from .auth import get_current_user

# 🚨 THIS IS THE MISSING LINE THAT CAUSED THE ERROR 🚨
router = APIRouter(prefix="/growth", tags=["growth"])

# --- PYDANTIC SCHEMAS ---


class SquadCreate(BaseModel):
    name: str


class SquadInvite(BaseModel):
    target_user_id: int


# --- ENDPOINTS ---


@router.post("/squads")
async def create_new_squad(
    squad_data: SquadCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new squad."""
    # 1. Safety Check (AI Moderation)
    is_safe, _ = await moderate_content(squad_data.name, current_user.id, db)
    if not is_safe:
        raise HTTPException(status_code=400, detail="Название отряда содержит неприемлемый контент")

    # 2. Create Squad
    squad = await create_squad(current_user.id, squad_data.name, db)
    return {"id": squad.id, "name": squad.name}


@router.post("/squads/{squad_id}/invite")
async def invite_user_to_squad(
    squad_id: int,
    invite_data: SquadInvite,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invite a user to your squad."""
    try:
        result = await invite_to_squad(squad_id, current_user.id, invite_data.target_user_id, db)
        return result
    except ValueError as e:
        # ValueError messages from invite_to_squad are validation strings
        # (e.g. "user not found", "already in squad") and safe to surface.
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/squads/{squad_id}/xp")
async def get_squad_xp(squad_id: int, db: AsyncSession = Depends(get_db)):
    """Get total XP for a squad."""
    total_xp = await calculate_squad_xp(squad_id, db)
    return {"squad_id": squad_id, "total_xp": total_xp}
