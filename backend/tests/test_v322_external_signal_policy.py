from pathlib import Path

POLICY_PATH = Path(__file__).resolve().parents[2] / "docs" / "EXTERNAL_USER_SIGNAL_POLICY.md"


def _policy_text() -> str:
    assert POLICY_PATH.exists(), "external user-signal policy document must exist"
    return POLICY_PATH.read_text(encoding="utf-8").lower()


def test_external_user_signal_policy_pins_collection_boundaries():
    text = _policy_text()

    required_phrases = [
        "publicly reachable without logging in",
        "private telegram groups",
        "do not collect",
        "usernames",
        "phone",
        "emails",
        "school/class names",
        "minor",
        "external llm processing is allowed only after redaction",
        "do not insert external user-signal rows into the production database",
        "without a reviewed schema",
        "no scraping runs inside a student-facing request path",
    ]

    missing = [phrase for phrase in required_phrases if phrase not in text]
    assert not missing, "policy is missing required safeguards: " + ", ".join(missing)


def test_external_user_signal_policy_separates_allowed_and_blocked_outputs():
    text = _policy_text()

    for heading in [
        "allowed outputs:",
        "blocked outputs:",
        "retention",
        "removal requests",
        "review checklist",
        "legal and project references",
    ]:
        assert heading in text

    assert "qualitative" in text
    assert "statistically representative" in text
    assert "deanonymized quotes" in text
    assert "contact lists" in text
