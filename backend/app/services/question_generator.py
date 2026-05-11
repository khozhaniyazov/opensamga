"""
app/services/question_generator.py
----------------------------------
Grounded Question Generator (GQG) Service

Generates hallucination-free UNT-style MCQ questions by:
1. Selecting an "anchor" chunk from textbooks (the truth)
2. Using GPT-4 to create question + AI-generated confusing distractors
3. Attaching verifiable citations
"""

import json
import logging
import random
import re
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants.subjects import get_subject_by_name, normalize_subject_name
from app.models import GeneratedQuestion, Textbook, TextbookChunk
from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI
from app.utils.textbook_quality import is_usable_textbook_content

logger = logging.getLogger(__name__)

# Initialize async OpenAI client
async_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY.get_secret_value())
QUESTION_GENERATION_MODEL = (
    settings.OPENAI_PREMIUM_MODEL or settings.OPENAI_MODEL or settings.LLM_MODEL or "gpt-4o-mini"
)

# Constants
MIN_CHUNK_LENGTH = 100  # Minimum chars for good question material
MAX_CHUNK_LENGTH = 800  # Maximum chars to avoid overwhelming content
PLACEHOLDER_NOTICE = "Все учебники Казахстана на OKULYK.KZ"
INVALID_CHUNK_MARKERS = (
    "okulyk.kz",
    "okulyk.com",
    "предоставлена исключительно",
    "приказа министра образования",
    "скачать pdf",
)
RU_FILE_HINTS = ("_ру", "-ру", ".ру", "_ru", "-ru", ".ru", "russian")
KZ_FILE_HINTS = ("_кз", "-кз", ".кз", "_kz", "-kz", ".kz", "_қаз", "_каз", "kazakh")
PAGE_TOKEN_RE = re.compile(r"\bpage\s*\d{1,3}\b", re.IGNORECASE)

LOCAL_PRACTICE_BANK: dict[str, list[dict[str, Any]]] = {
    "Mathematical Literacy": [
        {
            "question_ru": "Сколько процентов составляет 25 из 100?",
            "question_kz": "25 саны 100-дің неше пайызын құрайды?",
            "options_ru": ["25%", "20%", "40%", "50%"],
            "options_kz": ["25%", "20%", "40%", "50%"],
            "correct_index": 0,
            "explanation_ru": "25 из 100 — это 25%.",
            "explanation_kz": "25 саны 100-дің 25%-ын құрайды.",
        },
        {
            "question_ru": "Если товар стоил 8 000 ₸ и подешевел на 10%, сколько он стоит теперь?",
            "question_kz": "Тауар 8 000 ₸ болып, 10% арзандаса, жаңа бағасы қанша болады?",
            "options_ru": ["7 200 ₸", "7 000 ₸", "7 800 ₸", "6 800 ₸"],
            "options_kz": ["7 200 ₸", "7 000 ₸", "7 800 ₸", "6 800 ₸"],
            "correct_index": 0,
            "explanation_ru": "10% от 8 000 — это 800, значит новая цена 7 200 ₸.",
            "explanation_kz": "8 000-ның 10%-ы 800-ге тең, сондықтан жаңа баға 7 200 ₸.",
        },
    ],
    "Reading Literacy": [
        {
            "question_ru": "Если автор несколько раз повторяет одну и ту же мысль в абзаце, что обычно является основной идеей текста?",
            "question_kz": "Автор абзацта бір ойды бірнеше рет қайталаса, мәтіннің негізгі идеясы әдетте қайсысы болады?",
            "options_ru": [
                "Повторяющаяся мысль автора",
                "Самая короткая фраза",
                "Любой пример из текста",
                "Последнее слово в абзаце",
            ],
            "options_kz": [
                "Автор қайталап отырған ой",
                "Ең қысқа сөйлем",
                "Мәтіндегі кез келген мысал",
                "Абзацтағы соңғы сөз",
            ],
            "correct_index": 0,
            "explanation_ru": "Основная идея обычно выражает мысль, которую автор повторяет и развивает.",
            "explanation_kz": "Негізгі идея көбіне автор қайталап, дамытып отырған ойды білдіреді.",
        },
        {
            "question_ru": "Какой прием помогает быстрее найти главную мысль абзаца?",
            "question_kz": "Абзацтың негізгі ойын тез табуға қай тәсіл көмектеседі?",
            "options_ru": [
                "Определить тему и ключевые слова",
                "Считать только количество предложений",
                "Игнорировать первое предложение",
                "Запоминать только имена собственные",
            ],
            "options_kz": [
                "Тақырып пен тірек сөздерді анықтау",
                "Тек сөйлем санын санау",
                "Бірінші сөйлемді елемеу",
                "Тек жалқы есімдерді жаттау",
            ],
            "correct_index": 0,
            "explanation_ru": "Ключевые слова и тема обычно прямо ведут к основной мысли текста.",
            "explanation_kz": "Тірек сөздер мен тақырып негізгі ойды анықтауға тікелей көмектеседі.",
        },
    ],
    "Physics": [
        {
            "question_ru": "Какая единица измерения силы используется в СИ?",
            "question_kz": "SI жүйесінде күштің өлшем бірлігі қайсы?",
            "options_ru": ["Ньютон", "Паскаль", "Джоуль", "Ватт"],
            "options_kz": ["Ньютон", "Паскаль", "Джоуль", "Ватт"],
            "correct_index": 0,
            "explanation_ru": "Сила в системе СИ измеряется в ньютонах.",
            "explanation_kz": "Күш SI жүйесінде ньютонмен өлшенеді.",
        },
        {
            "question_ru": "Какая формула выражает среднюю скорость равномерного движения?",
            "question_kz": "Бірқалыпты қозғалыстың орташа жылдамдығын қандай формула өрнектейді?",
            "options_ru": ["v = s / t", "F = ma", "p = mv", "A = Fs"],
            "options_kz": ["v = s / t", "F = ma", "p = mv", "A = Fs"],
            "correct_index": 0,
            "explanation_ru": "Средняя скорость равна пути, делённому на время движения.",
            "explanation_kz": "Орташа жылдамдық жүрілген жолдың уақытқа қатынасына тең.",
        },
    ],
    "Mathematics": [
        {
            "question_ru": "Чему равна производная функции x^2?",
            "question_kz": "x^2 функциясының туындысы неге тең?",
            "options_ru": ["2x", "x", "x^3", "2"],
            "options_kz": ["2x", "x", "x^3", "2"],
            "correct_index": 0,
            "explanation_ru": "По правилу степенной функции производная x^2 равна 2x.",
            "explanation_kz": "Дәрежелік функция ережесі бойынша x^2 туындысы 2x-ке тең.",
        },
        {
            "question_ru": "Чему равно значение sin 30°?",
            "question_kz": "sin 30° мәні неге тең?",
            "options_ru": ["1/2", "√3/2", "0", "1"],
            "options_kz": ["1/2", "√3/2", "0", "1"],
            "correct_index": 0,
            "explanation_ru": "Стандартное значение sin 30° равно 1/2.",
            "explanation_kz": "Стандартты мән бойынша sin 30° = 1/2.",
        },
    ],
    "Chemistry": [
        {
            "question_ru": "Какая химическая формула у воды?",
            "question_kz": "Судың химиялық формуласы қандай?",
            "options_ru": ["H2O", "CO2", "O2", "NaCl"],
            "options_kz": ["H2O", "CO2", "O2", "NaCl"],
            "correct_index": 0,
            "explanation_ru": "Молекула воды состоит из двух атомов водорода и одного атома кислорода.",
            "explanation_kz": "Су молекуласы екі сутек және бір оттек атомынан тұрады.",
        },
        {
            "question_ru": "Какую среду показывает pH меньше 7?",
            "question_kz": "pH мәні 7-ден кіші болса, ол қандай ортаны көрсетеді?",
            "options_ru": ["Кислую", "Нейтральную", "Щелочную", "Солевую"],
            "options_kz": ["Қышқыл", "Бейтарап", "Сілтілі", "Тұзды"],
            "correct_index": 0,
            "explanation_ru": "Значение pH меньше 7 соответствует кислой среде.",
            "explanation_kz": "pH 7-ден кіші болса, орта қышқыл болады.",
        },
    ],
    "Biology": [
        {
            "question_ru": "Какое вещество хранит наследственную информацию клетки?",
            "question_kz": "Жасушаның тұқымқуалаушылық ақпаратын қай зат сақтайды?",
            "options_ru": ["ДНК", "Глюкоза", "Крахмал", "Вода"],
            "options_kz": ["ДНҚ", "Глюкоза", "Крахмал", "Су"],
            "correct_index": 0,
            "explanation_ru": "ДНК является основным носителем наследственной информации.",
            "explanation_kz": "ДНҚ тұқымқуалаушылық ақпараттың негізгі тасымалдаушысы болып табылады.",
        },
        {
            "question_ru": "В каком органоиде клетки происходит фотосинтез?",
            "question_kz": "Фотосинтез жасушаның қай органоидінде жүреді?",
            "options_ru": ["В хлоропластах", "В митохондриях", "В ядре", "В рибосомах"],
            "options_kz": ["Хлоропластарда", "Митохондрияларда", "Ядрода", "Рибосомаларда"],
            "correct_index": 0,
            "explanation_ru": "Фотосинтез происходит в хлоропластах растений.",
            "explanation_kz": "Фотосинтез өсімдік жасушасының хлоропластарында жүреді.",
        },
    ],
    "History of Kazakhstan": [
        {
            "question_ru": "В каком году было образовано Казахское ханство?",
            "question_kz": "Қазақ хандығы қай жылы құрылды?",
            "options_ru": ["1465", "1219", "1731", "1917"],
            "options_kz": ["1465", "1219", "1731", "1917"],
            "correct_index": 0,
            "explanation_ru": "Традиционной датой образования Казахского ханства считается 1465 год.",
            "explanation_kz": "Қазақ хандығының құрылған дәстүрлі жылы ретінде 1465 жыл алынады.",
        },
        {
            "question_ru": "В каком году Казахстан провозгласил независимость?",
            "question_kz": "Қазақстан қай жылы тәуелсіздігін жариялады?",
            "options_ru": ["1991", "1986", "1995", "2001"],
            "options_kz": ["1991", "1986", "1995", "2001"],
            "correct_index": 0,
            "explanation_ru": "Казахстан провозгласил независимость в 1991 году.",
            "explanation_kz": "Қазақстан 1991 жылы тәуелсіздігін жариялады.",
        },
    ],
}


def _normalize_snippet(text_value: str) -> str:
    cleaned = text_value or ""
    cleaned = re.sub(r"(?is)\A---\s.*?\n---\s*", "", cleaned)
    cleaned = re.sub(rf"(?is){re.escape(PLACEHOLDER_NOTICE)}.*?(?=\n\n|\Z)", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _extract_json_payload(text_value: str) -> str:
    cleaned = re.sub(
        r"<think>[\s\S]*?(</think>|$)", "", text_value or "", flags=re.IGNORECASE
    ).strip()
    match = re.search(r"\{[\s\S]*\}", cleaned)
    return match.group(0).strip() if match else cleaned


def _is_usable_practice_content(content: str) -> bool:
    normalized = _normalize_snippet(content)
    if len(normalized) < 120:
        return False
    if not is_usable_textbook_content(normalized, min_length=120):
        return False
    if normalized.count("�") >= 5:
        return False
    if len(PAGE_TOKEN_RE.findall(normalized)) >= 5:
        return False

    lowered = normalized.casefold()
    if any(marker in lowered for marker in INVALID_CHUNK_MARKERS):
        return False
    if lowered.startswith("title:") or lowered.startswith("--- title:"):
        return False

    alpha_chars = sum(1 for char in normalized[:400] if char.isalpha())
    return alpha_chars >= 40


def _is_readable_option_snippet(value: str) -> bool:
    candidate = (value or "").strip()
    if not candidate:
        return False
    if len(PAGE_TOKEN_RE.findall(candidate)) >= 2:
        return False
    alpha_chars = sum(1 for char in candidate if char.isalpha())
    return alpha_chars >= 12


def _extract_option_snippet(content: str) -> str | None:
    """Extract a short, readable statement from textbook content."""
    normalized = _normalize_snippet(content)
    if not normalized:
        return None

    parts = re.split(r"(?<=[.!?;])\s+", normalized)
    for part in parts:
        candidate = part.strip(" -•\t\r\n\"'")
        if 35 <= len(candidate) <= 180 and _is_readable_option_snippet(candidate):
            return candidate

    fallback = normalized[:180].strip(" -•\t\r\n\"'")
    return fallback if _is_readable_option_snippet(fallback) else None


def _subject_search_terms(subject: str | None) -> list[str]:
    """Return canonical and localized subject names for database matching."""
    if not subject:
        return []

    resolved = get_subject_by_name(subject)
    candidates = [subject]
    if resolved:
        candidates.extend([resolved.name_en, resolved.name_ru, resolved.name_kz])

    seen = set()
    result: list[str] = []
    for candidate in candidates:
        normalized = (candidate or "").strip()
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _language_file_rank(file_name: str | None, language: str | None) -> int:
    """Prefer textbook variants that match the requested UI language."""
    requested = (language or "").lower()
    if not requested:
        return 0

    normalized = (file_name or "").casefold()
    if not normalized:
        return 1

    has_ru = any(hint in normalized for hint in RU_FILE_HINTS)
    has_kz = any(hint in normalized for hint in KZ_FILE_HINTS)

    if requested.startswith("ru"):
        if has_ru and not has_kz:
            return 0
        if has_ru and has_kz:
            return 1
        if has_kz and not has_ru:
            return 2
        return 1

    if requested.startswith("kz"):
        if has_kz and not has_ru:
            return 0
        if has_kz and has_ru:
            return 1
        if has_ru and not has_kz:
            return 2
        return 1

    return 0


async def select_anchor(
    db: AsyncSession,
    subject: str | None = None,
    grade: int | None = None,
    exclude_chunk_ids: list[int] | None = None,
    language: str | None = None,
) -> TextbookChunk | None:
    """
    Step 1: Select a high-quality anchor chunk.

    The anchor is the "truth" from which the correct answer will be derived.

    Args:
        db: Database session
        subject: Optional filter by subject (e.g., "History")
        grade: Optional filter by grade (e.g., 10, 11)
        exclude_chunk_ids: List of chunk IDs to exclude (recently used)

    Returns:
        TextbookChunk suitable for question generation, or None if not found
    """
    if exclude_chunk_ids and len(exclude_chunk_ids) >= 40:
        logger.info("No suitable anchor chunk found (exclude pool exhausted)")
        return None

    subject_terms = _subject_search_terms(subject)

    # Build query to find suitable anchor chunks
    sql = """
        SELECT tc.id, tc.content, tc.page_number, tc.textbook_id,
               t.title, t.subject, t.grade, t.file_name
        FROM textbook_chunks tc
        JOIN textbooks t ON tc.textbook_id = t.id
        WHERE LENGTH(tc.content) >= :min_length
          AND LENGTH(tc.content) <= :max_length
          AND LOWER(COALESCE(t.title, '')) NOT IN ('', 'unknown', 'untitled')
          AND COALESCE(t.title, '') !~ '^[0-9]+$'
    """

    params = {
        "min_length": MIN_CHUNK_LENGTH,
        "max_length": MAX_CHUNK_LENGTH,
    }

    # Apply optional filters
    if subject_terms:
        clauses = []
        for index, term in enumerate(subject_terms):
            key = f"subject_{index}"
            clauses.append(f"LOWER(t.subject) = LOWER(:{key})")
            params[key] = term
        sql += " AND (" + " OR ".join(clauses) + ")"

    if grade:
        sql += " AND t.grade = :grade"
        params["grade"] = grade

    if exclude_chunk_ids and len(exclude_chunk_ids) > 0:
        # Exclude recently used chunks
        placeholders = ", ".join([f":exclude_{i}" for i in range(len(exclude_chunk_ids))])
        sql += f" AND tc.id NOT IN ({placeholders})"
        for i, chunk_id in enumerate(exclude_chunk_ids):
            params[f"exclude_{i}"] = chunk_id

    # Random selection from qualified pool
    sql += " ORDER BY RANDOM() LIMIT 12"

    try:
        result = await db.execute(text(sql), params)
        rows = result.fetchall()

        if not rows:
            logger.info("No suitable anchor chunk found (empty candidate pool)")
            return None

        candidate_ids = [row.id for row in rows]
        chunk_result = await db.execute(
            select(TextbookChunk).where(TextbookChunk.id.in_(candidate_ids))
        )
        chunk_by_id = {chunk.id: chunk for chunk in chunk_result.scalars().all()}

        sorted_rows = sorted(
            rows,
            key=lambda row: (
                _language_file_rank(getattr(row, "file_name", None), language),
                row.id,
            ),
        )

        for row in sorted_rows:
            chunk = chunk_by_id.get(row.id)
            if not chunk:
                continue

            chunk._textbook_title = row.title
            chunk._textbook_subject = row.subject
            chunk._textbook_grade = row.grade
            chunk._textbook_file_name = row.file_name

            if _is_usable_practice_content(chunk.content):
                return chunk

        next_excludes = [*(exclude_chunk_ids or []), *candidate_ids]
        if len(next_excludes) >= 40:
            logger.info("No suitable anchor chunk found (recursion exclude limit hit)")
            return None

        return await select_anchor(
            db=db,
            subject=subject,
            grade=grade,
            exclude_chunk_ids=next_excludes,
            language=language,
        )

    except Exception:
        logger.exception("Error selecting anchor chunk")
        await db.rollback()
        return None


async def select_distractor_chunks(
    db: AsyncSession,
    subject: str | None,
    grade: int | None,
    anchor_chunk_id: int,
    language: str | None = None,
    limit: int = 6,
) -> list[TextbookChunk]:
    """Select extra chunks so the local fallback can build distractors."""
    subject_terms = _subject_search_terms(subject)

    sql = """
        SELECT tc.id, t.file_name
        FROM textbook_chunks tc
        JOIN textbooks t ON tc.textbook_id = t.id
        WHERE tc.id != :anchor_chunk_id
          AND LENGTH(tc.content) >= :min_length
          AND LENGTH(tc.content) <= :max_length
          AND LOWER(COALESCE(t.title, '')) NOT IN ('', 'unknown', 'untitled')
          AND COALESCE(t.title, '') !~ '^[0-9]+$'
    """

    params: dict[str, Any] = {
        "anchor_chunk_id": anchor_chunk_id,
        "min_length": MIN_CHUNK_LENGTH,
        "max_length": MAX_CHUNK_LENGTH,
        "limit": max(limit * 4, limit),
    }

    if subject_terms:
        clauses = []
        for index, term in enumerate(subject_terms):
            key = f"subject_{index}"
            clauses.append(f"LOWER(t.subject) = LOWER(:{key})")
            params[key] = term
        sql += " AND (" + " OR ".join(clauses) + ")"

    if grade:
        sql += " AND t.grade = :grade"
        params["grade"] = grade

    sql += " ORDER BY RANDOM() LIMIT :limit"

    result = await db.execute(text(sql), params)
    rows = result.fetchall()
    if not rows:
        return []

    ids = [row.id for row in rows]
    rank_by_id = {
        row.id: _language_file_rank(getattr(row, "file_name", None), language) for row in rows
    }

    chunk_result = await db.execute(select(TextbookChunk).where(TextbookChunk.id.in_(ids)))
    chunks = list(chunk_result.scalars().all())
    chunks.sort(key=lambda chunk: (rank_by_id.get(chunk.id, 1), chunk.id))
    return [chunk for chunk in chunks if _is_usable_practice_content(chunk.content)][:limit]


def build_local_question_payload(
    anchor_chunk: TextbookChunk,
    anchor_metadata: dict[str, Any],
    distractor_chunks: list[TextbookChunk],
    difficulty: str = "MEDIUM",
    language: str = "kz",
) -> dict[str, Any] | None:
    """
    Build a deterministic local fallback question from textbook snippets.

    This keeps quiz/training usable when external model generation is unavailable.
    """
    correct_snippet = _extract_option_snippet(anchor_chunk.content)
    if not correct_snippet:
        return None

    distractor_snippets: list[str] = []
    seen = {correct_snippet.casefold()}
    for chunk in distractor_chunks:
        snippet = _extract_option_snippet(chunk.content)
        if not snippet:
            continue

        normalized = snippet.casefold()
        if normalized in seen:
            continue

        seen.add(normalized)
        distractor_snippets.append(snippet)
        if len(distractor_snippets) == 3:
            break

    if len(distractor_snippets) < 3:
        return None

    options = distractor_snippets[:]
    correct_index = random.randrange(4)
    options.insert(correct_index, correct_snippet)
    correct_position = ["A", "B", "C", "D"][correct_index]
    quote = _normalize_snippet(anchor_chunk.content)[:240]
    is_ru = (language or "kz").lower().startswith("ru")

    return {
        "question": (
            "Какое утверждение прямо подтверждается приведенным фрагментом учебника?"
            if is_ru
            else "Берілген оқулық үзіндісіне қай тұжырым тікелей сәйкес келеді?"
        ),
        "option_a": options[0],
        "option_b": options[1],
        "option_c": options[2],
        "option_d": options[3],
        "correct_answer": correct_position,
        "explanation": (
            "Правильный вариант повторяет смысл цитаты из учебника."
            if is_ru
            else "Дұрыс нұсқа оқулықтағы үзіндінің мағынасын дәл қайталайды."
        ),
        "quote": quote,
        "fallback_source": {
            "title": anchor_metadata["title"],
            "subject": anchor_metadata["subject"],
            "grade": anchor_metadata["grade"],
            "difficulty": difficulty,
        },
    }


def build_bank_question_payload(
    subject: str | None,
    language: str = "kz",
    grade: int | None = None,
) -> dict[str, Any] | None:
    normalized_subject = normalize_subject_name(subject) if subject else None
    if not normalized_subject:
        return None

    bank = LOCAL_PRACTICE_BANK.get(normalized_subject)
    if not bank:
        return None

    entry = random.choice(bank)
    is_ru = (language or "kz").lower().startswith("ru")
    options = list(entry["options_ru"] if is_ru else entry["options_kz"])
    correct_option = options[entry["correct_index"]]
    shuffled = options[:]
    random.shuffle(shuffled)
    correct_position = ["A", "B", "C", "D"][shuffled.index(correct_option)]
    explanation = entry["explanation_ru"] if is_ru else entry["explanation_kz"]
    resolved_grade = grade or 11

    return {
        "question": entry["question_ru"] if is_ru else entry["question_kz"],
        "option_a": shuffled[0],
        "option_b": shuffled[1],
        "option_c": shuffled[2],
        "option_d": shuffled[3],
        "correct_answer": correct_position,
        "explanation": explanation,
        "quote": explanation,
        "subject": normalized_subject,
        "grade": resolved_grade,
        "citation_override": {
            "book": "Curated practice bank",
            "subject": normalized_subject,
            "grade": resolved_grade,
            "page": 0,
            "quote": explanation,
        },
    }


async def transform_to_question(
    anchor_chunk: TextbookChunk,
    anchor_metadata: dict[str, Any],
    difficulty: str = "MEDIUM",
    language: str = "kz",
) -> dict[str, Any] | None:
    """
    Step 2: Use the configured chat model to create an MCQ question with AI-generated distractors.

    The AI creates:
    - A question based on the anchor content
    - The correct answer (from the anchor)
    - 3 plausible but incorrect distractors (AI-generated to be confusing)

    Args:
        anchor_chunk: The chunk containing the correct answer
        anchor_metadata: Metadata about the anchor (title, grade, etc.)
        difficulty: EASY, MEDIUM, or HARD

    Returns:
        Dictionary with question, options, and explanations
    """

    import random

    correct_position = random.choice(["A", "B", "C", "D"])
    subject_label = anchor_metadata.get("subject") or "ҰБТ"

    is_ru = (language or "kz").lower().startswith("ru")
    localized_subject = subject_label

    if is_ru:
        system_prompt = f"""Ты опытный составитель тестов ЕНТ. Создавай вопросы по предмету {localized_subject}.

ТВОЯ ЗАДАЧА:
1. Выбери из фрагмента учебника только один конкретный факт
2. Составь по нему вопрос
3. Возьми правильный ответ из текста
4. Придумай 3 правдоподобных, но неверных варианта

ВАЖНО: ПРАВИЛЬНЫЙ ОТВЕТ ДОЛЖЕН СТОЯТЬ В ВАРИАНТЕ "{correct_position}".
Все поля JSON верни строго на русском языке.

ЗАПРЕЩЕНО:
- задавать вопрос о странице или номере параграфа
- смешивать русский и казахский в формулировках
- писать варианты, которые не относятся к теме

ПРАВИЛА ДЛЯ НЕПРАВИЛЬНЫХ ВАРИАНТОВ:
- они должны быть близки по типу к правильному ответу
- должны звучать правдоподобно
- не должны быть бессмысленными

Верни результат только в формате JSON."""
    else:
        system_prompt = f"""Сен тәжірибелі ҰБТ сұрақ құрастырушысысың. {localized_subject} пәні бойынша тест сұрақтарын жасайсың.

СЕНІҢ МІНДЕТІҢ:
1. Берілген оқулық мәтінінен БІРАҚ ғана нақты факт таңда (адам есімі, жыл, оқиға, орын, т.б.)
2. Осы факт бойынша сұрақ құрастыр
3. Дұрыс жауапты мәтіннен ал
4. 3 ЖАЛҒАН жауап ойлап шығар - олар нанымды болуы керек, бірақ қате

МАҢЫЗДЫ: ДҰРЫС ЖАУАПТЫ "{correct_position}" ВАРИАНТЫНА ҚОЙ!
Қалған варианттарға жалған жауаптарды қой.

ТЫЙЫМ САЛЫНҒАН СҰРАҚТАР:
- БЕТ НӨМІРІ туралы сұрақ ЖАЗБА! (мысалы: "қай бетте?", "неше бетте?" - БОЛМАЙДЫ)
- Параграф нөмірі туралы сұрақ ЖАЗБА
- Тек берілген пән мен мәтінге сай нақты дерек бойынша сұрақ құр

ЖАЛҒАН ЖАУАПТАР (ДИСТРАКТОРЛАР) ЕРЕЖЕЛЕРІ:
- Олар берілген тақырыпқа сәйкес болуы керек (мысалы: дұрыс жауап формула болса, қалған жауаптар да формулаға ұқсас болуы керек)
- Олар оқушыны шатастыратындай нанымды болуы керек
- Мағынасыз немесе байланыссыз жауаптар ЖАЗБА
- Егер дұрыс жауап термин, жыл, формула немесе адам есімі болса, дистракторлар да сол санатқа жақын болуы керек

JSON форматында қайтар."""

    source_excerpt = _normalize_snippet(anchor_chunk.content)

    if is_ru:
        user_prompt = f"""
=== ФРАГМЕНТ УЧЕБНИКА ===
Книга: {anchor_metadata["title"]} ({anchor_metadata["grade"]} класс)
Страница: {anchor_chunk.page_number}

{source_excerpt}

=== ЗАДАНИЕ ===
Составь вопрос уровня {difficulty}.
ПРАВИЛЬНЫЙ ОТВЕТ ОБЯЗАТЕЛЬНО ПОМЕСТИ В ВАРИАНТ "{correct_position}".
Текст вопроса, варианты, объяснение и цитату верни строго на русском языке.

Верни JSON такой структуры:
{{
    "question": "Текст вопроса",
    "option_a": "{"ПРАВИЛЬНЫЙ ответ" if correct_position == "A" else "Неверный, но правдоподобный вариант"}",
    "option_b": "{"ПРАВИЛЬНЫЙ ответ" if correct_position == "B" else "Неверный, но правдоподобный вариант"}",
    "option_c": "{"ПРАВИЛЬНЫЙ ответ" if correct_position == "C" else "Неверный, но правдоподобный вариант"}",
    "option_d": "{"ПРАВИЛЬНЫЙ ответ" if correct_position == "D" else "Неверный, но правдоподобный вариант"}",
    "correct_answer": "{correct_position}",
    "explanation": "Почему {correct_position} — правильный ответ",
    "quote": "Короткая цитата из фрагмента, подтверждающая ответ"
}}
"""
    else:
        user_prompt = f"""
=== ОҚУЛЫҚ МӘТІНІ ===
Кітап: {anchor_metadata["title"]} ({anchor_metadata["grade"]}-сынып)
Бет: {anchor_chunk.page_number}

{source_excerpt}

=== ТАПСЫРМА ===
Осы мәтіннен {difficulty} деңгейлі тест сұрағын құрастыр.
ЕСКЕРТУ: Дұрыс жауапты "{correct_position}" вариантына қой!

Келесі JSON құрылымында қайтар:
{{
    "question": "Сұрақ мәтіні",
    "option_a": "{"ДҰРЫС жауап" if correct_position == "A" else "Жалған жауап"}",
    "option_b": "{"ДҰРЫС жауап" if correct_position == "B" else "Жалған жауап"}",
    "option_c": "{"ДҰРЫС жауап" if correct_position == "C" else "Жалған жауап"}",
    "option_d": "{"ДҰРЫС жауап" if correct_position == "D" else "Жалған жауап"}",
    "correct_answer": "{correct_position}",
    "explanation": "Неге {correct_position} дұрыс - мәтіннен дәлел",
    "quote": "Жауапты дәлелдейтін мәтіннен үзінді"
}}
"""

    try:
        response = await async_client.chat.completions.create(
            model=QUESTION_GENERATION_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=1000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or ""
        result = json.loads(_extract_json_payload(content))

        # Validate required fields
        required_fields = ["question", "option_a", "option_b", "option_c", "option_d"]
        for field in required_fields:
            if field not in result or not result[field]:
                logger.warning(
                    "Missing required field in generated question payload: %s",
                    field,
                )
                return None

        logger.debug("Generated question payload created successfully")
        return result

    except Exception:
        logger.exception("Error transforming model response to question payload")
        if "content" in locals():
            preview = (
                content[:300]
                .encode("unicode_escape", errors="backslashreplace")
                .decode("ascii", errors="ignore")
            )
            # Debug-level: the preview is verbose and only useful when
            # actively investigating a malformed model response. Routing
            # via logger keeps it out of stdout but available on demand.
            logger.debug("Raw model response preview: %s", preview)
        return None


async def generate_practice_question(
    db: AsyncSession,
    subject: str | None = None,
    grade: int | None = None,
    difficulty: str = "MEDIUM",
    language: str = "kz",
    user_id: int | None = None,
) -> GeneratedQuestion | None:
    """
    Main orchestrator: Generate a complete practice question.

    Steps:
    1. Select anchor chunk from textbook
    2. Use GPT-4 to create question + AI-generated distractors
    3. Store in database with citation

    Args:
        db: Database session
        subject: Optional subject filter (default: History)
        grade: Optional grade filter
        difficulty: EASY, MEDIUM, or HARD
        user_id: Optional user ID to track recently seen questions

    Returns:
        GeneratedQuestion object if successful, None otherwise
    """
    # Default to History of Kazakhstan
    if not subject:
        subject = "History of Kazakhstan"
    else:
        subject = normalize_subject_name(subject)

    logger.info(
        "Generating grounded practice question | subject=%s grade=%s",
        subject,
        grade or "Any",
    )

    # Step 1: Select anchor
    logger.debug("Step 1: Selecting anchor chunk")
    question_data: dict[str, Any] | None = None
    anchor = await select_anchor(db, subject=subject, grade=grade, language=language)

    if not anchor:
        logger.info(
            "No subject-specific anchor found for %s; trying curated fallback",
            subject,
        )
        question_data = build_bank_question_payload(
            subject=subject,
            language=language,
            grade=grade,
        )
        anchor = await select_anchor(db, subject=None, grade=None, language=language)

    if not anchor:
        logger.warning("Failed to select anchor chunk for subject=%s", subject)
        return None

    logger.debug("Selected anchor chunk #%s (page %s)", anchor.id, anchor.page_number)

    # Get textbook metadata
    textbook_result = await db.execute(select(Textbook).where(Textbook.id == anchor.textbook_id))
    textbook = textbook_result.scalar_one_or_none()

    if not textbook:
        logger.warning(
            "Could not find textbook for anchor chunk_id=%s textbook_id=%s",
            anchor.id,
            anchor.textbook_id,
        )
        return None

    anchor_metadata = {
        "title": textbook.title,
        "subject": textbook.subject,
        "grade": textbook.grade,
    }

    # Step 2: Transform to question (configured model generates distractors)
    if not question_data:
        logger.debug(
            "Step 2: Creating question + distractors via %s",
            QUESTION_GENERATION_MODEL,
        )
        question_data = await transform_to_question(
            anchor_chunk=anchor,
            anchor_metadata=anchor_metadata,
            difficulty=difficulty,
            language=language,
        )

    if not question_data:
        logger.info("Local fallback: building question from textbook snippets")
        distractors = await select_distractor_chunks(
            db=db,
            subject=subject,
            grade=grade,
            anchor_chunk_id=anchor.id,
            language=language,
        )
        question_data = build_local_question_payload(
            anchor_chunk=anchor,
            anchor_metadata=anchor_metadata,
            distractor_chunks=distractors,
            difficulty=difficulty,
            language=language,
        )

    if not question_data:
        logger.info("Curated fallback: building question from subject bank")
        question_data = build_bank_question_payload(
            subject=subject,
            language=language,
            grade=grade or textbook.grade,
        )

    if not question_data:
        logger.warning("Failed to generate question for subject=%s", subject)
        return None

    # Step 3: Create and store GeneratedQuestion
    logger.debug("Step 3: Storing question in database")

    # Get correct answer position from the generated response
    correct_answer = question_data.get("correct_answer", "A")

    citation = question_data.get("citation_override") or {
        "book": textbook.title,
        "subject": textbook.subject,
        "grade": textbook.grade,
        "page": anchor.page_number,
        "quote": question_data.get("quote", anchor.content[:200]),
    }

    explanations = {
        "a": question_data.get("explanation", "Бұл - оқулықтағы дұрыс жауап."),
        "correct_position": correct_answer,  # Store which position is correct
    }

    generated_question = GeneratedQuestion(
        anchor_chunk_id=anchor.id,
        subject=question_data.get("subject", textbook.subject),
        grade=question_data.get("grade", textbook.grade),
        question_text=question_data["question"],
        question_type="factual",
        difficulty=difficulty,
        language=(language or "kz"),
        option_a=question_data["option_a"],
        option_b=question_data["option_b"],
        option_c=question_data["option_c"],
        option_d=question_data["option_d"],
        distractor_chunk_ids=[],  # No longer using chunk-based distractors
        citation=citation,
        explanations=explanations,
    )

    db.add(generated_question)
    await db.commit()
    await db.refresh(generated_question)

    logger.info(
        "Question generated successfully | id=%s subject=%s grade=%s correct=%s",
        generated_question.id,
        generated_question.subject,
        generated_question.grade,
        correct_answer,
    )

    return generated_question
