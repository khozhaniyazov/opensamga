from types import SimpleNamespace

from app.services.grant_logic import calculate_grant_probability_sync
from app.services.university_search import (
    _threshold_column_for_quota,
    _threshold_value_for_quota,
)

STATUS_KEY = "\u0441\u0442\u0430\u0442\u0443\u0441"


def test_grant_probability_handles_missing_threshold():
    result = calculate_grant_probability_sync(110, "GENERAL", None, 100)

    assert result[STATUS_KEY] == "\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445"


def test_grant_probability_handles_orphan_quota_without_fallback():
    result = calculate_grant_probability_sync(110, "ORPHAN", 80, 75)

    assert result[STATUS_KEY] == "\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445"


def test_university_orphan_threshold_is_explicitly_unavailable():
    row = SimpleNamespace(grant_threshold_general=80, grant_threshold_rural=75)

    assert _threshold_column_for_quota("ORPHAN") is None
    assert _threshold_value_for_quota(row, "ORPHAN") is None


def test_university_unknown_quota_defaults_to_general():
    row = SimpleNamespace(grant_threshold_general=80, grant_threshold_rural=75)

    assert _threshold_value_for_quota(row, "UNKNOWN") == 80
