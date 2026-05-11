"""
v3.12 (F5, 2026-04-30) — image upload → OCR → inline question.

Pure helpers for the chat-image OCR endpoint. The endpoint itself
lives at `/api/chat/ocr` (see `routers/chat.py`); this module owns:

  1. Content-type / size validation (so the router stays thin).
  2. Prompt-seed assembly (RU/KZ aware) so the FE can drop the
     OCR'd text into the composer with a sensible prefix.
  3. The "image too noisy" / "no text" classifier so we don't seed
     a useless prompt when the OCR comes back empty.

The actual vision call goes through the existing
`app.services.qwen_dashscope.ocr_image_bytes` (qwen-vl-ocr-latest)
which is already wired for the textbook ingest pipeline. F5 reuses
that surface — no new model, no new key, no new dependency.

Pure: no DOM, no HTTP, no DB. Vitest-style defensive matrix on
every helper.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Content-type allow-list + size cap
# ---------------------------------------------------------------------------

# Mirror routers/users.py:ALLOWED_IMAGE_TYPES so every chat-image
# enters through the same allow-list. JPEG + PNG cover ~99 % of
# textbook-photo uploads from phones; HEIC is intentionally OUT
# until we have a converter — qwen-vl-ocr won't accept it.
ALLOWED_OCR_IMAGE_TYPES: frozenset[str] = frozenset({"image/jpeg", "image/png", "image/jpg"})

# Hard cap. The endpoint also enforces this on the client side via
# the FileReader path, but a malicious / racing client can post any
# byte string — the router checks this BEFORE invoking the upstream
# vision call (which has its own much higher per-request cap +
# per-day token budget).
MAX_OCR_IMAGE_BYTES: int = 8 * 1024 * 1024  # 8 MiB

# Heuristic: under this character count the OCR result is treated
# as "no usable text" so we surface a helpful error instead of
# seeding the composer with garbage. Empirically the qwen-vl model
# returns the literal token "BLANK_PAGE" for cover-only pages, plus
# we strip whitespace.
MIN_USEFUL_OCR_CHARS: int = 4

# Token the OCR system prompt asks the model to return when a page
# is effectively blank. Documented in qwen_dashscope.py.
OCR_BLANK_PAGE_TOKEN: str = "BLANK_PAGE"


def is_allowed_ocr_content_type(content_type: object) -> bool:
    """Return True iff the content-type string is in the allow-list.
    Defensive against None / non-string / case-mismatched values."""
    if not isinstance(content_type, str):
        return False
    return content_type.strip().lower() in ALLOWED_OCR_IMAGE_TYPES


def is_within_ocr_size_cap(size: object) -> bool:
    """Return True iff size is a non-negative int up to the hard
    cap. Defensive on None / negative / non-int values."""
    if not isinstance(size, int) or isinstance(size, bool):
        return False
    if size < 0:
        return False
    return size <= MAX_OCR_IMAGE_BYTES


# ---------------------------------------------------------------------------
# OCR result classification
# ---------------------------------------------------------------------------


def classify_ocr_result(raw: object) -> str:
    """Classify a raw OCR string into one of three tokens:

      - "blank"  → the model said BLANK_PAGE / cover only
      - "empty"  → empty / whitespace / under MIN_USEFUL_OCR_CHARS
      - "ok"     → usable text

    Pure. No I/O.
    """
    if not isinstance(raw, str):
        return "empty"
    stripped = raw.strip()
    if stripped == OCR_BLANK_PAGE_TOKEN:
        return "blank"
    if len(stripped) < MIN_USEFUL_OCR_CHARS:
        return "empty"
    return "ok"


# ---------------------------------------------------------------------------
# Prompt-seed assembly
# ---------------------------------------------------------------------------


def ocr_seed_prefix(lang: object) -> str:
    """Prompt prefix that goes ABOVE the OCR'd text in the composer.
    State-aware RU/KZ. Ends in newline so the text starts on its
    own line. Anything not 'kz' is treated as RU."""
    if lang == "kz":
        return "Осы суреттегі мәтінге сүйеніп жауап беріңіз:\n\n"
    return "Опираясь на текст с этого изображения, ответь:\n\n"


def ocr_seed_suffix(lang: object) -> str:
    """Suffix that goes BELOW the OCR'd text. Empty by default —
    the user types their actual question here. We surface a hint
    via the FE placeholder, not in the seed text."""
    # Reserved for future per-lang scaffolding ("Question: ..." etc.)
    # Currently empty so the seed stays minimal.
    return ""


def build_ocr_seed(transcribed: object, lang: object) -> str | None:
    """Build the full composer-seed text from an OCR result.
    Returns None when the OCR text is unusable (blank page or empty)
    so the caller can render an error toast instead.
    """
    cls = classify_ocr_result(transcribed)
    if cls != "ok":
        return None
    text = (transcribed or "").strip() if isinstance(transcribed, str) else ""
    if not text:
        return None
    return ocr_seed_prefix(lang) + text + ocr_seed_suffix(lang)


def ocr_error_message(reason: object, lang: object) -> str:
    """Human-readable error text for the FE toast. RU + KZ.
    `reason` is one of: "blank", "empty", "too-large", "bad-type",
    "upstream-failed". Anything else collapses to the generic
    "upstream-failed" message."""
    ru = lang != "kz"
    if reason == "blank":
        return (
            "На изображении не найден текст. Попробуйте более чёткое фото."
            if ru
            else "Суретте мәтін табылмады. Анығырақ суретпен қайталап көріңіз."
        )
    if reason == "empty":
        return (
            "Не удалось распознать текст. Сфотографируйте страницу крупнее."
            if ru
            else "Мәтінді тану мүмкін болмады. Бетті ірірек суретке түсіріңіз."
        )
    if reason == "too-large":
        cap_mib = MAX_OCR_IMAGE_BYTES // (1024 * 1024)
        return (
            f"Файл слишком большой. Максимум — {cap_mib} МБ."
            if ru
            else f"Файл тым үлкен. Максимум — {cap_mib} МБ."
        )
    if reason == "bad-type":
        return "Поддерживаются только JPEG и PNG." if ru else "Тек JPEG және PNG қолдау табады."
    # "upstream-failed" / unknown → generic copy
    return (
        "Распознавание временно недоступно. Попробуйте позже."
        if ru
        else "Тану уақытша қолжетімсіз. Кейінірек көріңіз."
    )
