"""
app/routers/rewards.py
----------------------
Handles Resource Packs and User Inventory.
SECURE: Verifies ownership before opening packs.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import LootBox, User, UserInventory
from ..services.rewards import generate_loot_box, open_loot_box
from .auth import get_current_user

router = APIRouter(prefix="/rewards", tags=["rewards"])

# --- PYDANTIC SCHEMAS ---


class LootBoxOut(BaseModel):
    box_id: int
    rarity: str


class InventoryItemOut(BaseModel):
    type: str
    data: dict
    acquired_at: datetime


# --- ENDPOINTS ---


@router.post("/lootbox/generate")
async def generate_box(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Generate a resource pack (Internal use mostly, e.g. triggered by streak).
    """
    loot_box = await generate_loot_box(current_user.id, db)
    return {"box_id": loot_box.id, "rarity": loot_box.rarity}


@router.post("/open/{box_id}")
async def open_box(
    box_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Open a resource pack.
    SECURE: Checks if the pack belongs to the current user first.
    """
    # 1. Security Check: Ownership
    result = await db.execute(select(LootBox).where(LootBox.id == box_id))
    box = result.scalars().first()

    if not box:
        raise HTTPException(status_code=404, detail="Ресурсный пакет не найден")

    if box.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Этот ресурсный пакет вам не принадлежит")

    # 2. Attempt Open
    try:
        # Get user's language preference (default to 'ru')
        # TODO: Get from user profile or Accept-Language header
        user_lang = "ru"  # Default to Russian
        result = await open_loot_box(box_id, db, lang=user_lang)
        return result
    except ValueError as e:
        # ValueError messages from open_loot_box are localized validation
        # strings (already translated) and safe to surface verbatim.
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/inventory", response_model=list[InventoryItemOut])
async def get_inventory(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Get user's inventory."""
    result = await db.execute(select(UserInventory).where(UserInventory.user_id == current_user.id))
    items = result.scalars().all()

    return [
        {"type": item.item_type, "data": item.item_data, "acquired_at": item.acquired_at}
        for item in items
    ]
