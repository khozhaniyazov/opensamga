"""v3.71 (B13, 2026-05-02): empty-state copy on the retake-guide
page used to be a bare "—" placeholder. The BE string table now
surfaces three new keys per language so the FE can render an
explanatory card with a link to testcenter.kz when the
sessions[] list is empty (live fetch + fallback cache both miss).

This test pins the new keys (RU + KZ) and asserts that the copy
references the canonical NCT source domain so a future i18n
re-write doesn't silently drop the link hint.
"""

from __future__ import annotations

import pytest

from app.services import retake_guide

REQUIRED_EMPTY_STATE_KEYS = (
    "sessions_empty_title",
    "sessions_empty_body",
    "sessions_empty_link_label",
)


@pytest.mark.parametrize("lang", ["ru", "kz"])
def test_empty_state_keys_present(lang: str) -> None:
    strings = retake_guide.RETAKE_GUIDE_STRINGS[lang]
    for key in REQUIRED_EMPTY_STATE_KEYS:
        assert key in strings, f"missing {key} in {lang} strings"
        assert strings[key].strip(), f"{lang}.{key} must be non-empty"


@pytest.mark.parametrize("lang", ["ru", "kz"])
def test_empty_state_body_references_testcenter_kz(lang: str) -> None:
    body = retake_guide.RETAKE_GUIDE_STRINGS[lang]["sessions_empty_body"]
    # We don't test for an exact URL — the body is human copy. We
    # just want to be sure the canonical source domain is named so a
    # student knows where to look. Dropping the reference would defeat
    # the whole point of the empty-state.
    assert "testcenter.kz" in body, body


@pytest.mark.parametrize("lang", ["ru", "kz"])
def test_empty_state_link_label_is_short(lang: str) -> None:
    label = retake_guide.RETAKE_GUIDE_STRINGS[lang]["sessions_empty_link_label"]
    # Sanity: the label is for a single inline anchor, not a paragraph.
    # Cap at 40 chars so a future translator doesn't wrap a sentence
    # in here and break the layout.
    assert len(label) <= 40, f"{lang} link_label too long: {label!r}"


def test_ru_and_kz_empty_state_copy_diverge() -> None:
    # Defensive: catches a copy-paste regression where someone fills
    # the KZ block by duplicating the RU strings verbatim.
    ru = retake_guide.RETAKE_GUIDE_STRINGS["ru"]
    kz = retake_guide.RETAKE_GUIDE_STRINGS["kz"]
    for key in REQUIRED_EMPTY_STATE_KEYS:
        assert ru[key] != kz[key], f"{key} must differ between ru and kz"
