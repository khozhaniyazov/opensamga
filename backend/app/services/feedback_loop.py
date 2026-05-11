"""
Feedback Loop Service - Self-Improving Chatbot Analysis

This service analyzes failed queries to determine if the failure was due to:
1. RETRIEVAL_BUG: Data exists in DB but AI tools failed to find it
2. MISSING_DATA: Data genuinely doesn't exist in the database
3. AMBIGUOUS: Query is too vague or ambiguous
"""

import json
import logging
import os

import httpx
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

# v3.49 (2026-05-02): replaced 3x print() + 1x bare except: + 1x
# traceback.print_exc() with module logger and narrowed exception
# handlers. Bare except: in run_feedback_loop_batch swallowed
# rollback failures silently.
logger = logging.getLogger(__name__)

from ..models import (
    FailedQuery,
    FailedQueryStatus,
    FailureReason,
    HistoricalGrantThreshold,
    MajorGroup,
    UniversityData,
    UniversityDetail,
)
from .openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

# Initialize OpenAI client
openai_api_key = os.getenv("OPENAI_API_KEY")
# v3.4 (2026-04-29): register so lifespan shutdown can aclose(). Audit #5.
from ..utils.http_client_registry import register_http_client  # noqa: E402

http_client = register_http_client(httpx.AsyncClient(timeout=120.0))  # Longer timeout for analysis
client = AsyncOpenAI(api_key=openai_api_key, http_client=http_client) if openai_api_key else None


async def search_database_broad(query: str, db: AsyncSession) -> dict:
    """
    Perform a broad SQL search across all relevant tables to find matching data.
    Returns a dict with search results from different tables.
    """
    results = {"universities": [], "majors": [], "historical_data": [], "university_details": []}

    try:
        # Search in university_data
        query_lower = query.lower()
        uni_query = (
            select(UniversityData)
            .where(
                or_(
                    func.lower(UniversityData.uni_name).contains(query_lower),
                    func.lower(UniversityData.major_name).contains(query_lower),
                    UniversityData.major_code.contains(query.upper()),
                )
            )
            .limit(10)
        )

        uni_result = await db.execute(uni_query)
        results["universities"] = [
            {"uni_name": u.uni_name, "major_code": u.major_code, "major_name": u.major_name}
            for u in uni_result.scalars().all()
        ]

        # Search in major_groups
        major_query = (
            select(MajorGroup)
            .where(
                or_(
                    func.lower(MajorGroup.group_name).contains(query_lower),
                    MajorGroup.group_code.contains(query.upper()),
                    func.lower(MajorGroup.search_keywords).contains(query_lower),
                )
            )
            .limit(10)
        )

        major_result = await db.execute(major_query)
        results["majors"] = [
            {
                "group_code": m.group_code,
                "group_name": m.group_name,
                "search_keywords": m.search_keywords,
            }
            for m in major_result.scalars().all()
        ]

        # Search in historical_grant_thresholds
        hist_query = (
            select(HistoricalGrantThreshold)
            .where(
                or_(
                    func.lower(HistoricalGrantThreshold.uni_name).contains(query_lower),
                    HistoricalGrantThreshold.major_code.contains(query.upper()),
                )
            )
            .limit(10)
        )

        hist_result = await db.execute(hist_query)
        results["historical_data"] = [
            {
                "uni_name": h.uni_name,
                "major_code": h.major_code,
                "data_year": h.data_year,
                "min_score": h.min_score,
            }
            for h in hist_result.scalars().all()
        ]

        # Search in university_details
        detail_query = (
            select(UniversityDetail)
            .where(
                or_(
                    func.lower(UniversityDetail.full_name).contains(query_lower),
                    func.lower(UniversityDetail.search_keywords).contains(query_lower),
                )
            )
            .limit(10)
        )

        detail_result = await db.execute(detail_query)
        results["university_details"] = [
            {
                "full_name": d.full_name,
                "university_code": d.university_code,
                "search_keywords": d.search_keywords,
            }
            for d in detail_result.scalars().all()
        ]

    except Exception:
        logger.exception("feedback_loop: broad database search failed")

    return results


async def analyze_single_failed_query(
    failed_query: FailedQuery, db: AsyncSession
) -> tuple[FailureReason, str | None, str | None]:
    """
    Analyze a single failed query using LLM agent.
    Returns: (failure_reason, suggested_fix, analysis_notes)
    """
    if not client:
        return FailureReason.UNKNOWN, None, "OpenAI client not initialized"

    # Perform broad database search
    search_results = await search_database_broad(failed_query.user_query, db)

    # Count total matches
    total_matches = (
        len(search_results["universities"])
        + len(search_results["majors"])
        + len(search_results["historical_data"])
        + len(search_results["university_details"])
    )

    # Prepare prompt for LLM judge
    judge_prompt = f"""Ты - эксперт по анализу ошибок поиска в базе данных.

Пользователь спросил: "{failed_query.user_query}"
Чатбот ответил: "{failed_query.ai_response}"

Я выполнил широкий поиск в базе данных и получил следующие результаты:
- Университеты: {len(search_results["universities"])} совпадений
- Специальности: {len(search_results["majors"])} совпадений
- Исторические данные: {len(search_results["historical_data"])} совпадений
- Детали университетов: {len(search_results["university_details"])} совпадений

Примеры найденных данных:
{json.dumps(search_results, ensure_ascii=False, indent=2)[:1000]}

Инструменты, которые использовал чатбот: {json.dumps(failed_query.tool_calls_attempted or [], ensure_ascii=False)}

Твоя задача:
1. Определи причину неудачи:
   - RETRIEVAL_BUG: Если данные ЕСТЬ в базе (total_matches > 0), но чатбот их не нашёл
   - MISSING_DATA: Если данных НЕТ в базе (total_matches == 0)
   - AMBIGUOUS: Если запрос слишком неоднозначный или требует уточнения

2. Если это RETRIEVAL_BUG, предложи конкретное исправление (например, "Добавить алиас 'Политех' к UniversityDetail ID 25" или "Исправить поиск по major_code B057")

3. Напиши краткие заметки анализа (2-3 предложения)

Ответь в формате JSON:
{{
    "failure_reason": "RETRIEVAL_BUG" | "MISSING_DATA" | "AMBIGUOUS",
    "suggested_fix": "конкретное предложение по исправлению или null",
    "analysis_notes": "краткие заметки"
}}
"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Ты эксперт по анализу ошибок поиска. Отвечай ТОЛЬКО валидным JSON.",
                },
                {"role": "user", "content": judge_prompt},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        result_text = response.choices[0].message.content
        result_json = json.loads(result_text)

        # Map string to enum
        reason_str = result_json.get("failure_reason", "UNKNOWN")
        if reason_str == "RETRIEVAL_BUG":
            reason = FailureReason.RETRIEVAL_BUG
        elif reason_str == "MISSING_DATA":
            reason = FailureReason.MISSING_DATA
        elif reason_str == "AMBIGUOUS":
            reason = FailureReason.AMBIGUOUS
        else:
            reason = FailureReason.UNKNOWN

        suggested_fix = result_json.get("suggested_fix")
        analysis_notes = result_json.get("analysis_notes", "")

        return reason, suggested_fix, analysis_notes

    except Exception as e:
        # v3.49: keep `as e` because the existing fallback below
        # interpolates str(e) into the human-readable analysis_notes
        # field (the third return tuple element) so the failed-query
        # admin UI can show *why* analysis fell back. The full stack
        # still goes to the logger.
        logger.exception(
            "feedback_loop: analyze_single_failed_query failed for query_id=%s",
            failed_query.id,
        )

        # Fallback: if we found matches, it's likely a retrieval bug
        if total_matches > 0:
            return (
                FailureReason.RETRIEVAL_BUG,
                None,
                f"Found {total_matches} matches but chatbot failed. Error: {str(e)}",
            )
        else:
            return FailureReason.MISSING_DATA, None, f"No matches found. Error: {str(e)}"


async def analyze_failed_queries(db: AsyncSession, limit: int | None = None) -> dict:
    """
    Analyze all PENDING failed queries.
    Returns statistics about the analysis.
    """
    if not client:
        return {"error": "OpenAI client not initialized", "analyzed": 0}

    # Fetch pending queries
    query = (
        select(FailedQuery)
        .where(FailedQuery.status == FailedQueryStatus.PENDING)
        .order_by(FailedQuery.timestamp.desc())
    )

    if limit:
        query = query.limit(limit)

    result = await db.execute(query)
    pending_queries = result.scalars().all()

    if not pending_queries:
        return {"analyzed": 0, "message": "No pending queries to analyze"}

    stats = {
        "analyzed": 0,
        "retrieval_bugs": 0,
        "missing_data": 0,
        "ambiguous": 0,
        "unknown": 0,
        "errors": 0,
    }

    for failed_query in pending_queries:
        try:
            reason, suggested_fix, analysis_notes = await analyze_single_failed_query(
                failed_query, db
            )

            # Update the failed query
            failed_query.status = FailedQueryStatus.ANALYZED
            failed_query.failure_reason = reason
            failed_query.suggested_fix = suggested_fix
            failed_query.analysis_notes = analysis_notes

            await db.commit()

            stats["analyzed"] += 1
            if reason == FailureReason.RETRIEVAL_BUG:
                stats["retrieval_bugs"] += 1
            elif reason == FailureReason.MISSING_DATA:
                stats["missing_data"] += 1
            elif reason == FailureReason.AMBIGUOUS:
                stats["ambiguous"] += 1
            else:
                stats["unknown"] += 1

        except Exception:
            logger.exception(
                "feedback_loop: error processing failed query_id=%s",
                failed_query.id,
            )
            stats["errors"] += 1
            try:
                await db.rollback()
            except Exception:
                # Rollback failure is rare and non-actionable here;
                # log at debug so it doesn't drown the queue worker
                # with the same scrollback every iteration.
                logger.debug(
                    "feedback_loop: rollback failed after process error; ignoring",
                    exc_info=True,
                )

    return stats
