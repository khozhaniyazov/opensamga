from __future__ import annotations

import asyncio
import logging
import re
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.vector_search import get_embedding
from app.utils.textbook_metadata import build_catalog_title
from app.utils.textbook_quality import (
    build_textbook_snippet,
    is_usable_textbook_content,
    looks_like_bibliography,
    looks_like_review_or_intro,
)

logger = logging.getLogger(__name__)


# Session 15 (2026-04-21): observability. Every call to
# `search_library_chunks` fires-and-forgets a row into `rag_query_log`.
# Never blocks the retrieval path; any exception while logging is
# swallowed.
async def _log_rag_query(
    db: AsyncSession,
    *,
    user_id: int | None,
    query: str,
    subject: str | None,
    grade: int | None,
    preferred_grade: int | None,
    n_candidates: int,
    n_returned: int,
    rerank_on: bool,
    rerank_used: bool,
    top1_book_id: int | None,
    top1_page: int | None,
    top1_score: float | None,
    top1_subject: str | None,
    top1_grade: int | None,
    embedding_latency_ms: int | None,
    search_latency_ms: int | None,
    rerank_latency_ms: int | None,
    total_latency_ms: int,
    error: str | None,
) -> int | None:
    try:
        # Use a separate short-lived connection so we never pollute the
        # caller's transaction and don't fight an in-progress rollback.
        from app.database import engine  # local import to avoid cycles

        async with engine.begin() as conn:
            r = await conn.execute(
                text(
                    """
                    INSERT INTO rag_query_log (
                        user_id, query, query_len, subject, grade,
                        preferred_grade, n_candidates, n_returned,
                        rerank_on, rerank_used,
                        top1_book_id, top1_page, top1_score,
                        top1_subject, top1_grade,
                        embedding_latency_ms, search_latency_ms,
                        rerank_latency_ms, total_latency_ms, error
                    ) VALUES (
                        :user_id, :query, :query_len, :subject, :grade,
                        :preferred_grade, :n_candidates, :n_returned,
                        :rerank_on, :rerank_used,
                        :top1_book_id, :top1_page, :top1_score,
                        :top1_subject, :top1_grade,
                        :embedding_latency_ms, :search_latency_ms,
                        :rerank_latency_ms, :total_latency_ms, :error
                    )
                    RETURNING id
                    """
                ),
                {
                    "user_id": user_id,
                    "query": (query or "")[:4000],
                    "query_len": len(query or ""),
                    "subject": subject,
                    "grade": grade,
                    "preferred_grade": preferred_grade,
                    "n_candidates": n_candidates,
                    "n_returned": n_returned,
                    "rerank_on": rerank_on,
                    "rerank_used": rerank_used,
                    "top1_book_id": top1_book_id,
                    "top1_page": top1_page,
                    "top1_score": top1_score,
                    "top1_subject": top1_subject,
                    "top1_grade": top1_grade,
                    "embedding_latency_ms": embedding_latency_ms,
                    "search_latency_ms": search_latency_ms,
                    "rerank_latency_ms": rerank_latency_ms,
                    "total_latency_ms": total_latency_ms,
                    "error": (error or "")[:500] if error else None,
                },
            )
            return r.scalar()
    except Exception:
        return None


def _embedding_column() -> str:
    """Name of the pgvector column to read for this retrieval path.

    When RAG_USE_MULTILINGUAL is on, read the shadow column
    `chunk_embedding_ml` (populated by
    `backend/scripts/reembed_multilingual.py`). Falls back to the
    legacy column for any chunk that has not been re-embedded yet, via
    the COALESCE wrapper in the SQL template.
    """
    return "chunk_embedding_ml" if settings.RAG_USE_MULTILINGUAL else "chunk_embedding"


SHORT_SEARCH_TERMS = {"sql", "html", "css", "xml", "csv", "api", "oop", "dns", "ip"}

SEARCH_STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "between",
    "from",
    "have",
    "into",
    "just",
    "that",
    "them",
    "there",
    "these",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
    "как",
    "какая",
    "какие",
    "какой",
    "каком",
    "какую",
    "когда",
    "который",
    "которые",
    "между",
    "можно",
    "нужно",
    "после",
    "почему",
    "такой",
    "такое",
    "таком",
    "только",
    "через",
    "чтобы",
    "бұл",
    "бар",
    "болды",
    "болып",
    "дегеніміз",
    "және",
    "қалай",
    "қандай",
    "қандайы",
    "қандайша",
    "маған",
    "мен",
    "неге",
    "нені",
    "оның",
    "туралы",
    "үшін",
}

SUBJECT_ALIASES: dict[str, list[str]] = {
    "Informatics": ["Informatics", "Информатика"],
    "Mathematics": ["Mathematics", "Математика"],
    "Physics": ["Physics", "Физика"],
    "Chemistry": ["Chemistry", "Химия"],
    "Biology": ["Biology", "Биология"],
    "History of Kazakhstan": ["History of Kazakhstan", "История Казахстана"],
    "Geography": ["Geography", "География"],
}

SUBJECT_KEYWORDS: dict[str, list[str]] = {
    "Informatics": [
        "информат",
        "algorithm",
        "алгорит",
        "массив",
        "array",
        "sql",
        "database",
        "база данных",
        "деректер қоры",
        "таблица",
        "кесте",
        "поле",
        "өріс",
        "query",
        "запрос",
        "сұраныс",
        "sort",
        "сортиров",
        "цикл",
        "loop",
        "function",
        "функц",
        "формула",
        "spreadsheet",
        "электронная таблица",
        "электрондық кесте",
        "diagram",
        "диаграм",
        "программ",
        "код",
    ],
    "Mathematics": [
        "математ",
        "теңдеу",
        "уравнен",
        "функц",
        "function",
        "логарифм",
        "туынды",
        "производн",
        "интеграл",
        "геометр",
        "алгебр",
        "пирамида",
        "треуголь",
        "radius",
        "радиус",
        "формула",
        # BUG-12 v3 follow-up: short concept names that used to fall
        # through to subject=None and pull in Informatics junk.
        "дискриминант",
        "discrimin",
        "квадратн",
        "квадрат тең",
        "квадраттық",
        "корень",
        "түбір",
        "root",
        "синус",
        "косинус",
        "тангенс",
        "матриц",
        "вектор",
        "многочлен",
        "көпмүше",
        "производ",
        "парабол",
    ],
    "Physics": [
        "физик",
        "жылдамд",
        "скорост",
        "ускорен",
        "энерг",
        "күш",
        "сила",
        "давлен",
        "электр",
        "магнит",
        "motion",
        "newton",
        "ньютон",
        # BUG-12 v3 follow-up
        "тяготен",
        "гравита",
        "гравитац",
        "тартылыс",
        "маятник",
        "оптик",
        "оптика",
        "линза",
        "прелом",
        "сынуы",
        "колебан",
        "тербел",
        "волн",
        "толқын",
        "импульс",
        "момент",
    ],
    "Chemistry": [
        "хими",
        "реакц",
        "моляр",
        "атом",
        "ион",
        "қышқыл",
        "кислот",
        "щелоч",
        "organic",
        "органик",
        # BUG-12 v3 follow-up
        "моль",
        "оксид",
        "валент",
        "изотоп",
        "электролиз",
        "катализ",
        "периодич",
        "менделеев",
    ],
    "Biology": [
        "биолог",
        "клетк",
        "жасуш",
        "ген",
        "днк",
        "эколог",
        "эволюц",
        "организм",
        # BUG-12 v3 follow-up
        "фотосинтез",
        "митоз",
        "мейоз",
        "хромосом",
        "белок",
        "нуклеин",
        "митохондр",
        "рибосом",
        "мембран",
        "фермент",
    ],
    "History of Kazakhstan": [
        "история",
        "тарих",
        "казахстан",
        "қазақ",
        "хан",
        "көтеріліс",
        "восстан",
        "1916",
        "абылай",
        "аламаты",
        # BUG-12 v3 follow-up
        "ханств",
        "жуз",
        "жүз",
        "султан",
        "ногай",
        "жонгар",
        "жоңғар",
        "аблай",
        "кенесары",
        "алихан",
    ],
    "Geography": [
        "географ",
        "климат",
        "рельеф",
        "горы",
        "таулар",
        "река",
        "озер",
        "көл",
        "степь",
        "дала",
        "полит",
        "карта",
        "границ",
        "шекара",
        "материк",
        "континент",
        "population",
        "халық",
    ],
}


def normalize_subject_value(subject: str | None) -> str:
    return re.sub(r"\s+", " ", (subject or "").strip()).casefold()


def expand_subject_aliases(subject: str | None) -> list[str]:
    normalized = normalize_subject_value(subject)
    if not normalized:
        return []

    for aliases in SUBJECT_ALIASES.values():
        if normalized in {alias.casefold() for alias in aliases}:
            return aliases

    return [subject.strip()]


def infer_subject_from_query(query: str) -> str | None:
    lowered = (query or "").casefold()
    best_subject = None
    best_score = 0

    for subject, keywords in SUBJECT_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in lowered)
        if score > best_score:
            best_subject = subject
            best_score = score

    return best_subject if best_score > 0 else None


def extract_search_terms(query: str) -> list[str]:
    tokens = re.findall(
        r"[0-9A-Za-zА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ]{2,}",
        (query or "").casefold(),
    )
    terms: list[str] = []
    seen: set[str] = set()

    for token in tokens:
        if token in SEARCH_STOPWORDS:
            continue
        if len(token) < 3 and token not in SHORT_SEARCH_TERMS and not token.isdigit():
            continue
        if token not in seen:
            seen.add(token)
            terms.append(token)

    return terms


# BUG-12 follow-up (2026-04-18): Russian/Kazakh suffix-stripper. The
# original search terms path does exact-substring ILIKE, which means
# "дискриминанта" (RU genitive) will not match a KZ chunk that says
# "дискриминант" (no suffix). Strip common suffixes to enable
# cross-lingual prefix matching.
_RU_SUFFIXES = (
    "ами",
    "ями",
    "ого",
    "его",
    "ому",
    "ему",
    "ыми",
    "ими",
    "ость",
    "ем",
    "ой",
    "ий",
    "ый",
    "ая",
    "ое",
    "ее",
    "ые",
    "ии",
    "ию",
    "ия",
    "ей",
    "ах",
    "ях",
    "ам",
    "ям",
    "ов",
    "ев",
    "ы",
    "и",
    "а",
    "о",
    "е",
    "у",
    "я",
)


def stem_search_terms(terms: list[str], min_stem_len: int = 5) -> list[str]:
    """Best-effort prefix-form of each term, keeping only long-enough stems.

    This is deliberately crude (we don't bring in pymorphy to keep the
    dependency graph light). Goal: surface lexical overlap between a
    Russian query token and a Kazakh-language chunk that has the same
    Latin-or-Greek-rooted concept word in its surface form.
    """
    stemmed: list[str] = []
    seen: set[str] = set()
    for t in terms:
        base = t
        for suf in _RU_SUFFIXES:
            if len(base) > len(suf) + min_stem_len and base.endswith(suf):
                base = base[: -len(suf)]
                break
        if len(base) >= min_stem_len and base not in seen:
            seen.add(base)
            stemmed.append(base)
    return stemmed


def keyword_overlap_score(content: str, terms: list[str]) -> int:
    lowered = (content or "").casefold()
    return sum(1 for term in terms if term in lowered)


def _format_result(
    row,
    similarity: float,
    keyword_overlap: int,
    hybrid_score: float,
    snippet_limit: int,
) -> dict:
    clean_title = build_catalog_title(row.title, None, "", row.subject, row.grade)
    # s32 (A5, 2026-04-27): expose textbook freshness so the FE
    # OutdatedDataPill can warn students when a citation is from a
    # snapshot older than ~18 months. The column may be missing on
    # rows that haven't been touched since the alembic migration that
    # added it (defensive: getattr with None default keeps legacy
    # snapshots compatible). Serialised as ISO-8601 UTC for the FE
    # `Date` parser, with naive datetimes promoted to UTC.
    updated_at = getattr(row, "updated_at", None)
    updated_at_iso: str | None = None
    if updated_at is not None:
        try:
            iso = updated_at.isoformat()
            # Postgres TIMESTAMP WITH TIME ZONE comes back as an aware
            # datetime; if a row somehow has a naive datetime, mark it
            # explicit-UTC so the FE doesn't apply local-zone drift.
            if updated_at.tzinfo is None:
                updated_at_iso = f"{iso}+00:00"
            else:
                updated_at_iso = iso
        except Exception:
            updated_at_iso = None
    return {
        "book_id": row.textbook_id,
        "book_title": clean_title,
        "subject": row.subject,
        "grade": row.grade,
        "page_number": row.page_number,
        "content": build_textbook_snippet(row.content, limit=max(snippet_limit, 240)),
        "snippet": build_textbook_snippet(row.content, limit=snippet_limit),
        "citation": f"{row.subject} - {clean_title} (Grade {row.grade}), Page {row.page_number}",
        "relevance_score": round(similarity, 4),
        "similarity_score": round(similarity, 4),
        "keyword_overlap": keyword_overlap,
        "hybrid_score": round(hybrid_score, 4),
        "updated_at": updated_at_iso,
    }


UNT_GRADES = {10, 11}
# A "UNT secondary-school window" — textbooks that are plausibly relevant to
# a grade-10/11 student preparing for ЕНТ/ҰБТ. Used as a soft prior.
UNT_RELEVANT_WINDOW = {8, 9, 10, 11}
GRADE_EXACT_BOOST = 0.12
GRADE_NEAR_BOOST = 0.07  # ±1 grade
GRADE_WINDOW_BOOST = 0.04  # anywhere in the UNT 8–11 window
GRADE_UNT_DEFAULT_BOOST = 0.06
# Penalty applied when a row's grade is far below the UNT window while the
# student is preparing for ЕНТ. Keeps Grade-2 "Математика 2" chunks from
# out-competing Grade-8 algebra chunks on literal-word cosine alone.
# BUG-12 follow-up (2026-04-18): raised from 0.25 → 0.35.
EARLY_PRIMARY_PENALTY = 0.35

# Subjects where primary grades (≤ 6) are NEVER sufficient for an ЕНТ-prep
# student. For History / Geography / Literature the grade-6 textbook is
# frequently the canonical answer (e.g. History of Kazakhstan 6 covers
# the formation of the Kazakh Khanate), so we DON'T penalize those.
STEM_SUBJECTS_FOR_PENALTY = {
    "mathematics",
    "математика",
    "physics",
    "физика",
    "chemistry",
    "химия",
    "biology",
    "биология",
    "informatics",
    "информатика",
}


def _grade_boost(
    row_grade: int | None,
    preferred_grade: int | None,
    row_subject: str | None = None,
) -> float:
    """Soft re-rank bonus/penalty applied after the SQL distance query.

    Returns a float added to `hybrid_score`. Positive boosts lift rows,
    negative values push them down. Range is roughly [-0.35, +0.12].
    """
    if row_grade is None:
        return 0.0

    if preferred_grade is not None:
        diff = abs(row_grade - preferred_grade)
        if diff == 0:
            boost = GRADE_EXACT_BOOST
        elif diff == 1:
            boost = GRADE_NEAR_BOOST
        elif row_grade in UNT_RELEVANT_WINDOW and preferred_grade in UNT_GRADES:
            # e.g. grade-10 user, row from grade-8: still relevant for ЕНТ prep.
            boost = GRADE_WINDOW_BOOST
        else:
            boost = 0.0

        # BUG-12 mitigation: primary-grade penalty only applies to STEM
        # subjects. History / Geography / Literature grade-6 textbooks
        # are frequently the canonical answer for ЕНТ-level questions
        # (the Kazakh Khanate chapter, for instance, lives in History
        # of Kazakhstan 6).
        normalized_subject = (row_subject or "").strip().casefold()
        is_stem = normalized_subject in STEM_SUBJECTS_FOR_PENALTY
        if preferred_grade in UNT_GRADES and row_grade <= 6 and is_stem:
            boost -= EARLY_PRIMARY_PENALTY

        return boost

    # No known user grade — fall back to a default UNT-window bias.
    if row_grade in UNT_GRADES:
        return GRADE_UNT_DEFAULT_BOOST
    if row_grade in UNT_RELEVANT_WINDOW:
        return GRADE_WINDOW_BOOST * 0.5
    return 0.0


def _score_rows(
    rows,
    query_text: str,
    search_terms: list[str],
    snippet_limit: int,
    preferred_grade: int | None = None,
    subject_filter_active: bool = False,
) -> list[dict]:
    lowered_query = (query_text or "").casefold().strip()
    # BUG-12 follow-up (2026-04-18): combine stem + full terms so the
    # keyword bonus fires across RU inflection + KZ surface forms.
    stemmed_terms = stem_search_terms(search_terms)
    scoring_terms = list({*search_terms, *stemmed_terms})
    scored_results: list[dict] = []

    # Session-19 (2026-04-21) cross-lingual floor fix:
    # When an English query targets a RU/KZ corpus subset (the common
    # case for eval queries like bio-07 "How do enzymes catalyze..."),
    # the top cosines cluster at 0.44–0.56 because the embedding model
    # has to bridge languages AND the query has zero surface-form
    # token overlap with the chunk. The old floor `sim<0.55 with
    # keyword_overlap==0` rejected everything.
    #
    # Guardrail: when the caller has already applied a subject filter,
    # the candidate pool is already strongly biased toward relevance,
    # so we can trust cosine alone down to 0.42. Without a subject
    # filter we keep 0.55 to protect precision across subjects.
    NO_KW_FLOOR = 0.42 if subject_filter_active else 0.55
    NO_TERMS_FLOOR = 0.42 if subject_filter_active else 0.50

    for row in rows:
        if not is_usable_textbook_content(row.content):
            continue
        # BUG-12 follow-up (2026-04-18): bibliography / reference-list
        # pages are hard-rejected. These pages list author names and
        # publishers, and their topic-word overlap (e.g. titles like
        # "...неорганической химии...") pushed them to rank #1 for
        # "моль" even though they contain zero instructional content.
        if looks_like_bibliography(row.content):
            continue

        similarity = max(0.0, 1.0 - float(row.distance))
        keyword_overlap = keyword_overlap_score(row.content, scoring_terms)
        exact_phrase = lowered_query and lowered_query in (row.content or "").casefold()

        # Session-10 (2026-04-20): DashScope text-embedding-v4 ships
        # clean ~0.9 cosines on in-topic chunks and ~0.25 on noise.
        # Session-19 (2026-04-21): loosen floors when subject filter
        # is active — the filter already narrows the pool to books
        # that belong to the asked subject, so accepting 0.42 cosine
        # is safe and lets cross-lingual queries (English → RU/KZ
        # chunk) surface the right content.
        if search_terms:
            if keyword_overlap == 0 and similarity < NO_KW_FLOOR:
                continue
        elif similarity < NO_TERMS_FLOOR:
            continue

        hybrid_score = similarity + min(keyword_overlap, 6) * 0.08
        if exact_phrase:
            hybrid_score += 0.15
        hybrid_score += _grade_boost(
            getattr(row, "grade", None),
            preferred_grade,
            getattr(row, "subject", None),
        )

        # BUG-12 follow-up (2026-04-18): soft demotion for intro / review
        # pages. These pages enumerate the topics of the chapter/year
        # without teaching them, so they match on keyword overlap
        # ("дискриминант", "моль", "ханств") at the cosine layer yet
        # teach nothing. Demote, don't hard-reject — if the corpus has
        # nothing better, a review page is still better than nothing.
        if looks_like_review_or_intro(row.content):
            hybrid_score -= 0.18

        # BUG-12 follow-up: demote very short chunks that only win on
        # sparse keyword density. A 120–200 char chunk containing the
        # literal word "ханств" beats a 1500-char chunk that actually
        # teaches the topic, because the short chunk's keyword-density
        # inflates cosine. Cap the contribution for anything under 350
        # chars and worth less than two keyword matches.
        content_length = len(row.content or "")
        if content_length < 350 and keyword_overlap < 2:
            hybrid_score -= 0.10

        scored_results.append(
            _format_result(
                row,
                similarity=similarity,
                keyword_overlap=keyword_overlap,
                hybrid_score=hybrid_score,
                snippet_limit=snippet_limit,
            )
        )

    scored_results.sort(
        key=lambda item: (
            item["hybrid_score"],
            item["keyword_overlap"],
            item["relevance_score"],
        ),
        reverse=True,
    )
    return scored_results


async def search_library_chunks(
    db: AsyncSession,
    query: str,
    *,
    subject: str | None = None,
    grade: int | None = None,
    preferred_grade: int | None = None,
    limit: int = 5,
    snippet_limit: int = 200,
    user_id: int | None = None,
    log_query: bool = True,
) -> list[dict]:
    t_total = time.perf_counter()
    trimmed_query = (query or "").strip()
    if not trimmed_query:
        return []

    t_embed = time.perf_counter()
    query_embedding = await get_embedding(trimmed_query)
    embedding_latency_ms = int((time.perf_counter() - t_embed) * 1000)
    if not query_embedding:
        if log_query:
            await _log_rag_query(
                db,
                user_id=user_id,
                query=trimmed_query,
                subject=subject,
                grade=grade,
                preferred_grade=preferred_grade,
                n_candidates=0,
                n_returned=0,
                rerank_on=bool(settings.RAG_USE_RERANKER),
                rerank_used=False,
                top1_book_id=None,
                top1_page=None,
                top1_score=None,
                top1_subject=None,
                top1_grade=None,
                embedding_latency_ms=embedding_latency_ms,
                search_latency_ms=None,
                rerank_latency_ms=None,
                total_latency_ms=int((time.perf_counter() - t_total) * 1000),
                error="empty_embedding",
            )
        return []

    search_terms = extract_search_terms(trimmed_query)
    query_vector = "[" + ",".join(str(float(value)) for value in query_embedding) + "]"
    # BUG-12 follow-up (2026-04-18): widened candidate pool from 8x → 16x,
    # floor 40. The previous 24-row window often missed the actually-on-
    # topic chunk because primary-school chunks with higher raw cosine
    # displaced it from the candidate pool entirely.
    candidate_limit = max((limit or 5) * 16, 40)

    embed_col = _embedding_column()
    # When running against the shadow column, only consider chunks
    # that have actually been re-embedded. Eliminates the NULL-distance
    # rows that otherwise sort to the top with `<=>` on NULL.
    extra_null_guard = (
        " AND tc.chunk_embedding_ml IS NOT NULL" if settings.RAG_USE_MULTILINGUAL else ""
    )

    sql = f"""
        SELECT
            tc.id,
            tc.textbook_id,
            tc.page_number,
            tc.content,
            t.title,
            t.subject,
            t.grade,
            t.updated_at,
            (tc.{embed_col} <=> CAST(:query_vector AS vector)) AS distance
        FROM textbook_chunks tc
        JOIN textbooks t ON tc.textbook_id = t.id
        WHERE 1=1{extra_null_guard}
    """
    params: dict[str, object] = {
        "query_vector": query_vector,
        "candidate_limit": candidate_limit,
    }

    subject_aliases = expand_subject_aliases(subject)
    if subject_aliases:
        subject_filters = []
        for index, alias in enumerate(subject_aliases):
            param_name = f"subject_{index}"
            subject_filters.append(f"t.subject ILIKE :{param_name}")
            params[param_name] = alias
        sql += f" AND ({' OR '.join(subject_filters)})"

    if grade is not None:
        sql += " AND t.grade = :grade"
        params["grade"] = grade

    # BUG-12 follow-up (2026-04-18): SQL-level grade floor. For ЕНТ-prep
    # students (grade 10/11) hard-exclude grade ≤ 5 textbooks. Below
    # grade 5 the content is primary-school and NEVER teaches the
    # concept the user is asking about; these chunks were winning on
    # raw cosine alone because keyword hits inflate tiny chunks.
    # Grades 6–7 stay in the pool with the soft Python-side penalty.
    effective_preferred = preferred_grade or grade
    if effective_preferred in UNT_GRADES:
        sql += " AND (t.grade IS NULL OR t.grade >= 6)"

    sql += " ORDER BY distance ASC LIMIT :candidate_limit"
    t_search = time.perf_counter()
    result = await db.execute(text(sql), params)
    rows = result.fetchall()
    search_latency_ms = int((time.perf_counter() - t_search) * 1000)

    scored_results = _score_rows(
        rows,
        trimmed_query,
        search_terms,
        snippet_limit,
        preferred_grade=effective_preferred,
        subject_filter_active=bool(subject_aliases),
    )

    if len(scored_results) < limit and search_terms:
        keyword_sql = f"""
            SELECT
                tc.id,
                tc.textbook_id,
                tc.page_number,
                tc.content,
                t.title,
                t.subject,
                t.grade,
                t.updated_at,
                (tc.{embed_col} <=> CAST(:query_vector AS vector)) AS distance
            FROM textbook_chunks tc
            JOIN textbooks t ON tc.textbook_id = t.id
            WHERE 1=1{extra_null_guard}
        """
        keyword_params: dict[str, object] = {
            "query_vector": query_vector,
            "candidate_limit": max(limit * 6, 18),
        }

        if subject_aliases:
            subject_filters = []
            for index, alias in enumerate(subject_aliases):
                param_name = f"kw_subject_{index}"
                subject_filters.append(f"t.subject ILIKE :{param_name}")
                keyword_params[param_name] = alias
            keyword_sql += f" AND ({' OR '.join(subject_filters)})"

        if grade is not None:
            keyword_sql += " AND t.grade = :grade"
            keyword_params["grade"] = grade

        # BUG-12 follow-up: mirror the grade floor on the keyword fallback.
        if effective_preferred in UNT_GRADES:
            keyword_sql += " AND (t.grade IS NULL OR t.grade >= 6)"

        # BUG-12 follow-up (2026-04-18): ILIKE against the RU-inflected
        # search term ("дискриминанта") does not hit a KZ chunk that
        # says "дискриминант" (no Russian genitive). Match against the
        # stemmed form so we catch both.
        stemmed_keyword_terms = stem_search_terms(search_terms)
        kw_probe_terms = list({*search_terms[:10], *stemmed_keyword_terms[:10]})
        keyword_filters = []
        for index, term in enumerate(kw_probe_terms[:15]):
            param_name = f"term_{index}"
            keyword_filters.append(f"tc.content ILIKE :{param_name}")
            keyword_params[param_name] = f"%{term}%"

        if keyword_filters:
            keyword_sql += f" AND ({' OR '.join(keyword_filters)})"
            keyword_sql += " ORDER BY distance ASC LIMIT :candidate_limit"
            keyword_rows = (await db.execute(text(keyword_sql), keyword_params)).fetchall()
            existing_keys = {
                (item["book_id"], item["page_number"], item["snippet"]) for item in scored_results
            }

            for item in _score_rows(
                keyword_rows,
                trimmed_query,
                search_terms,
                snippet_limit,
                preferred_grade=effective_preferred,
                subject_filter_active=bool(subject_aliases),
            ):
                dedupe_key = (item["book_id"], item["page_number"], item["snippet"])
                if dedupe_key in existing_keys:
                    continue
                scored_results.append(item)
                existing_keys.add(dedupe_key)

            scored_results.sort(
                key=lambda item: (
                    item["hybrid_score"],
                    item["keyword_overlap"],
                    item["relevance_score"],
                ),
                reverse=True,
            )

    # Session-10 (2026-04-20): optional cross-encoder rerank over the
    # candidate pool. Only engages when settings.RAG_USE_RERANKER is
    # on; falls back to the cosine ordering transparently if the
    # DashScope call fails.
    rerank_on = bool(settings.RAG_USE_RERANKER)
    rerank_used = False
    rerank_latency_ms: int | None = None
    rerank_error: str | None = None
    if rerank_on and len(scored_results) > 1:
        try:
            from app.services.qwen_dashscope import rerank as _dashscope_rerank

            docs = [r["snippet"] or r.get("content", "") for r in scored_results]
            t_rr = time.perf_counter()
            order = await asyncio.to_thread(
                _dashscope_rerank,
                trimmed_query,
                docs,
            )
            rerank_latency_ms = int((time.perf_counter() - t_rr) * 1000)
            if order and len(order) == len(scored_results):
                reranked = [scored_results[i] for i in order if 0 <= i < len(scored_results)]
                # Preserve original hybrid_score but bump `relevance_score`
                # so downstream callers can see the reranker boost.
                for rank, item in enumerate(reranked):
                    item["relevance_score"] = max(
                        item.get("relevance_score", 0.0),
                        1.0 - rank / max(len(reranked), 1),
                    )
                scored_results = reranked
                rerank_used = True
        except Exception as exc:
            # Logged as info - reranker is best-effort. v3.54: routed
            # through module logger; the rerank_error string is still
            # consumed downstream (rag_query_log telemetry below) so
            # the `as exc` binding is intentionally kept per the
            # v3.52-banked rule.
            rerank_error = f"{type(exc).__name__}: {str(exc)[:120]}"
            logger.info("rerank fallback (cosine order kept): %s", rerank_error)

    final = scored_results[: max(limit, 1)]

    # Session 15 (2026-04-21): observability logging (best-effort).
    # Session 16 (2026-04-21): propagate the rag_query_log row id so
    # callers (chat, feedback UI) can attach it to the assistant
    # message and we can later join chat_feedback -> rag_query_log.
    if log_query:
        top1 = final[0] if final else None
        log_id = await _log_rag_query(
            db,
            user_id=user_id,
            query=trimmed_query,
            subject=subject,
            grade=grade,
            preferred_grade=preferred_grade,
            n_candidates=len(rows),
            n_returned=len(final),
            rerank_on=rerank_on,
            rerank_used=rerank_used,
            top1_book_id=(top1.get("book_id") if top1 else None),
            top1_page=(top1.get("page_number") if top1 else None),
            top1_score=(float(top1.get("relevance_score", 0.0)) if top1 else None),
            top1_subject=(top1.get("subject") if top1 else None),
            top1_grade=(top1.get("grade") if top1 else None),
            embedding_latency_ms=embedding_latency_ms,
            search_latency_ms=search_latency_ms,
            rerank_latency_ms=rerank_latency_ms,
            total_latency_ms=int((time.perf_counter() - t_total) * 1000),
            error=rerank_error,
        )
        if log_id is not None:
            for item in final:
                item["rag_query_log_id"] = int(log_id)

    return final
