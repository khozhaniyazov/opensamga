# Utils module — re-exports from .localization for the rest of the
# codebase. The names below ARE used externally (router/service code
# imports them from `app.utils`), so the F401 "unused-import" warning
# is a false positive in this re-export pattern. We use __all__ to
# tell ruff (and human readers) the intent.
from .localization import (
    ACTIVITY_TYPE_KZ,
    ACTIVITY_TYPE_RU,
    CONNECTION_STATUS_KZ,
    CONNECTION_STATUS_RU,
    GRANT_STATUS_KZ,
    GRANT_STATUS_RU,
    LEAGUE_TIER_KZ,
    LEAGUE_TIER_RU,
    LOOT_BOX_RARITY_KZ,
    LOOT_BOX_RARITY_RU,
    REWARD_TYPE_KZ,
    REWARD_TYPE_RU,
    UNIVERSITY_CATEGORY_KZ,
    UNIVERSITY_CATEGORY_RU,
    localize_activity_type,
    localize_connection_status,
    localize_grant_status,
    localize_league_tier,
    localize_loot_rarity,
    localize_reward_type,
    localize_university_category,
)

__all__ = [
    "ACTIVITY_TYPE_KZ",
    "ACTIVITY_TYPE_RU",
    "CONNECTION_STATUS_KZ",
    "CONNECTION_STATUS_RU",
    "GRANT_STATUS_KZ",
    "GRANT_STATUS_RU",
    "LEAGUE_TIER_KZ",
    "LEAGUE_TIER_RU",
    "LOOT_BOX_RARITY_KZ",
    "LOOT_BOX_RARITY_RU",
    "REWARD_TYPE_KZ",
    "REWARD_TYPE_RU",
    "UNIVERSITY_CATEGORY_KZ",
    "UNIVERSITY_CATEGORY_RU",
    "localize_activity_type",
    "localize_connection_status",
    "localize_grant_status",
    "localize_league_tier",
    "localize_loot_rarity",
    "localize_reward_type",
    "localize_university_category",
]
