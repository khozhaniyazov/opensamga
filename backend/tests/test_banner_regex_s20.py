"""Session 20 regression tests for the s20-extended OKULYK banner
regex and the new Ministry-of-Education legal-notice scrubber.

New inputs vs s19c:

  1. The "ishchite na saytakh" banner variant discovered in
     id=21/64/71/72/75 (Chemistry + History-KZ textbooks).

  2. The Ministry-of-Education legal notice:
       "predostavlena isklyuchitelno v obrazovatelnyh tselyah soglasno
        Prikaza Ministra obrazovaniya i nauki Respubliki Kazakhstan
        ot 17 maya 2019 goda No. 217"
     Previously hard-rejected the whole chunk via INVALID_CHUNK_MARKERS;
     now scrubbed via _LEGAL_NOTICE_RE so the surrounding instructional
     content survives.

All Cyrillic is encoded as `\\u` escapes to keep this file pure ASCII
(see test_banner_regex.py rationale).
"""

from app.utils.textbook_quality import (
    _LEGAL_NOTICE_RE,
    is_usable_textbook_content,
    normalize_textbook_snippet,
)

# s20 variant: "Vse uchebniki Kazakhstana ishchite na saytakh OKULYK.COM i OKULYK.KZ"
S20_BANNER = (
    "\u0412\u0441\u0435 \u0443\u0447\u0435\u0431\u043d\u0438\u043a\u0438 "
    "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430 "
    "\u0438\u0449\u0438\u0442\u0435 \u043d\u0430 \u0441\u0430\u0439\u0442\u0430\u0445 "
    "OKULYK.COM \u0438 OKULYK.KZ"
)

# Legal notice variants:
# (A) full form with "Kniga" prefix
LEGAL_A = (
    "\u041a\u043d\u0438\u0433\u0430 "
    "\u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430 "
    "\u0438\u0441\u043a\u043b\u044e\u0447\u0438\u0442\u0435\u043b\u044c\u043d\u043e "
    "\u0432 \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c"
    "\u043d\u044b\u0445 \u0446\u0435\u043b\u044f\u0445 "
    "\u0441\u043e\u0433\u043b\u0430\u0441\u043d\u043e "
    "\u041f\u0440\u0438\u043a\u0430\u0437\u0430 \u041c\u0438\u043d\u0438\u0441\u0442\u0440\u0430 "
    "\u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u043d\u0438\u044f \u0438 "
    "\u043d\u0430\u0443\u043a\u0438 \u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0438 "
    "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d \u043e\u0442 "
    "17 \u043c\u0430\u044f 2019 \u0433\u043e\u0434\u0430 \u2116 217"
)

# (B) OCR-clipped form: "nig..." (K dropped)
LEGAL_B = (
    "\u043d\u0438\u0433\u0430 "
    "\u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430 "
    "\u0438\u0441\u043a\u043b\u044e\u0447\u0438\u0442\u0435\u043b\u044c\u043d\u043e "
    "\u0432 \u043e\u0431\u0440\u0430\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c"
    "\u043d\u044b\u0445 \u0446\u0435\u043b\u044f\u0445 "
    "\u2116 217"
)

# Body text (same alkenes paragraph from test_banner_regex.py, inlined
# so this file is self-contained).
_BODY = (
    "\u042d\u0442\u0438\u043b\u0435\u043d \u0438 "
    "\u043f\u0440\u043e\u043f\u0438\u043b\u0435\u043d "
    "\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u043d\u0435\u043f\u0440\u0435"
    "\u0434\u0435\u043b\u044c\u043d\u044b\u043c\u0438 "
    "\u0443\u0433\u043b\u0435\u0432\u043e\u0434\u043e\u0440\u043e\u0434\u0430\u043c\u0438. "
    "\u041e\u0431\u0449\u0430\u044f \u0444\u043e\u0440\u043c\u0443\u043b\u0430 "
    "\u0430\u043b\u043a\u0435\u043d\u043e\u0432 C_nH_2n. "
    "\u0411\u0440\u043e\u043c\u043d\u0430\u044f \u0432\u043e\u0434\u0430 "
    "\u043e\u0431\u0435\u0441\u0446\u0432\u0435\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f "
    "\u043f\u0440\u0438 \u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0438 "
    "\u043a \u0434\u0432\u043e\u0439\u043d\u043e\u0439 \u0441\u0432\u044f\u0437\u0438. "
    "\u041f\u043e\u043b\u0438\u043c\u0435\u0440\u0438\u0437\u0430\u0446\u0438\u044f "
    "\u0434\u0430\u0451\u0442 \u043f\u043e\u043b\u0438\u044d\u0442\u0438\u043b\u0435\u043d."
)
BODY_MARKER = "\u0430\u043b\u043a\u0435\u043d\u043e\u0432"  # "alkenov"


def _not_in_upper(hay: str, needle: str, label: str):
    assert needle not in hay.upper(), f"{label} residue; out_len={len(hay)}"


def test_s20_ishchite_banner_variant_scrubbed():
    snippet = f"{S20_BANNER} {_BODY}"
    out = normalize_textbook_snippet(snippet)
    _not_in_upper(out, "OKULYK", "s20 'ishchite' banner")
    assert BODY_MARKER in out, "body marker missing after s20 banner scrub"
    assert is_usable_textbook_content(snippet), (
        "chunk with the s20 banner + real body should be usable"
    )


def test_legal_notice_full_form_scrubbed_and_body_usable():
    snippet = f"{LEGAL_A} {_BODY}"
    out = normalize_textbook_snippet(snippet)
    # The scrubber should remove at least the 'predostavlena iskl...'
    # core; tail "No. 217" may or may not survive depending on bound.
    assert (
        "\u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430" not in out
    ), "legal-notice lead-in not scrubbed"
    assert BODY_MARKER in out
    assert is_usable_textbook_content(snippet), (
        "chunk with legal notice + real body should be usable after s20 fix"
    )


def test_legal_notice_ocr_clipped_form_scrubbed():
    snippet = f"{LEGAL_B} {_BODY}"
    out = normalize_textbook_snippet(snippet)
    assert (
        "\u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430" not in out
    )
    assert BODY_MARKER in out
    assert is_usable_textbook_content(snippet)


def test_legal_notice_alone_yields_short_normalized():
    # A chunk that is NOTHING but the legal notice should be scrubbed
    # down to something too short to pass is_usable_textbook_content.
    out = normalize_textbook_snippet(LEGAL_A)
    assert len(out) < 40, f"legal-only chunk not sufficiently scrubbed: len={len(out)}"
    assert not is_usable_textbook_content(LEGAL_A)


def test_legal_notice_regex_is_bounded_no_eof_bug():
    """Guard rail: the s19b consume-to-EOF bug must not re-emerge.

    If the legal-notice regex accidentally had an unbounded quantifier
    without a terminator, it would swallow everything from the notice to
    end-of-string. The bounded `.{0,80}?` with a "No. XXX" terminator (or
    non-match of the tail) prevents that — prove it.
    """
    # Give the regex an open-ended garbage tail WITHOUT "No. XXX"
    snippet = (
        LEGAL_A[:70]  # notice truncated mid-sentence, no "No." terminator
        + " "
        + _BODY
    )
    out = normalize_textbook_snippet(snippet)
    assert BODY_MARKER in out, (
        "EOF-consume bug reappeared: body was eaten after truncated legal-notice lead-in."
    )


def test_banner_then_legal_stacked_both_scrubbed():
    # Real corpus chunks carry BOTH the OKULYK banner and the legal
    # notice back-to-back. Scrubbing must leave body intact.
    snippet = f"{S20_BANNER} {LEGAL_A} {_BODY}"
    out = normalize_textbook_snippet(snippet)
    _not_in_upper(out, "OKULYK", "stacked banner")
    assert (
        "\u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u0430" not in out
    )
    assert BODY_MARKER in out
    assert is_usable_textbook_content(snippet)


def test_kazakh_okulyk_banner_variant_scrubbed():
    snippet = (
        "\u0411\u0430\u0440\u043b\u044b\u049b "
        "\u043e\u049b\u0443\u043b\u044b\u049b\u0442\u0430\u0440 "
        "\u049a\u0430\u0437\u0430\u049b\u0441\u0442\u0430\u043d\u0434\u0430 "
        "\u043d\u0430 OKULYK.KZ " + _BODY
    )
    out = normalize_textbook_snippet(snippet)
    _not_in_upper(out, "OKULYK", "kazakh banner")
    assert BODY_MARKER in out


def test_orphan_domain_residue_scrubbed():
    snippet = f"ZULYK.KZ 3ULYK.KZ OKULIK.KZ {_BODY}"
    out = normalize_textbook_snippet(snippet)
    _not_in_upper(out, "ULYK.KZ", "standalone domain residue")
    assert BODY_MARKER in out
