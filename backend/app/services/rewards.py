"""
app/services/rewards.py
-----------------------
Business logic for the Resource Pack and Inventory system.
Localized for Kazakhstan (Russian Language).
"""

import random
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import LootBox, LootBoxRarity, RewardType, UserInventory

# Weighted reward probabilities (Percentage)
RARITY_WEIGHTS = {LootBoxRarity.COMMON: 70, LootBoxRarity.RARE: 25, LootBoxRarity.LEGENDARY: 5}

# --- LOCALIZED CONTENT ---

STUDY_TIPS_RU = [
    "Эффективность запоминания снижается на 40% через 24 часа. Повторите материал сегодня.",
    "Интервальное повторение: оптимальные интервалы — 1 день, 3 дня, 7 дней, 14 дней.",
    "Активное воспроизведение повышает удержание информации на 50% по сравнению с пассивным чтением.",
    "Тестирование прошлых лет ҰБТ: анализ паттернов вопросов увеличивает точность на 15-20%.",
    "Техника Pomodoro: 25 минут фокуса, 5 минут отдыха. Циклы по 4 сессии с длинным перерывом.",
    "Для математики: минимум 10 задач в день. Критический порог для формирования навыка — 21 день практики.",
    "История Казахстана: таймлайны событий улучшают пространственное запоминание на 30%.",
    "Сон: консолидация памяти происходит в фазе глубокого сна. Минимум 7-8 часов для оптимального усвоения.",
]

STUDY_TIPS_KZ = [
    "Есте сақтау тиімділігі 24 сағаттан кейін 40% төмендейді. Материалды бүгін қайталаңыз.",
    "Аралық қайталау: оңтайлы аралықтар — 1 күн, 3 күн, 7 күн, 14 күн.",
    "Белсенді қайталау пассивті оқумен салыстырғанда ақпаратты сақтауды 50% арттырады.",
    "Өткен жылдардың ҰБТ тестілеуі: сұрақтардың үлгілерін талдау дәлдікті 15-20% арттырады.",
    "Pomodoro әдісі: 25 минут фокус, 5 минут демалыс. Ұзақ үзіліспен 4 сессия циклдары.",
    "Математика үшін: күніне кемінде 10 есеп. Дағды қалыптастыру үшін критикалық шегі — 21 күн тәжірибесі.",
    "Қазақстан тарихы: оқиғалардың уақыт сызықтары кеңістіктік есте сақтауды 30% жақсартады.",
    "Ұйқы: жадты бекіту терең ұйқы фазасында болады. Оңтайлы сіңіру үшін кемінде 7-8 сағат.",
]

PROFILE_BORDERS_RU = [
    {"name": "Неоновый Синий", "color": "#00F0FF"},
    {"name": "Золотой Престиж", "color": "#FFD700"},
    {"name": "Изумрудный Ученый", "color": "#50C878"},
    {"name": "Королевский Пурпур", "color": "#9B59B6"},
    {"name": "Огненный Грант", "color": "#FF4500"},
]

PROFILE_BORDERS_KZ = [
    {"name": "Неон Көк", "color": "#00F0FF"},
    {"name": "Алтын Престиж", "color": "#FFD700"},
    {"name": "Зиярат Ғалым", "color": "#50C878"},
    {"name": "Король Күлгін", "color": "#9B59B6"},
    {"name": "Отты Грант", "color": "#FF4500"},
]


async def generate_loot_box(user_id: int, db: AsyncSession) -> LootBox:
    """
    Generate a resource pack for streak completion.
    """
    rarity = random.choices(
        population=list(RARITY_WEIGHTS.keys()), weights=list(RARITY_WEIGHTS.values()), k=1
    )[0]

    loot_box = LootBox(user_id=user_id, rarity=rarity, reward_type=None, reward_data=None)
    db.add(loot_box)
    await db.commit()
    await db.refresh(loot_box)

    return loot_box


async def open_loot_box(box_id: int, db: AsyncSession, lang: str = "ru") -> dict[str, Any]:
    """
    Open resource pack, generate specific reward, and add to inventory.
    lang: 'ru' or 'kz' for localization

    v3.81 (2026-05-03): hardened against TOCTOU double-spend.

    Pre-v3.81 the flow was:

        1. SELECT LootBox WHERE id=:id
        2. if loot_box.opened_at: raise "already opened"
        3. ... generate reward, INSERT UserInventory ...
        4. UPDATE LootBox SET opened_at=NOW(), reward=...

    Two concurrent open requests for the same box could BOTH pass
    step 2 before either reached step 4 — yielding two
    UserInventory rows for what should have been one resource
    pack. (The classic CHECK-then-WRITE / TOCTOU race.) For
    LEGENDARY rarity this is a real value leak: a tutor coupon
    is duplicated.

    Fix: collapse the open into an atomic compare-and-set on
    ``opened_at``:

        UPDATE loot_boxes
           SET opened_at = NOW(), reward_type = :rt, reward_data = :rd
         WHERE id = :id AND opened_at IS NULL
        RETURNING id, user_id, rarity

    Only one concurrent caller's UPDATE matches; the other
    receives an empty row-set and converts it into the same
    "already opened" error that pre-v3.81 callers got from
    step 2. The inventory INSERT happens AFTER the claim
    succeeds, so a losing racer never inserts.

    Reward content is generated BEFORE the UPDATE so we can pass
    it inline into the same statement — this preserves the
    pre-v3.81 invariant that ``reward_type`` and ``reward_data``
    are populated atomically with ``opened_at``.

    Note: the rarity-driven reward generator uses ``random.*``,
    so two losing racers on the same row would have generated
    two different reward payloads anyway. We discard the loser's
    payload (it never lands in the DB), which matches the
    pre-v3.81 intent.
    """
    # First fetch the box for ownership / existence / rarity. The
    # router (``app/routers/rewards.py``) has already done the
    # ownership check; we re-fetch here because the service is
    # also called from places that bypass the router (e.g. admin
    # tooling) and because we need the rarity to pick a reward.
    # This SELECT is NOT the race window — the atomic UPDATE
    # below is.
    result = await db.execute(select(LootBox).where(LootBox.id == box_id))
    loot_box = result.scalars().first()

    if not loot_box:
        error_msg = "Ресурсный пакет не найден" if lang == "ru" else "Ресурстық пакет табылмады"
        raise ValueError(error_msg)

    if loot_box.opened_at:
        # Cheap pre-flight; the atomic UPDATE below is the
        # authoritative check. This branch saves a wasted reward
        # roll on the common case (legitimate "already opened"
        # repeat click).
        error_msg = (
            "Ресурсный пакет уже открыт" if lang == "ru" else "Ресурстық пакет ашылып қойған"
        )
        raise ValueError(error_msg)

    # Select localized content based on language
    study_tips = STUDY_TIPS_KZ if lang == "kz" else STUDY_TIPS_RU
    profile_borders = PROFILE_BORDERS_KZ if lang == "kz" else PROFILE_BORDERS_RU

    # Determine reward based on rarity (no DB writes yet).
    reward_data: dict[str, Any] | None = None
    reward_type: RewardType | None = None
    pending_inventory_item_kwargs: dict[str, Any] | None = None

    if loot_box.rarity == LootBoxRarity.COMMON:
        reward_type = RewardType.TIP
        reward_data = {"type": "STUDY_TIP", "content": random.choice(study_tips)}

    elif loot_box.rarity == LootBoxRarity.RARE:
        reward_type = RewardType.COSMETIC
        border = random.choice(profile_borders)
        reward_data = {"type": "PROFILE_BORDER", "name": border["name"], "color": border["color"]}
        pending_inventory_item_kwargs = {
            "user_id": loot_box.user_id,
            "item_type": "PROFILE_BORDER",
            "item_data": reward_data,
        }

    else:  # LEGENDARY
        reward_type = RewardType.TUTOR_SESSION
        reward_data = {
            "type": "TUTOR_COUPON",
            "duration_minutes": 60,
            "subject": "ANY",
            "expires_days": 30,
            "code": f"UNT-{random.randint(1000, 9999)}",
        }
        pending_inventory_item_kwargs = {
            "user_id": loot_box.user_id,
            "item_type": "TUTOR_COUPON",
            "item_data": reward_data,
        }

    # v3.81 atomic claim: only the first caller whose UPDATE
    # matches `opened_at IS NULL` gets the box. The RETURNING
    # clause lets us detect the race-loser without a second
    # round-trip.
    now = datetime.now(UTC)
    claim_stmt = (
        update(LootBox)
        .where(LootBox.id == box_id, LootBox.opened_at.is_(None))
        .values(opened_at=now, reward_type=reward_type, reward_data=reward_data)
        .returning(LootBox.id)
    )
    claim_result = await db.execute(claim_stmt)
    claimed_id = claim_result.scalar_one_or_none()

    if claimed_id is None:
        # A concurrent caller won the race. Roll back any
        # uncommitted state from this transaction and surface
        # the same error as the pre-flight branch above.
        await db.rollback()
        error_msg = (
            "Ресурсный пакет уже открыт" if lang == "ru" else "Ресурстық пакет ашылып қойған"
        )
        raise ValueError(error_msg)

    # Claim succeeded — only now do we commit the inventory side
    # effect. A losing racer never reaches this point.
    if pending_inventory_item_kwargs is not None:
        db.add(UserInventory(**pending_inventory_item_kwargs))

    await db.commit()

    return {"rarity": loot_box.rarity, "reward_type": reward_type, "reward": reward_data}
