from __future__ import annotations

import re

PLACEHOLDER_NOTICE = "Все учебники Казахстана на OKULYK.KZ"

# Session 19c (2026-04-21): corpus audit found *two* banner forms
# (2,704 chunks have the short form, 238 have the long form, plus a
# handful of typo variants like "OKULYKKZ", "OKULYK AZ", etc.):
#   1)  "Все учебники Казахстана на OKULYK.KZ"                 (short)
#   2)  "Все учебники Казахстана также на сайте OKULYK.COM и OKULYK.KZ"  (long)
# The literal `str.replace` in `normalize_textbook_snippet` only
# removed form #1, so form #2 — plus OCR variants — stayed in the
# snippet shown to the LLM. It's harmless noise but burns tokens and
# dilutes grounding. A bounded non-greedy regex with an explicit
# terminator scoops all variants without re-introducing the
# consume-to-EOF bug.
# Session 20 (2026-04-21): a *second* boilerplate watermark is present on
# nearly every page of several Kazakhstani textbooks (id=21, id=64,
# id=71, id=72, id=75 — all Chemistry + History-KZ). It's the legal
# notice referencing Ministry of Education order #217 from 17 May 2019.
# The two forms observed:
#   (A) "Книга предоставлена исключительно в образовательных целях
#        согласно Приказа Министра образования и науки Республики
#        Казахстан от 17 мая 2019 года № 217"
#   (B) same text starting with "нига" (when "К" gets OCR-clipped)
# Before this fix `is_usable_textbook_content` rejected the whole chunk
# on the markers "предоставлена исключительно" and "приказа министра
# образования", even when the rest of the chunk was real content. That
# dropped usable% to 2-10% on recovered books whose content is fine.
# Strip it as boilerplate like the OKULYK banner.
_LEGAL_NOTICE_RE = re.compile(
    r"(?:К?нига\s+)?"  # optional "Kniga " prefix (К or OCR-clipped)
    r"предоставлена\s+исключительно"  # predostavlena isklyuchitelno
    r"\s+в\s+образовательных\s+целях"  # v obrazovatelnyh tselyah
    r"(?:\s+согласно\s+Приказа)?\s*"  # optional " soglasno Prikaza"
    r"(?:.{0,80}?№\s*\d+)?",  # optional "... No. 217" tail (bounded!)
    flags=re.IGNORECASE,
)


_BANNER_RE = re.compile(
    r"(?:Все|Бсе|Всё)\s+учебник[а-яё]*\s+Казахстана"  # lead-in + OCR variants
    # After the lead-in the corpus carries several tail shapes. The two
    # original s19c forms:
    #   short: "... na OKULYK.KZ"
    #   long:  "... takzhe na sayte OKULYK.COM i OKULYK.KZ"
    # plus the s20 variant discovered in id=21/64/71/72/75:
    #   "... ishchite na saytakh OKULYK.COM i OKULYK.KZ"
    # The new form uses a different verb ("ishchite" = "look on") and
    # a plural noun ("saytakh" = "on websites"), so accept any of
    # the three prefix shapes.
    r"(?:"
    r"\s+также\s+на\s+сайте"  # (long) "also on the site"
    r"|\s+ищите\s+на\s+сайт[а-яё]*"  # (s20) "look for on site(s)"
    r"|\s+на"  # (short) bare "on"
    r")"
    r"\s+OKULYK[A-Z.]{0,6}"  # OKULYK.KZ / OKULYK.COM / typo
    r"(?:\s+и\s+OKULYK[A-Z.]{0,6})?",  # optional trailing ' i OKULYK.KZ'
    flags=re.IGNORECASE,
)

_KZ_BANNER_RE = re.compile(
    r"Барлық\s+оқулықтар\s+Қазақстанда"
    r"(?:\s+на|\s+сайт[а-яё]*)?"
    r"\s+(?:[A-Z0-9]?ULYK|OKULYK)[A-Z.]{0,6}",
    flags=re.IGNORECASE,
)

_ORPHAN_BANNER_LEAD_RE = re.compile(
    r"(?:Все|Бсе|Всё|Без)\s+учебник[а-яё]*\s+Казах[а-яё]*"
    r"(?:\s+(?:на|ищите|сайт[а-яё]*))*",
    flags=re.IGNORECASE,
)

_OKULYK_DOMAIN_RE = re.compile(
    r"\b(?:OKULYK|OKULIK|OKULUK|[A-Z0-9]?ULYK)\.(?:KZ|COM)\b|"
    r"\b(?:ОКУЛУК|ОКУУК)\.KZ\b",
    flags=re.IGNORECASE,
)

# Count of repeated "pageN" tokens that marks an embedded TOC/outline
# chunk (observed in Algebra 11 2 page 147 where 64 "pageN" tokens
# completely dominate the chunk content).
_PAGE_TOKEN_RE = re.compile(r"\bpage\s*\d{1,3}\b", re.IGNORECASE)

INVALID_CHUNK_MARKERS = (
    "okulyk.kz",
    "okulyk.com",
    # Session 20 (2026-04-21): DO NOT hard-reject on the Ministry-of-Education
    # legal notice markers. They appear as boilerplate on every page of
    # id=21/64/71/72/75 and were killing real content alongside the notice.
    # `normalize_textbook_snippet` now scrubs the notice via _LEGAL_NOTICE_RE
    # so the surrounding instructional content survives. The markers
    # remain listed in _LEGAL_NOTICE_MARKERS for regression-test coverage.
    "скачать pdf",
    # Watermark / DRM boilerplate that some ingested PDFs carry on every page.
    # Observed repeatedly in "Математика 6 Алдамуратова Т." — each retrieval
    # surfaced the literal sequence "Не для печати Не для печати …" filling
    # the whole chunk, with zero pedagogical content.
    "не для печати",
    "not for print",
    # Marketing / copyright boilerplate
    "все права защищены",
    "барлық құқықтар қорғалған",
)

# Short words/tokens that signal a TOC page if they dominate the first
# window. We use the first-300-chars heuristic.
_TOC_HEADINGS = (
    "содержание",
    "мазмұны",
    "contents",
    "предисловие",
    "алғы сөз",
    "глоссарий",
    "указатель",
    "оглавление",
)

# BUG-12 follow-up (2026-04-18): intro / review / "recap previous year"
# pages surface on literal-word cosine because they enumerate the topic
# names but don't teach them. Penalize, don't hard-reject — many of these
# pages do contain a short definition further in.
_REVIEW_MARKERS = (
    # RU — review / recap / intro openers
    "повторение",
    "повторим",
    "вспомним пройденное",
    "итоговое повторение",
    "задания для повторения",
    "введение",
    "к учащимся",
    "от авторов",
    "дорогие ученики",
    # RU — chapter-opener pedagogical bullets (the killer for BUG-12:
    # Algebra 8 p.104 topped retrieval for "дискриминант" because it is
    # the chapter-intro page with "Бөлімді оқып-үйрену барысында..."
    # listing the concepts without actually teaching them.)
    "изучив эту главу",
    "в этой главе мы",
    "цели обучения",
    "по итогам изучения",
    "по итогам раздела",
    "в конце этой главы",
    "планируемые результаты",
    # KZ — review / recap / intro openers
    "қайталау",
    "өткенді еске",
    "өткенді қайталау",
    "қайталауға арналған",
    "кіріспе",
    "оқушыларға",
    "авторлардан",
    # KZ — chapter-opener pedagogical bullets
    "бөлімді оқып-үйрену",
    "бөлімді оқып",
    "осы бөлімді",
    "мақсаттарға қол жеткіз",
    "осы тарауды оқып",
)


def looks_like_review_or_intro(content: str) -> bool:
    """Return True when the chunk is an intro / review / 'recap' page.

    Used as a soft demotion signal in `_score_rows`, NOT as a hard filter.
    Review pages legitimately include topic keywords ("дискриминант",
    "моль") without teaching them; if nothing better is available we
    still want to return them, but they should lose to a real
    instructional chunk.
    """
    head = (content or "")[:400].casefold()
    return any(marker in head for marker in _REVIEW_MARKERS)


# Bibliography / reference-list signatures. These pages enumerate
# authors, publishers, and years, and contain topic keywords in titles
# (e.g. "...неорганической химии..." → retrieval for "моль" top-1'd
# Chemistry 11 Part 1 page 189, which is the bibliography).
_BIBLIOGRAPHY_SIGNS = (
    # Publisher / press name residues
    "вентана-граф",
    "просвещение",
    "издательство",
    "издат.",
    "дрофа",
    "дрофа,",
    "мектеп",
    "феникс",
    "оникс",
    "экзамен",
    "новая волна",
    "эксмо",
    "анрис-пресс",
    "питер,",
)

# Year-only markers that appear in reference entries (e.g. ", 2009.").
_REF_YEAR_RE = re.compile(r",\s*(19|20)\d{2}\s*[\.,]")
# Russian page-count abbreviations ("175 с.", "240 с.")
_REF_PAGE_MARKER_RE = re.compile(r"\b\d{2,4}\s*[сc]\.\s", re.IGNORECASE)
# Author-initials pattern — e.g. "Н.Е.", "А.Н." (two capital letters
# each followed by a period).
_AUTHOR_INITIALS_RE = re.compile(r"\b[А-ЯA-Z]\.\s?[А-ЯA-Z]\.\b")


def looks_like_bibliography(content: str) -> bool:
    """Return True for reference-list / bibliography chunks.

    Cumulative signal score: any 2 of the following three cues in the
    first 800 chars classify the chunk as a bibliography.
      (a) 2+ publisher-name hits, OR a publisher + author initials
      (b) 2+ year-of-publication patterns (", 2009." / ", 2011.")
      (c) 2+ "<N> с." page-count markers
    """
    head = (content or "")[:800]
    head_lc = head.casefold()

    publisher_hits = sum(1 for s in _BIBLIOGRAPHY_SIGNS if s in head_lc)
    year_hits = len(_REF_YEAR_RE.findall(head))
    page_hits = len(_REF_PAGE_MARKER_RE.findall(head))
    initials_hits = len(_AUTHOR_INITIALS_RE.findall(head))

    signal_a = publisher_hits >= 2 or (publisher_hits >= 1 and initials_hits >= 1)
    signal_b = year_hits >= 2
    signal_c = page_hits >= 2

    return sum((signal_a, signal_b, signal_c)) >= 2


def normalize_textbook_snippet(text_value: str) -> str:
    cleaned = text_value or ""
    cleaned = re.sub(r"(?is)\A---\s.*?\n---\s*", "", cleaned)
    # Session-19 (2026-04-21) CRITICAL BUG FIX. The previous regex was
    #   re.sub(rf"(?is){notice}.*?(?=\n\n|\Z)", "", cleaned)
    # non-greedy `.*?` with a `\n\n|\Z` lookahead. Every Qwen-VL OCR
    # chunk we ingested is a single paragraph with no double-newline,
    # so the lookahead only matched at \Z. That made `.*?` lazily
    # consume from the placeholder all the way to EOF, silently
    # wiping the entire chunk. 5,365 / 10,647 chunks (50.4% of the
    # corpus) were being driven to `len == 0`, which made
    # `is_usable_textbook_content` reject them and retrieval returned
    # zero hits for phys-08, math-02, math-10, hist-03. Literal
    # strip of just the banner — which is what was intended —
    # preserves the surrounding instructional content.
    # Session 19c (2026-04-21): the literal `str.replace` above only
    # caught the short banner ("Все учебники Казахстана на OKULYK.KZ")
    # — the corpus actually carries TWO banner forms plus OCR typos
    # (OKULYKKZ, OKULYK AZ, …). `_BANNER_RE` scoops all of them
    # without re-introducing the consume-to-EOF bug of the old
    # lazy-regex that s19b fixed.
    cleaned = cleaned.replace(PLACEHOLDER_NOTICE, " ")
    cleaned = _BANNER_RE.sub(" ", cleaned)
    cleaned = _KZ_BANNER_RE.sub(" ", cleaned)
    cleaned = _ORPHAN_BANNER_LEAD_RE.sub(" ", cleaned)
    cleaned = _OKULYK_DOMAIN_RE.sub(" ", cleaned)
    # Session 20: scrub the Ministry-of-Education legal boilerplate.
    # This is bounded (.{0,80}? with an explicit "No. XXX" terminator
    # OR the group simply doesn't match) so it cannot consume to EOF
    # even if the notice is truncated mid-sentence.
    cleaned = _LEGAL_NOTICE_RE.sub(" ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _looks_like_toc(text: str) -> bool:
    """TOC-page detector.

    Two signals combined: a TOC-like heading in the first 80 chars AND a
    high density of dot-leaders / page-number runs in the first 400 chars.
    Either alone is too aggressive (real content references "содержание"
    casually; dot-leaders appear briefly in example text), but the
    combination reliably catches the TOC / index pages we saw in the
    physics textbook."""
    head = text[:400]
    lowered_head = head.casefold()
    has_toc_heading = any(h in lowered_head[:80] for h in _TOC_HEADINGS)
    # Dot-leader run: 5+ dots optionally separated by spaces, i.e. the
    # "Глава 1 ............. 6" pattern.
    dot_run_count = len(re.findall(r"\.{5,}", head))
    return has_toc_heading and dot_run_count >= 2


def _looks_like_watermark_repeat(text: str) -> bool:
    """Chunks that are a single short phrase repeated to fill the page.

    Signal: any 3-word window that appears 4+ times in the first 400 chars.
    This catches "Не для печати Не для печати Не для печати …" and similar.
    """
    head = text[:400].casefold()
    tokens = head.split()
    if len(tokens) < 12:
        return False
    # Build triples and count the most common one.
    from collections import Counter

    triples = Counter(tuple(tokens[i : i + 3]) for i in range(len(tokens) - 2))
    if not triples:
        return False
    (_triple, top_count) = triples.most_common(1)[0]
    return top_count >= 4


def is_usable_textbook_content(content: str, *, min_length: int = 120) -> bool:
    normalized = normalize_textbook_snippet(content)
    if len(normalized) < min_length:
        return False
    if normalized.count("�") >= 5:
        return False

    lowered = normalized.casefold()
    if any(marker in lowered for marker in INVALID_CHUNK_MARKERS):
        return False
    if lowered.startswith("title:") or lowered.startswith("--- title:"):
        return False

    if _looks_like_watermark_repeat(normalized):
        return False
    if _looks_like_toc(normalized):
        return False

    # BUG-12 follow-up (2026-04-18): reject chunks dominated by "pageN"
    # outline tokens (Algebra 11 2 page 147 has 60+ of them). These are
    # OCR-extracted TOC outlines that leaked through the TOC detector
    # because they don't contain explicit "содержание" headings.
    page_token_count = len(_PAGE_TOKEN_RE.findall(normalized))
    if page_token_count >= 10:
        return False

    alpha_chars = sum(1 for char in normalized[:400] if char.isalpha())
    if alpha_chars < 40:
        return False

    # Proportional check: the useful-content ratio of the first 400 chars
    # must be above ~35% alphabetic. Pages that are mostly whitespace,
    # dots, digits or special chars (exercise answer keys, OCR noise)
    # routinely slip through the raw alpha-count gate.
    window = normalized[:400]
    if window and (alpha_chars / max(len(window), 1)) < 0.35:
        return False

    return True


def build_textbook_snippet(content: str, *, limit: int = 200) -> str:
    normalized = normalize_textbook_snippet(content)
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "..."
