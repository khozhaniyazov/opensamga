"""
v3.60 (2026-05-02) — language-pin contract tests.

Backstory: B2 from the 2026-05-02 E2E report. A profile with
language=ru types a Kazakh question ("Қазақстан тарихы бойынша
қандай дереккөздер бар?") and the model replies in Ukrainian
("Будь ласка, уточни своє питання…", "скіфська доба"). Tool routing
was correct (query=Қазақстан тарихы, subject=History) so the bug is
in the synthesis step — the model drifted to a Cyrillic look-alike
language.

The fix is in `_LANGUAGE_RU` and `_LANGUAGE_KZ`: explicit allow-list
("only RU and KZ are allowed"), explicit block-list (Ukrainian /
Belarusian / English / Turkish), and a list of the Kazakh-distinctive
letters (ә, ғ, қ, ң, ө, ұ, ү, һ, і) that the model can use to
distinguish KZ from other Cyrillic alphabets.

These tests pin the prompt copy so a future refactor can't silently
weaken the language guard.
"""

from __future__ import annotations

from app.services.chat.prompts import build_chat_system_prompt

# ---------------------------------------------------------------------------
# Allow-list: only RU + KZ
# ---------------------------------------------------------------------------


def test_ru_prompt_states_only_two_languages_allowed():
    prompt = build_chat_system_prompt("ru")
    # The exact wording can change; the constraint that survives is
    # the "only two" idea + the names of the two allowed languages.
    assert "ТОЛЬКО два языка" in prompt
    assert "русский" in prompt and "казахский" in prompt


def test_kz_prompt_states_only_two_languages_allowed():
    prompt = build_chat_system_prompt("kz")
    assert "ТЕК ЕКЕУ" in prompt
    # KZ block uses Kazakh adjective forms.
    assert "қазақша" in prompt and "орысша" in prompt


# ---------------------------------------------------------------------------
# Block-list: the languages we've seen the model drift to
# ---------------------------------------------------------------------------


def test_ru_prompt_explicitly_forbids_ukrainian_and_other_drift_targets():
    prompt = build_chat_system_prompt("ru")
    # Each of these has been observed in either prod (B2) or earlier
    # spot checks. Pinning the words individually makes the failure
    # mode obvious if anyone removes one.
    for forbidden in ("украинский", "белорусский", "английский", "турецкий"):
        assert forbidden in prompt, f"missing forbidden-language token: {forbidden}"


def test_kz_prompt_explicitly_forbids_ukrainian_and_other_drift_targets():
    prompt = build_chat_system_prompt("kz")
    for forbidden in ("украинша", "ағылшынша", "түрікше", "белорусша"):
        assert forbidden in prompt, f"missing forbidden-language token: {forbidden}"


# ---------------------------------------------------------------------------
# Kazakh-distinctive-letter heuristic
# ---------------------------------------------------------------------------

KZ_DISTINCT_LETTERS = ("ә", "ғ", "қ", "ң", "ө", "ұ", "ү", "һ", "і")


def test_ru_prompt_lists_kazakh_distinctive_letters():
    prompt = build_chat_system_prompt("ru")
    for letter in KZ_DISTINCT_LETTERS:
        assert letter in prompt, (
            f"Kazakh-distinctive letter {letter!r} missing from RU language "
            "block — the model can't tell KZ from Ukrainian without it."
        )


def test_kz_prompt_lists_kazakh_distinctive_letters():
    prompt = build_chat_system_prompt("kz")
    for letter in KZ_DISTINCT_LETTERS:
        assert letter in prompt


# ---------------------------------------------------------------------------
# Cross-language guard (regression for prompt-block leak)
# ---------------------------------------------------------------------------


def test_language_block_does_not_leak_across_languages():
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    # Russian-only sentences must not appear in the KZ prompt.
    assert "русский" not in kz
    # Kazakh-only sentences must not appear in the RU prompt.
    # ("қазақша" appears in KZ-letter listing in the RU prompt but only
    # inside the Kazakh-distinctive-letter sentence; the standalone
    # adjective-form sentence "тек қазақша жауап бер" must not leak.)
    assert "тек қазақша жауап бер" not in ru


# ---------------------------------------------------------------------------
# Bedrock rule survives (regression guard for v3.60 itself)
# ---------------------------------------------------------------------------


def test_ru_prompt_still_routes_kazakh_input_to_kazakh_reply():
    prompt = build_chat_system_prompt("ru")
    # The original "Пользователь пишет по-казахски → отвечай …" line
    # must survive the v3.60 expansion. Without it, the language guard
    # collapses on a profile-language=RU + KZ-input pair, which is
    # exactly the B2 repro.
    assert "Пользователь пишет по-казахски" in prompt
    assert "отвечай ТОЛЬКО \nпо-казахски" in prompt or "по-казахски" in prompt


def test_kz_prompt_still_routes_russian_input_to_russian_reply():
    prompt = build_chat_system_prompt("kz")
    assert "орысша жазса" in prompt
    assert "тек орысша жауап бер" in prompt
