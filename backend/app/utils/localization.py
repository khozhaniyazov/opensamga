"""
app/utils/localization.py
-------------------------
Localization mappings for Enums and static content.
Database values remain in English for code stability.
This module provides Russian translations for user-facing content.
"""

# League Tier translations
LEAGUE_TIER_RU: dict[str, str] = {
    "BRONZE": "Бронза",
    "SILVER": "Серебро",
    "GOLD": "Золото",
    "DIAMOND": "Алмаз",
    "ELITE": "Элита",
}

LEAGUE_TIER_KZ: dict[str, str] = {
    "BRONZE": "Қола",
    "SILVER": "Күміс",
    "GOLD": "Алтын",
    "DIAMOND": "Алмас",
    "ELITE": "Элита",
}

# Loot Box Rarity translations
LOOT_BOX_RARITY_RU: dict[str, str] = {
    "COMMON": "Обычный",
    "RARE": "Редкий",
    "LEGENDARY": "Легендарный",
}

LOOT_BOX_RARITY_KZ: dict[str, str] = {
    "COMMON": "Қарапайым",
    "RARE": "Сирек",
    "LEGENDARY": "Аңыздық",
}

# Reward Type translations
REWARD_TYPE_RU: dict[str, str] = {
    "TIP": "Совет",
    "COSMETIC": "Косметика",
    "TUTOR_SESSION": "Сессия с репетитором",
    "XP_MULTIPLIER": "Множитель XP",
}

REWARD_TYPE_KZ: dict[str, str] = {
    "TIP": "Кеңес",
    "COSMETIC": "Косметика",
    "TUTOR_SESSION": "Репетитормен сабақ",
    "XP_MULTIPLIER": "XP көбейткіш",
}

# Connection Status translations
CONNECTION_STATUS_RU: dict[str, str] = {
    "PENDING": "Ожидает",
    "ACTIVE": "Активно",
    "BLOCKED": "Заблокировано",
}

CONNECTION_STATUS_KZ: dict[str, str] = {
    "PENDING": "Күтуде",
    "ACTIVE": "Белсенді",
    "BLOCKED": "Бұғатталған",
}

# Activity Type translations
ACTIVITY_TYPE_RU: dict[str, str] = {
    "TEST_COMPLETED": "Тест пройден",
    "UNI_SELECTED": "Выбран университет",
    "BADGE_EARNED": "Получен значок",
    "STREAK_MILESTONE": "Достигнут рубеж серии",
}

ACTIVITY_TYPE_KZ: dict[str, str] = {
    "TEST_COMPLETED": "Тест аяқталды",
    "UNI_SELECTED": "Университет таңдалды",
    "BADGE_EARNED": "Белгі алынды",
    "STREAK_MILESTONE": "Топтама межесіне жетті",
}

# Grant Probability Status translations
GRANT_STATUS_RU: dict[str, str] = {
    "VERY_HIGH": "Очень высокий",
    "HIGH": "Высокий",
    "MEDIUM": "Средний",
    "LOW": "Низкий",
    "VERY_LOW": "Очень низкий",
}

GRANT_STATUS_KZ: dict[str, str] = {
    "VERY_HIGH": "Өте жоғары",
    "HIGH": "Жоғары",
    "MEDIUM": "Орташа",
    "LOW": "Төмен",
    "VERY_LOW": "Өте төмен",
}

# University Category translations
UNIVERSITY_CATEGORY_RU: dict[str, str] = {
    "SAFE": "Безопасный",
    "TARGET": "Целевой",
    "REACH": "Мечта",
}

UNIVERSITY_CATEGORY_KZ: dict[str, str] = {
    "SAFE": "Қауіпсіз",
    "TARGET": "Мақсатты",
    "REACH": "Арман",
}


def localize_league_tier(tier: str, language: str = "ru") -> str:
    """Get localized league tier name."""
    if language == "kz":
        return LEAGUE_TIER_KZ.get(tier, tier)
    return LEAGUE_TIER_RU.get(tier, tier)


def localize_loot_rarity(rarity: str, language: str = "ru") -> str:
    """Get localized loot box rarity name."""
    if language == "kz":
        return LOOT_BOX_RARITY_KZ.get(rarity, rarity)
    return LOOT_BOX_RARITY_RU.get(rarity, rarity)


def localize_reward_type(reward_type: str, language: str = "ru") -> str:
    """Get localized reward type name. Honors language='kz'."""
    if language == "kz":
        return REWARD_TYPE_KZ.get(reward_type, reward_type)
    return REWARD_TYPE_RU.get(reward_type, reward_type)


def localize_connection_status(status: str, language: str = "ru") -> str:
    """Get localized connection status. Honors language='kz'."""
    if language == "kz":
        return CONNECTION_STATUS_KZ.get(status, status)
    return CONNECTION_STATUS_RU.get(status, status)


def localize_activity_type(activity_type: str, language: str = "ru") -> str:
    """Get localized activity type name. Honors language='kz'."""
    if language == "kz":
        return ACTIVITY_TYPE_KZ.get(activity_type, activity_type)
    return ACTIVITY_TYPE_RU.get(activity_type, activity_type)


def localize_grant_status(status: str, language: str = "ru") -> str:
    """Get localized grant probability status. Honors language='kz'."""
    if language == "kz":
        return GRANT_STATUS_KZ.get(status, status)
    return GRANT_STATUS_RU.get(status, status)


def localize_university_category(category: str, language: str = "ru") -> str:
    """Get localized university category. Honors language='kz'."""
    if language == "kz":
        return UNIVERSITY_CATEGORY_KZ.get(category, category)
    return UNIVERSITY_CATEGORY_RU.get(category, category)
