"""Session 19c regression tests for the expanded OKULYK banner regex.

All Cyrillic and banner strings are written as `\\u`-escapes so this
source file is pure ASCII. That way test output, failure diffs, and
any copy-paste never surface raw Cyrillic bytes that Windows cmd.exe
renders as mojibake.
"""

from app.utils.textbook_quality import (
    PLACEHOLDER_NOTICE,
    is_usable_textbook_content,
    normalize_textbook_snippet,
)

# PLACEHOLDER_NOTICE = "Vse uchebniki Kazakhstana na OKULYK.KZ"  (RU)
# Long banner adds "takzhe na sayte ... i OKULYK.KZ"
LONG_BANNER = (
    "\u0412\u0441\u0435 \u0443\u0447\u0435\u0431\u043d\u0438\u043a\u0438 "
    "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430 "
    "\u0442\u0430\u043a\u0436\u0435 \u043d\u0430 \u0441\u0430\u0439\u0442\u0435 "
    "OKULYK.COM \u0438 OKULYK.KZ"
)
TYPO_BANNER = (
    "\u0412\u0441\u0435 \u0443\u0447\u0435\u0431\u043d\u0438\u043a\u0438 "
    "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430 "
    "\u043d\u0430 OKULYKKZ"
)

# A realistic, varied multi-sentence Chemistry body (alkenes + alkynes).
# The sentences are deliberately distinct so the chunk doesn't trip
# `_looks_like_watermark_repeat` (which flags any 3-gram seen 4+ times
# in the first 400 chars) while still being well above the 120-char
# usability floor. Written as `\u`-escapes so this file stays ASCII.
_S1 = (
    "\u042d\u0442\u0438\u043b\u0435\u043d \u0438 "
    "\u043f\u0440\u043e\u043f\u0438\u043b\u0435\u043d "
    "\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f "
    "\u043d\u0435\u043f\u0440\u0435\u0434\u0435\u043b\u044c\u043d\u044b\u043c\u0438 "
    "\u0443\u0433\u043b\u0435\u0432\u043e\u0434\u043e\u0440\u043e\u0434\u0430\u043c\u0438 "
    "\u0440\u044f\u0434\u0430 \u0430\u043b\u043a\u0435\u043d\u043e\u0432."
)
_S2 = (
    "\u041e\u0431\u0449\u0430\u044f \u0444\u043e\u0440\u043c\u0443\u043b\u0430 "
    "\u0430\u043b\u043a\u0435\u043d\u043e\u0432 C_nH_2n, \u0434\u043b\u044f "
    "\u0430\u043b\u043a\u0438\u043d\u043e\u0432 \u043f\u0440\u0438\u043c\u0435\u043d\u044f"
    "\u0435\u0442\u0441\u044f \u0444\u043e\u0440\u043c\u0443\u043b\u0430 C_nH_2n_minus_2."
)
_S3 = (
    "\u0411\u0440\u043e\u043c\u043d\u0430\u044f \u0432\u043e\u0434\u0430 "
    "\u043e\u0431\u0435\u0441\u0446\u0432\u0435\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f "
    "\u043f\u0440\u0438 \u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0438 "
    "\u043a \u0434\u0432\u043e\u0439\u043d\u043e\u0439 \u0441\u0432\u044f\u0437\u0438."
)
_S4 = (
    "\u0420\u0435\u0430\u043a\u0446\u0438\u044f "
    "\u043f\u043e\u043b\u0438\u043c\u0435\u0440\u0438\u0437\u0430\u0446\u0438\u0438 "
    "\u0434\u0430\u0451\u0442 \u043f\u043e\u043b\u0438\u044d\u0442\u0438\u043b\u0435\u043d, "
    "\u043f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u043c\u044b\u0439 \u0432 "
    "\u043f\u0440\u043e\u043c\u044b\u0448\u043b\u0435\u043d\u043d\u043e\u0441\u0442\u0438."
)
BODY = " ".join([_S1, _S2, _S3, _S4])

# "Alken" (stem of alkene), used as a body-marker probe.
BODY_MARKER = "\u0430\u043b\u043a\u0435\u043d\u043e\u0432"
# "Prodolzhenie temy" ("continuation of the topic")
TAIL_PHRASE = (
    "\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435 \u0442\u0435\u043c\u044b"
)


def _safe_assert_contains(haystack: str, needle: str, label: str):
    """Custom contains-check so failure diffs NEVER print Cyrillic."""
    assert needle in haystack, (
        f"marker {label!r} missing; haystack ascii-stats: "
        f"len={len(haystack)} alnum_cjk_rate="
        f"{sum(1 for c in haystack if c.isalnum()) / max(len(haystack), 1):.2f}"
    )


def _safe_assert_not_contains(haystack: str, needle: str, label: str):
    assert needle not in haystack, f"banner residue {label!r} found; haystack len={len(haystack)}"


def test_long_banner_removed_not_body():
    snippet = f"{LONG_BANNER} {BODY}"
    out = normalize_textbook_snippet(snippet)
    _safe_assert_not_contains(out.upper(), "OKULYK", "long banner")
    _safe_assert_contains(out, BODY_MARKER, "body marker after long banner")
    assert is_usable_textbook_content(snippet)


def test_banner_typo_variant_removed():
    snippet = f"{TYPO_BANNER} {BODY}"
    out = normalize_textbook_snippet(snippet)
    _safe_assert_not_contains(out.upper(), "OKULYKKZ", "typo banner")
    _safe_assert_contains(out, BODY_MARKER, "body marker after typo banner")


def test_banner_mid_sentence_doesnt_eat_left_context():
    snippet = f"{BODY} {PLACEHOLDER_NOTICE} {TAIL_PHRASE}: finale."
    out = normalize_textbook_snippet(snippet)
    _safe_assert_not_contains(out.upper(), "OKULYK", "short banner")
    _safe_assert_contains(out, TAIL_PHRASE, "tail phrase")
    _safe_assert_contains(out, BODY_MARKER, "body marker before banner")
