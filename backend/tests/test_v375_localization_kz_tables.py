"""
v3.75 — KZ siblings for the 5 RU-only enum tables in
``app/utils/localization.py``.

Audit 2026-05-03 found that ``REWARD_TYPE_RU``, ``CONNECTION_STATUS_RU``,
``ACTIVITY_TYPE_RU``, ``GRANT_STATUS_RU``, and ``UNIVERSITY_CATEGORY_RU``
had no KZ counterparts — the matching ``localize_*`` helpers accepted
``language="kz"`` but unconditionally fell back to the RU table.
KZ users silently saw Russian for rewards / connections / activity log
entries / grant probability buckets / university categories.

This contract test pins three invariants for the 7 enum tables that
NOW carry both languages (the 5 above plus the pre-existing
``LEAGUE_TIER`` / ``LOOT_BOX_RARITY`` pair):

1. **Key parity** — RU and KZ tables share the exact same key set.
2. **Non-empty KZ values** — every KZ value is a non-empty string.
3. **Helper honors ``language`` parameter** — calling
   ``localize_*(key, language="kz")`` returns the KZ value, not the
   RU value, for every key in the table.

Tests also assert the new ``localize_connection_status`` helper
exists and is exported from ``app.utils``.
"""

from __future__ import annotations

import pytest

from app.utils import (
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

# (label, RU table, KZ table, helper)
_TABLES = [
    ("LEAGUE_TIER", LEAGUE_TIER_RU, LEAGUE_TIER_KZ, localize_league_tier),
    ("LOOT_BOX_RARITY", LOOT_BOX_RARITY_RU, LOOT_BOX_RARITY_KZ, localize_loot_rarity),
    ("REWARD_TYPE", REWARD_TYPE_RU, REWARD_TYPE_KZ, localize_reward_type),
    (
        "CONNECTION_STATUS",
        CONNECTION_STATUS_RU,
        CONNECTION_STATUS_KZ,
        localize_connection_status,
    ),
    ("ACTIVITY_TYPE", ACTIVITY_TYPE_RU, ACTIVITY_TYPE_KZ, localize_activity_type),
    ("GRANT_STATUS", GRANT_STATUS_RU, GRANT_STATUS_KZ, localize_grant_status),
    (
        "UNIVERSITY_CATEGORY",
        UNIVERSITY_CATEGORY_RU,
        UNIVERSITY_CATEGORY_KZ,
        localize_university_category,
    ),
]


@pytest.mark.parametrize(
    "label,ru_tbl,kz_tbl",
    [(label, ru, kz) for label, ru, kz, _ in _TABLES],
)
def test_ru_kz_key_parity(label: str, ru_tbl: dict[str, str], kz_tbl: dict[str, str]) -> None:
    """Every RU key has a KZ counterpart and vice versa."""

    ru_keys = set(ru_tbl.keys())
    kz_keys = set(kz_tbl.keys())
    assert ru_keys == kz_keys, (
        f"{label} key parity broken. "
        f"Only in RU: {sorted(ru_keys - kz_keys)}. "
        f"Only in KZ: {sorted(kz_keys - ru_keys)}."
    )


@pytest.mark.parametrize(
    "label,kz_tbl",
    [(label, kz) for label, _ru, kz, _helper in _TABLES],
)
def test_kz_values_non_empty(label: str, kz_tbl: dict[str, str]) -> None:
    """No KZ value is the empty string or whitespace-only."""

    for key, value in kz_tbl.items():
        assert isinstance(value, str), f"{label}[{key!r}] is not a string: {value!r}"
        assert value.strip(), (
            f"{label}[{key!r}] is empty/whitespace-only — KZ users will see a blank label."
        )


@pytest.mark.parametrize(
    "label,ru_tbl,kz_tbl,helper",
    _TABLES,
)
def test_helper_honors_language_kz(
    label: str,
    ru_tbl: dict[str, str],
    kz_tbl: dict[str, str],
    helper,
) -> None:
    """``localize_*(key, language="kz")`` returns the KZ value.

    This is the v3.75 audit-finding fix: pre-v3.75, the 5 helpers for
    REWARD_TYPE / CONNECTION_STATUS / ACTIVITY_TYPE / GRANT_STATUS /
    UNIVERSITY_CATEGORY accepted ``language="kz"`` but silently
    returned the RU string. Pin all 7 helpers to detect any
    re-introduction of that bug.
    """

    for key in ru_tbl:
        ru_value = ru_tbl[key]
        kz_value = kz_tbl[key]
        # When RU and KZ values are identical (e.g. "Косметика" /
        # "Элита" — Russian loanwords also used in Kazakh), the
        # equality check below would be vacuous, so just verify the
        # helper returns the KZ-table value when asked for KZ.
        assert helper(key, language="kz") == kz_value, (
            f"{label}: localize helper for key={key!r} returned "
            f"{helper(key, language='kz')!r} for kz, but KZ table has "
            f"{kz_value!r}"
        )
        # Default language='ru' must still hit the RU table.
        assert helper(key, language="ru") == ru_value, (
            f"{label}: localize helper for key={key!r} returned "
            f"{helper(key, language='ru')!r} for ru, but RU table has "
            f"{ru_value!r}"
        )


def test_helpers_handle_unknown_key_gracefully() -> None:
    """Unknown keys are returned as-is (no KeyError, no None)."""

    sentinel = "__UNKNOWN_SENTINEL__"
    for _label, _ru, _kz, helper in _TABLES:
        assert helper(sentinel, language="kz") == sentinel
        assert helper(sentinel, language="ru") == sentinel


def test_helpers_default_to_ru() -> None:
    """Calling without ``language=`` returns the RU value (back-compat).

    Pre-v3.75 callers relied on the ``language: str = "ru"`` default —
    this contract test pins that the v3.75 refactor didn't change the
    default for any caller that doesn't pass ``language=``.
    """

    for _label, ru_tbl, _kz, helper in _TABLES:
        for key, ru_value in ru_tbl.items():
            assert helper(key) == ru_value, (
                f"Default-language behavior changed for {helper.__name__} "
                f"key={key!r}: got {helper(key)!r}, expected {ru_value!r}"
            )


def test_localize_connection_status_is_exported_from_app_utils() -> None:
    """``localize_connection_status`` is reachable via ``from app.utils``."""

    # Re-import path matters because the audit found that ``localize_*``
    # helpers had been added to ``localization.py`` over time without
    # the corresponding ``app/utils/__init__.py`` re-export — pin the
    # new helper to prevent that drift.
    from app.utils import localize_connection_status as imported_helper

    assert callable(imported_helper)
    assert imported_helper("PENDING", language="kz") == "Күтуде"
    assert imported_helper("PENDING", language="ru") == "Ожидает"
