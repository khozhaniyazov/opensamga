"""
app/routers/data.py
-------------------
Handles Data Access (Search) and Data Ingestion (Admin).
- Search Universities/Majors (Autocomplete)
- Ingest Scraper Data (Grants)
- Ingest Mock Questions (RAG Embeddings)
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    HistoricalGrantThreshold,
    MajorGroup,
    MockQuestion,
    UniversityData,
    User,
)
from ..services.university_admission_minimums import official_paid_min_score
from ..services.university_catalog import load_university_catalog
from ..services.university_data_confidence import (
    classify_admission_score,
    classify_money_amount,
)
from .admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["data"])

# --- PYDANTIC SCHEMAS ---


class SearchOption(BaseModel):
    id: int  # or str for code
    label: str
    value: str  # The value to store (id or code)


class UniversityCatalogOption(SearchOption):
    city: str | None = None
    university_code: str | None = None
    search_keywords: str | None = None
    total_students: int | None = None
    majors_count: int = 0
    median_grant_threshold: int | None = None
    max_grant_threshold: int | None = None
    popularity_score: int = 0
    popularity_rank: int | None = None
    popularity_tier: str
    prestige_score: int = 0
    prestige_tier: str
    prestige_note: str | None = None
    data_confidence: dict[str, Any] | None = None


class GrantDataRecord(BaseModel):
    # Matches the scraper output structure
    uni_name: str
    major_code: str
    data_year: int
    quota_type: str  # GENERAL / RURAL
    min_score: int
    grants_awarded_count: int | None = None


class MockQuestionCreate(BaseModel):
    subject: str
    topic_tag: str
    question_text: str
    options: dict[str, str]  # {"A": "...", "B": "..."}
    correct_answer: str


class TextbookResponse(BaseModel):
    id: int
    title: str
    subject: str
    grade: int
    file_name: str
    total_pages: int
    total_chunks: int
    created_at: str | None = None
    updated_at: str | None = None


# --- HELPER FUNCTIONS ---


async def get_embedding(text: str) -> list[float]:
    """Generates a vector embedding for RAG.

    v3.6 (2026-04-29): previously hardcoded `text-embedding-3-small`
    (OpenAI, 1536-dim). The DB column `mock_questions.question_embedding`
    is `vector(1024)` (DashScope `text-embedding-v4`, since session
    23c). The first admin call to /api/data/ingest/questions raised a
    pgvector dimension error 500. We now delegate to the canonical
    `services.vector_search.get_embedding`, which routes through the
    right provider based on settings (DashScope by default → 1024).

    Audit finding #2 (backend health audit, 2026-04-29).
    """
    from ..services.vector_search import get_embedding as _canonical_get_embedding

    try:
        return await _canonical_get_embedding(text)
    except Exception as e:
        # Keep the legacy "return [] on failure" contract so the
        # caller can `if not embedding: raise 500`. Logging instead
        # of print() per the project logging convention.
        from ..logging_config import get_logger

        get_logger(__name__).warning("Embedding error in /data/ingest path: %s", e)
        return []


# --- PUBLIC SEARCH ENDPOINTS ---


@router.get("/universities", response_model=list[UniversityCatalogOption])
async def search_universities(
    query: str | None = None,
    major_code: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Autocomplete search for Universities.
    Queries the UniversityDetail table (Canonical source).
    Supports human-friendly search via search_keywords column.

    Examples:
      - "SDU" or "СДУ" finds "Университет имени Сулеймана Демиреля"
      - "KBTU" or "КБТУ" finds "Казахстанско-Британский технический университет"

    v3.29 (2026-05-01): optional ``major_code`` filter — used by the
    Strategy Lab profile-pair simulator deep-link
    (``/dashboard/universities?major_code={code}``). When set, only
    universities whose ``university_data`` has at least one row for
    that major code are returned. Comparison is case-insensitive on
    a stripped string. The major-code filter composes additively
    with ``query``.
    """
    catalog = await load_university_catalog(db)
    summaries = catalog.summaries

    if major_code:
        target = str(major_code).strip().lower()
        if target:
            allowed_ids: set[int] = set()
            for uni_id, rows in catalog.rows_by_id.items():
                for row in rows:
                    code = (row.major_code or "").strip().lower()
                    if code == target:
                        allowed_ids.add(uni_id)
                        break
            summaries = [item for item in summaries if item["id"] in allowed_ids]

    if query:
        normalized = query.strip().lower()

        def haystack(item: dict[str, Any]) -> str:
            parts = [
                item.get("label"),
                item.get("city"),
                item.get("university_code"),
                item.get("search_keywords"),
                item.get("prestige_note"),
            ]
            return " ".join(str(part or "") for part in parts).lower()

        def match_priority(item: dict[str, Any]) -> tuple[int, int, str]:
            label = str(item.get("label") or "").lower()
            city = str(item.get("city") or "").lower()
            code = str(item.get("university_code") or "").lower()
            keywords = str(item.get("search_keywords") or "").lower()

            if label == normalized or code == normalized:
                score = 0
            elif label.startswith(normalized) or code.startswith(normalized):
                score = 1
            elif normalized in keywords:
                score = 2
            elif normalized in label:
                score = 3
            elif normalized in city:
                score = 4
            else:
                score = 5

            return (score, -(item.get("popularity_score") or 0), label)

        summaries = [item for item in summaries if normalized in haystack(item)]
        summaries = sorted(summaries, key=match_priority)

    return [UniversityCatalogOption(**item) for item in summaries]


@router.get("/universities/{university_id}")
async def get_university_details(university_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get detailed information about a specific university by ID.
    Returns full UniversityDetail record with all fields.
    """
    logger.info(f"Fetching university details for ID: {university_id}")
    catalog = await load_university_catalog(db)
    uni = catalog.details_by_id.get(university_id)

    if not uni:
        logger.warning(f"University not found for ID: {university_id}")
        raise HTTPException(status_code=404, detail="Университет не найден")
    summary = catalog.summary_by_id[university_id]
    logger.info(
        f"Found university: {uni.full_name}, Code: {uni.university_code}, Students: {uni.total_students}"
    )

    majors = catalog.rows_by_id.get(university_id, [])
    thresholds = catalog.history_by_id.get(university_id, [])

    majors_with_thresholds: dict[str, dict[str, Any]] = {}
    for major in majors:
        major_code = major.major_code
        if not major_code:
            continue

        entry = majors_with_thresholds.setdefault(
            major_code,
            {
                "code": major_code,
                "name": major.major_name,
                "thresholds": {
                    "general": None,
                    "rural": None,
                    "year": None,
                },
                # Session 15 (2026-04-21): null-grounded tuition. The
                # zero-tuition sentinel lives in 665 rows the scraper
                # couldn't fill; surface them as `null` so the UI can
                # render "not available" instead of lying with "0 тг".
                "tuition_per_year": (
                    major.tuition_per_year if (major.tuition_per_year or 0) > 0 else None
                ),
                "data_confidence": {
                    "thresholds": {
                        "general": classify_admission_score(
                            None,
                            source="historical_grant_thresholds",
                            source_url=uni.source_url,
                        ),
                        "rural": classify_admission_score(
                            None,
                            source="historical_grant_thresholds",
                            source_url=uni.source_url,
                        ),
                    },
                    "tuition_per_year": classify_money_amount(
                        major.tuition_per_year,
                        source="university_data.tuition_per_year",
                        source_url=uni.source_url,
                    ),
                },
                "_general_year": -1,
                "_rural_year": -1,
                # Session 23+ (2026-04-26, F-16 fix): keep the denormalized
                # current-year cutoff from `university_data` as a fallback
                # for when the `historical_grant_thresholds` join via
                # uni_name fails (canonicalization mismatch silently drops
                # rows). Without this, ~30% of cards previously rendered
                # "Общий грант: —" / "Сельская квота: —" for every major.
                "_fallback_general": None,
                "_fallback_rural": None,
            },
        )

        if not entry["name"] and major.major_name:
            entry["name"] = major.major_name

        # If we already inserted an entry without tuition (e.g. from a
        # prior row), prefer the first non-zero tuition we see.
        if entry.get("tuition_per_year") is None and (major.tuition_per_year or 0) > 0:
            entry["tuition_per_year"] = major.tuition_per_year
            entry["data_confidence"]["tuition_per_year"] = classify_money_amount(
                major.tuition_per_year,
                source="university_data.tuition_per_year",
                source_url=uni.source_url,
            )
        elif (
            entry.get("tuition_per_year") is None
            and major.tuition_per_year == 0
            and entry["data_confidence"]["tuition_per_year"]["status"] == "unknown"
        ):
            entry["data_confidence"]["tuition_per_year"] = classify_money_amount(
                0,
                source="university_data.tuition_per_year",
                source_url=uni.source_url,
            )

        # Capture the highest non-null fallback we see across rows for
        # this major (rows can repeat per program form / language).
        general_fallback = getattr(major, "grant_threshold_general", None)
        if general_fallback and general_fallback > 0:
            current = entry["_fallback_general"]
            if current is None or general_fallback > current:
                entry["_fallback_general"] = general_fallback
        elif (
            general_fallback == 0
            and entry["data_confidence"]["thresholds"]["general"]["status"] == "unknown"
        ):
            entry["data_confidence"]["thresholds"]["general"] = classify_admission_score(
                0,
                source="university_data.grant_threshold_general",
                source_url=uni.source_url,
            )

        rural_fallback = getattr(major, "grant_threshold_rural", None)
        if rural_fallback and rural_fallback > 0:
            current = entry["_fallback_rural"]
            if current is None or rural_fallback > current:
                entry["_fallback_rural"] = rural_fallback
        elif (
            rural_fallback == 0
            and entry["data_confidence"]["thresholds"]["rural"]["status"] == "unknown"
        ):
            entry["data_confidence"]["thresholds"]["rural"] = classify_admission_score(
                0,
                source="university_data.grant_threshold_rural",
                source_url=uni.source_url,
            )

    for threshold in sorted(thresholds, key=lambda item: item.data_year or 0, reverse=True):
        entry = majors_with_thresholds.get(threshold.major_code)
        if not entry:
            continue

        threshold_year = threshold.data_year or 0
        if threshold.quota_type == "GENERAL":
            confidence = classify_admission_score(
                threshold.min_score,
                source="historical_grant_thresholds",
                source_url=uni.source_url,
                last_verified_year=threshold.data_year,
            )
            if confidence["status"] == "verified" and threshold_year >= entry["_general_year"]:
                entry["thresholds"]["general"] = confidence["value"]
                entry["_general_year"] = threshold_year
                entry["data_confidence"]["thresholds"]["general"] = confidence
            elif (
                entry["thresholds"]["general"] is None
                and confidence["status"] == "placeholder"
                and entry["data_confidence"]["thresholds"]["general"]["status"] == "unknown"
            ):
                entry["data_confidence"]["thresholds"]["general"] = confidence
        elif threshold.quota_type == "RURAL":
            confidence = classify_admission_score(
                threshold.min_score,
                source="historical_grant_thresholds",
                source_url=uni.source_url,
                last_verified_year=threshold.data_year,
            )
            if confidence["status"] == "verified" and threshold_year >= entry["_rural_year"]:
                entry["thresholds"]["rural"] = confidence["value"]
                entry["_rural_year"] = threshold_year
                entry["data_confidence"]["thresholds"]["rural"] = confidence
            elif (
                entry["thresholds"]["rural"] is None
                and confidence["status"] == "placeholder"
                and entry["data_confidence"]["thresholds"]["rural"]["status"] == "unknown"
            ):
                entry["data_confidence"]["thresholds"]["rural"] = confidence

        latest_verified_year = max(entry["_general_year"], entry["_rural_year"])
        entry["thresholds"]["year"] = latest_verified_year if latest_verified_year > 0 else None

    majors_payload = []
    for item in majors_with_thresholds.values():
        # F-16 fallback: use the denormalized current-year cutoff from
        # `university_data` if the historical join produced nothing.
        if item["thresholds"]["general"] is None and item["_fallback_general"] is not None:
            item["thresholds"]["general"] = item["_fallback_general"]
            item["data_confidence"]["thresholds"]["general"] = classify_admission_score(
                item["_fallback_general"],
                source="university_data.grant_threshold_general",
                source_url=uni.source_url,
            )
        if item["thresholds"]["rural"] is None and item["_fallback_rural"] is not None:
            item["thresholds"]["rural"] = item["_fallback_rural"]
            item["data_confidence"]["thresholds"]["rural"] = classify_admission_score(
                item["_fallback_rural"],
                source="university_data.grant_threshold_rural",
                source_url=uni.source_url,
            )

        item.pop("_general_year", None)
        item.pop("_rural_year", None)
        item.pop("_fallback_general", None)
        item.pop("_fallback_rural", None)
        majors_payload.append(item)

    majors_payload.sort(key=lambda item: ((item["thresholds"]["general"] or 0) * -1, item["code"]))

    return {
        "id": uni.id,
        "full_name": uni.full_name,
        "university_code": uni.university_code,
        "website": uni.website,
        "total_students": uni.total_students,
        "grant_students": uni.grant_students,
        "paid_students": uni.paid_students,
        "military_chair": uni.military_chair,
        "has_dorm": uni.has_dorm,
        "contacts_raw": uni.contacts_raw,
        "source_url": uni.source_url,
        "search_keywords": uni.search_keywords,
        "city": summary.get("city"),
        "majors_count": summary.get("majors_count"),
        "median_grant_threshold": summary.get("median_grant_threshold"),
        "max_grant_threshold": summary.get("max_grant_threshold"),
        "popularity_score": summary.get("popularity_score"),
        "popularity_rank": summary.get("popularity_rank"),
        "popularity_tier": summary.get("popularity_tier"),
        "prestige_score": summary.get("prestige_score"),
        "prestige_tier": summary.get("prestige_tier"),
        "prestige_note": summary.get("prestige_note"),
        "majors": majors_payload,
    }


@router.get("/majors", response_model=list[SearchOption])
async def search_majors(query: str | None = None, db: AsyncSession = Depends(get_db)):
    """
    Autocomplete search for Majors (B001, etc.).
    Queries MajorGroup with human-friendly search via search_keywords.

    Examples:
      - "IT" or "АйТи" finds "B057 - Информационные технологии"
      - "Программист" finds "B057 - Информационные технологии"
      - "Медик" or "врач" finds "B001 - Медицина"
    """
    stmt = select(MajorGroup).limit(20)

    if query:
        stmt = stmt.where(
            or_(
                MajorGroup.group_code.ilike(f"%{query}%"),
                MajorGroup.group_name.ilike(f"%{query}%"),
                MajorGroup.search_keywords.ilike(f"%{query}%"),
            )
        )

    result = await db.execute(stmt)
    majors = result.scalars().all()

    return [
        SearchOption(id=m.id, label=f"{m.group_code} - {m.group_name}", value=m.group_code)
        for m in majors
    ]


# --- ADMIN INGESTION ENDPOINTS ---


@router.post("/ingest/grants")
async def ingest_grant_data(
    records: list[GrantDataRecord],
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest JSON data from the Scraper.
    Updates HistoricalGrantThresholds and aggregates current UniversityData.

    Admin-only. Authorization is enforced via ``require_admin`` —
    returns 403 for non-admin callers.
    """
    processed_count = 0

    for record in records:
        # 1. Insert into Historical Data
        history_entry = HistoricalGrantThreshold(
            uni_name=record.uni_name,
            major_code=record.major_code,
            data_year=record.data_year,
            quota_type=record.quota_type,
            min_score=record.min_score,
            grants_awarded_count=record.grants_awarded_count
            if record.grants_awarded_count and record.grants_awarded_count > 0
            else None,
        )
        db.add(history_entry)

        # 2. Update/Create Aggregate Data (For fast lookup)
        # Check if we have an entry for this Uni + Major
        # Note: This relies on exact string matching for uni_name.
        # Ideally, we should resolve to IDs, but for MVP scraping, strings are safer.
        stmt = select(UniversityData).where(
            UniversityData.uni_name == record.uni_name,
            UniversityData.major_code == record.major_code,
        )
        result = await db.execute(stmt)
        agg_data = result.scalars().first()

        if not agg_data:
            agg_data = UniversityData(
                uni_name=record.uni_name,
                major_code=record.major_code,
                major_name="",  # Scraper might need to provide this, or we lookup from MajorGroup
                min_score_paid=official_paid_min_score(record.uni_name, record.major_code),
                grant_threshold_general=None,
                grant_threshold_rural=None,
            )
            db.add(agg_data)

        # Update thresholds if this is the latest year (e.g., 2024/2025)
        if record.data_year >= 2024:
            if record.quota_type == "GENERAL":
                agg_data.grant_threshold_general = record.min_score
            elif record.quota_type == "RURAL":
                agg_data.grant_threshold_rural = record.min_score

        processed_count += 1

    await db.commit()
    return {"message": f"Successfully processed {processed_count} records."}


@router.post("/ingest/questions")
async def ingest_mock_question(
    question: MockQuestionCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest a new mock question and generate its embedding for RAG.

    Admin-only. Authorization is enforced via ``require_admin`` —
    returns 403 for non-admin callers.
    """
    # 1. Generate Embedding
    # Combine text + options for semantic search context
    context_text = f"{question.question_text} Options: {question.options}"
    embedding = await get_embedding(context_text)

    if not embedding:
        raise HTTPException(status_code=500, detail="Failed to generate embedding")

    # 2. Save to DB
    new_q = MockQuestion(
        subject=question.subject,
        topic_tag=question.topic_tag,
        question_text=question.question_text,
        options=question.options,
        correct_answer=question.correct_answer,
        question_embedding=embedding,
    )
    db.add(new_q)
    await db.commit()

    return {"message": "Question ingested successfully", "id": new_q.id}
