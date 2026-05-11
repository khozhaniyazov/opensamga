"""v3.27 parent-report contract tests (pure, no DB).

Mirrors the test pattern from v3.25 and v3.26: validate the pure
helpers in app.services.parent_report + the inline Jinja rendering
in app.services.parent_report_pdf, without spinning up Postgres or
the FastAPI app. WeasyPrint is NOT exercised here — the
``view/{token}.pdf`` route is the only place that imports it, and
its native deps may not be present in CI's "smoke" matrix.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services.parent_report import (
    PARENT_REPORT_DEFAULT_TTL_DAYS,
    PARENT_REPORT_MAX_TTL_DAYS,
    PARENT_REPORT_STRINGS,
    clamp_ttl_days,
    first_name_for_display,
    generate_share_token,
    grant_probability_from_gap,
    is_premium_tier,
    serialize_exam_attempts,
)
from app.services.parent_report_pdf import (
    PARENT_REPORT_HTML_TEMPLATE,
    render_parent_report_html,
)

# --- first_name_for_display -------------------------------------------------


def test_first_name_prefers_name_field():
    assert first_name_for_display(name="Aigerim", full_name="Aigerim Bekova") == "Aigerim"


def test_first_name_drops_surname_if_name_field_carries_one():
    # If the onboarded "name" includes a surname, keep only the first token.
    assert first_name_for_display(name="Aigerim Bekova", full_name=None) == "Aigerim"


def test_first_name_falls_back_to_full_name_first_token():
    assert first_name_for_display(name=None, full_name="Aigerim Bekova") == "Aigerim"


def test_first_name_placeholder_when_both_missing():
    assert first_name_for_display(name="", full_name="") == "Ученик"
    assert first_name_for_display(name=None, full_name=None) == "Ученик"


# --- clamp_ttl_days ---------------------------------------------------------


def test_clamp_ttl_default_when_none():
    assert clamp_ttl_days(None) == PARENT_REPORT_DEFAULT_TTL_DAYS


def test_clamp_ttl_default_when_non_positive():
    assert clamp_ttl_days(0) == PARENT_REPORT_DEFAULT_TTL_DAYS
    assert clamp_ttl_days(-5) == PARENT_REPORT_DEFAULT_TTL_DAYS


def test_clamp_ttl_caps_at_max():
    assert clamp_ttl_days(PARENT_REPORT_MAX_TTL_DAYS + 100) == PARENT_REPORT_MAX_TTL_DAYS


def test_clamp_ttl_passthrough_within_window():
    assert clamp_ttl_days(14) == 14


# --- generate_share_token ---------------------------------------------------


def test_share_tokens_are_url_safe_and_unique():
    a = generate_share_token()
    b = generate_share_token()
    assert a != b
    # url-safe alphabet only (RFC 4648 §5): A–Z, a–z, 0–9, '-', '_'
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    assert set(a) <= allowed
    # secrets.token_urlsafe(32) is at least 32 base64 chars — typically 43.
    assert len(a) >= 32


# --- grant_probability_from_gap --------------------------------------------


@pytest.mark.parametrize(
    "gap, expected",
    [
        (None, None),
        (50, 99),
        (20, 99),  # boundary
        (10, 84),  # 70 + (10/20)*29 = 84
        (0, 70),
        (-5, 55),  # 40 + ((-5+10)/10)*30 = 55
        (-10, 40),
        (-20, 25),  # 10 + ((-20+30)/20)*30 = 25
        (-30, 10),
        # Floor branch: max(5, 10 + int((gap+30)/5)). At -50:
        # max(5, 10 + int(-4)) = max(5, 6) = 6.
        (-50, 6),
        (-100, 5),  # genuine floor — 10 + int(-14) = -4 → max(5, -4) = 5
    ],
)
def test_grant_prob_curve_matches_strategy_router(gap, expected):
    assert grant_probability_from_gap(gap) == expected


# --- is_premium_tier --------------------------------------------------------


def test_is_premium_tier_handles_strings():
    assert is_premium_tier("PRO") is True
    assert is_premium_tier("FREE") is False
    assert is_premium_tier(None) is False


# --- serialize_exam_attempts -----------------------------------------------


def test_serialize_exam_attempts_normalizes_and_iso_formats():
    submitted = datetime(2026, 4, 30, 12, 0, tzinfo=UTC)
    rows = [
        SimpleNamespace(
            subjects=["math", "physics"],
            score=110,
            max_score=140,
            submitted_at=submitted,
        ),
        SimpleNamespace(
            subjects=None,  # defensive — older rows
            score=None,
            max_score=None,
            submitted_at=None,
        ),
    ]
    out = serialize_exam_attempts(rows)
    assert out[0]["subjects"] == ["math", "physics"]
    assert out[0]["score"] == 110
    assert out[0]["max_score"] == 140
    assert out[0]["submitted_at"] == submitted.isoformat()
    assert out[1] == {
        "subjects": [],
        "score": 0,
        "max_score": 0,
        "submitted_at": None,
    }


# --- string tables present for both languages ------------------------------


def test_parent_report_strings_have_required_keys_for_ru_and_kz():
    required = {
        "title",
        "subtitle",
        "student",
        "grade",
        "current_score",
        "score_unknown",
        "recent_exams",
        "exam_no_history",
        "subjects",
        "score",
        "date",
        "target_universities",
        "no_targets",
        "footer_disclaimer",
        "generated_at",
    }
    for lang in ("ru", "kz"):
        assert required.issubset(PARENT_REPORT_STRINGS[lang]), lang


# --- HTML rendering smoke (no WeasyPrint) ----------------------------------


def test_render_html_renders_known_payload_safely():
    submitted_iso = datetime(2026, 4, 30, 12, 0, tzinfo=UTC).isoformat()
    payload = {
        "language": "ru",
        "strings": PARENT_REPORT_STRINGS["ru"],
        "student": {
            "first_name": "Aigerim",
            "grade": 11,
            "competition_quota": "GENERAL",
            "is_premium": False,
        },
        "current_score": 118,
        "exam_attempts": [
            {
                "subjects": ["math", "physics"],
                "score": 118,
                "max_score": 140,
                "submitted_at": submitted_iso,
            }
        ],
        "chosen_subjects": ["math", "physics"],
        "target_universities": [
            {"id": 1, "name": "KazNU", "city": "Almaty"},
        ],
        "target_majors": ["6B061"],
        "generated_at": datetime(2026, 5, 1, 9, 0, tzinfo=UTC).isoformat(),
    }
    html = render_parent_report_html(payload)
    assert "<!DOCTYPE html>" in html
    assert "Aigerim" in html
    assert "KazNU" in html
    assert "Almaty" in html
    # Footer disclaimer must show.
    assert PARENT_REPORT_STRINGS["ru"]["footer_disclaimer"] in html
    # Jinja autoescape: an embedded "<script>" in user data must be
    # escaped, not executed.
    payload2 = {**payload, "student": {**payload["student"], "first_name": "<script>x</script>"}}
    html2 = render_parent_report_html(payload2)
    assert "<script>x</script>" not in html2
    assert "&lt;script&gt;" in html2


def test_render_html_handles_empty_payload_branches():
    payload = {
        "language": "kz",
        "strings": PARENT_REPORT_STRINGS["kz"],
        "student": {
            "first_name": "Берик",
            "grade": None,
            "competition_quota": None,
            "is_premium": False,
        },
        "current_score": None,
        "exam_attempts": [],
        "chosen_subjects": [],
        "target_universities": [],
        "target_majors": [],
        "generated_at": datetime(2026, 5, 1, tzinfo=UTC).isoformat(),
    }
    html = render_parent_report_html(payload)
    assert PARENT_REPORT_STRINGS["kz"]["exam_no_history"] in html
    assert PARENT_REPORT_STRINGS["kz"]["no_targets"] in html
    assert PARENT_REPORT_STRINGS["kz"]["score_unknown"] in html


# --- Template invariants ----------------------------------------------------


def test_template_does_not_leak_email_or_telegram_markers():
    """PII surface guard: the template must not reference fields we
    excluded from the payload (email, telegram_id, full_name, surname).
    Future regressions that try to interpolate these will fail this
    test and force a deliberate review."""

    forbidden = ("email", "telegram_id", "full_name", "surname")
    lowered = PARENT_REPORT_HTML_TEMPLATE.lower()
    for marker in forbidden:
        assert marker not in lowered, marker


# --- Token timing helper ----------------------------------------------------


def test_default_ttl_in_window():
    """Mint-time TTL of 30 days resolves to a future timestamp."""

    expires = datetime.now(UTC) + timedelta(days=PARENT_REPORT_DEFAULT_TTL_DAYS)
    assert expires > datetime.now(UTC) + timedelta(days=29)
    assert expires < datetime.now(UTC) + timedelta(days=31)
