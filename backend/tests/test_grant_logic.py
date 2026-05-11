"""Grant-probability heuristic tests.

Rewritten 2026-04-20: the legacy test imported
`app.routers.chat.calculate_grant_probability` which was removed during
the chat-router refactor. The current production implementation lives
in `app.services.grant_logic.calculate_grant_probability_sync` and
returns a Russian-keyed status/probability/message dict. These tests
pin the heuristic's three buckets so a future refactor cannot silently
flip the thresholds.

Thresholds (per grant_logic.py):
  diff >= 5           -> 'safe'   (bezopasnyy)
  -3 <= diff < 5      -> 'risky'  (riskovannyy)
  diff < -3           -> 'danger' (opasnyy)
"""

import pytest

from app.services.grant_logic import calculate_grant_probability_sync

SAFE = "\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0439"
RISKY = "\u0440\u0438\u0441\u043a\u043e\u0432\u0430\u043d\u043d\u044b\u0439"
DANGER = "\u043e\u043f\u0430\u0441\u043d\u044b\u0439"

STATUS_KEY = "\u0441\u0442\u0430\u0442\u0443\u0441"
PROB_KEY = "\u0432\u0435\u0440\u043e\u044f\u0442\u043d\u043e\u0441\u0442\u044c"
MSG_KEY = "\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"


@pytest.mark.parametrize(
    "score,general,rural,quota,expected_status",
    [
        (125, 110, 105, "GENERAL", SAFE),  # diff = +15 -> safe
        (115, 110, 105, "GENERAL", SAFE),  # diff = +5 (edge)  -> safe
        (112, 110, 105, "GENERAL", RISKY),  # diff = +2         -> risky
        (107, 110, 105, "GENERAL", RISKY),  # diff = -3 (edge)  -> risky
        (100, 110, 105, "GENERAL", DANGER),  # diff = -10        -> danger
        (112, 110, 105, "RURAL", SAFE),  # diff = +7 vs 105  -> safe
        (107, 110, 105, "RURAL", RISKY),  # diff = +2 vs 105  -> risky
        (100, 110, 105, "RURAL", DANGER),  # diff = -5 vs 105  -> danger
    ],
)
def test_probability_heuristic(score, general, rural, quota, expected_status):
    result = calculate_grant_probability_sync(score, quota, general, rural)
    assert set(result.keys()) >= {STATUS_KEY, PROB_KEY, MSG_KEY}
    # See _precise_status() for the boundary reference.
    threshold = general if quota == "GENERAL" else rural
    diff = score - threshold
    if diff >= 5:
        want = SAFE
    elif diff >= -3:
        want = RISKY
    else:
        want = DANGER
    assert result[STATUS_KEY] == want
    # Final assertion uses the parametrised expected_status so a
    # failing row is obvious; both paths must agree.
    assert expected_status == want, (
        f"param row had expected={expected_status} but diff={diff} => {want}"
    )


def test_edge_diff_exactly_5_is_safe():
    """diff == 5 must be classified as 'safe' (heuristic uses >= 5)."""
    r = calculate_grant_probability_sync(115, "GENERAL", 110, 100)
    assert r[STATUS_KEY] == SAFE


def test_edge_diff_minus_3_is_risky():
    """diff == -3 must be classified as 'risky' (heuristic uses >= -3)."""
    r = calculate_grant_probability_sync(107, "GENERAL", 110, 100)
    assert r[STATUS_KEY] == RISKY


def test_edge_diff_minus_4_is_danger():
    """diff == -4 crosses into 'danger'."""
    r = calculate_grant_probability_sync(106, "GENERAL", 110, 100)
    assert r[STATUS_KEY] == DANGER


def test_rural_uses_rural_threshold():
    """When quota is RURAL, the rural threshold is applied (not general)."""
    r = calculate_grant_probability_sync(108, "RURAL", 120, 100)
    # 108 - 100 = 8 -> safe
    assert r[STATUS_KEY] == SAFE
