import json
import logging
import os
import re
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

from ..config import settings
from ..constants.subjects import (
    get_compulsory_subjects,
    get_max_score,
    get_subject_by_name,
    normalize_subject_name,
)
from ..database import get_db
from ..models import (
    ActivityLog,
    ExamAttempt,
    FailedQuery,
    FailedQueryStatus,
    StudentProfile,
    UniversityDetail,
    User,
)
from ..models import (
    ChatMessage as ChatMessageModel,
)
from ..models import (
    ChatThread as ChatThreadModel,
)
from ..services.ai_orchestrator import consult_library
from ..services.chat.agent_loop import run_agent_loop
from ..services.chat.context_builder import build_user_context_prompt
from ..services.chat.message_formatter import normalize_markdown
from ..services.chat.parts_shaper import shape_tool_part
from ..services.chat.profile_score_analyzer import (
    build_profile_conflict_system_note,
    build_profile_score_analysis_response,
    detect_profile_prompt_conflict,
)
from ..services.chat.prompts import build_chat_system_prompt
from ..services.chat.storage_manager import save_chat_messages
from ..services.chat.thread_titler import auto_rename_thread_if_first_turn
from ..services.chat.tool_executor import execute_tool
from ..services.chat.tools_registry import tools
from ..services.gap_analyzer import (
    RECENT_RELEVANT_MISTAKE_LIMIT,
    cluster_mistakes_by_topic,
    count_unresolved_mistakes,
)
from ..services.image_ocr import (
    build_ocr_seed,
    classify_ocr_result,
    is_allowed_ocr_content_type,
    is_within_ocr_size_cap,
    ocr_error_message,
)
from ..services.library_retrieval import infer_subject_from_query
from ..services.major_resolver import resolve_major_titles
from ..utils.onboarding import is_onboarding_completed
from .auth import get_current_user, get_current_user_optional

router = APIRouter(tags=["chat"])  # No prefix - endpoint will be /chat
logger = logging.getLogger(__name__)
DEFAULT_CHAT_MODEL = settings.OPENAI_MODEL or "gpt-4o-mini"
PREMIUM_CHAT_MODEL = settings.OPENAI_PREMIUM_MODEL or DEFAULT_CHAT_MODEL

FAILURE_MARKERS = (
    "не удалось найти",
    "не могу найти",
    "не нашел",
    "не нашла",
    "не удалось определить",
    "дерек табылмады",
    "анықтай алмадым",
    "could not find",
    "i could not find",
    "i couldn't find",
)

PERSONAL_CONTEXT_MARKERS = (
    "my profile",
    "my results",
    "my scores",
    "my mistakes",
    "my weak",
    "my progress",
    "мой профиль",
    "мои результаты",
    "мои баллы",
    "мои ошибки",
    "мой прогресс",
    "менің профил",
    "менің нәтиж",
    "менің бал",
    "менің қате",
    "менің әлсіз",
    "менің прогресс",
    "профил",
    "балл",
    "результат",
    "нәтиже",
    "қате",
    "ошиб",
    "gap",
    "олқылық",
    "разрыв",
    "әлсіз",
    "слаб",
    "dream university",
    "арман жоо",
    "университет мечты",
)

ACADEMIC_LIBRARY_MARKERS = (
    "textbook",
    "source",
    "citation",
    "library",
    "учебник",
    "источник",
    "цитат",
    "библиотек",
    "оқулық",
    "дереккөз",
    "кітапхана",
    "page",
    "страниц",
    "бет",
    "explain",
    "solve",
    "formula",
    "theorem",
    "definition",
    "объясни",
    "реши",
    "формула",
    "теорем",
    "определение",
    "түсіндір",
    "шеш",
    "анықтама",
)

EXPLICIT_LIBRARY_MARKERS = (
    "textbook",
    "source",
    "citation",
    "library",
    "учебник",
    "источник",
    "цитат",
    "библиотек",
    "оқулық",
    "дереккөз",
    "кітапхана",
)

UNIVERSITY_ALIAS_HINTS = {
    "кбту": "KBTU",
    "kbtu": "KBTU",
    "aitu": "Astana IT University",
    "астана ит": "Astana IT University",
    "astana it": "Astana IT University",
    "sdu": "SDU University",
    "сду": "SDU University",
    "enu": "ENU",
    "ену": "ENU",
    "narxoz": "Narxoz University",
    "нархоз": "Narxoz University",
    "nu": "Nazarbayev University",
    "назарбаев": "Nazarbayev University",
}

PERSONAL_QUERY_PATTERNS = (
    r"\bmy\b",
    r"\bme\b",
    r"\bcan i\b",
    r"\bshould i\b",
    r"\bмой\b",
    r"\bмоя\b",
    r"\bмои\b",
    r"\bмоим\b",
    r"\bмне\b",
    r"\bдля меня\b",
    r"\bу меня\b",
    r"\bя\b",
    r"\bменің\b",
    r"\bмаған\b",
    r"\bмен\b",
)

UNIVERSITY_CHANCE_MARKERS = (
    "смогу ли",
    "хватит ли",
    "поступить",
    "шанс",
    "грант",
    "порог",
    "admission",
    "chance",
    "grant",
    "түсе",
    "шанс",
    "грант",
)

UNIVERSITY_COMPARISON_MARKERS = (
    "vs",
    "вместо",
    "или",
    "сравни",
    "что лучше",
    "какой лучше",
    "лучше выбрать",
    "better",
    "compare",
    "қайсысы жақсы",
    "салыстыр",
)

UNIVERSITY_OPTIONS_MARKERS = (
    "куда лучше",
    "куда мне лучше",
    "куда подать",
    "куда мне подать",
    "лучше подать",
    "куда поступать",
    "безопас",
    "целев",
    "вариант",
    "рекомен",
    "safe",
    "target",
    "recommend",
    "best options",
    "қайда тапсыру",
    "қауіпсіз",
    "мақсатты",
    "ұсын",
)


def should_use_library_context(text: str) -> bool:
    """Only retrieve textbook context for academic/source-seeking turns.

    Profile/progress prompts often contain subject names ("Mathematics",
    "Informatics") but are asking about the user's own onboarding, exam,
    mistakes, or gap-analysis data. Treating those as library questions caused
    unrelated citation chips to appear on otherwise-correct personal answers.
    """
    lowered = (text or "").casefold()
    if not lowered.strip():
        return False

    has_personal_marker = any(marker in lowered for marker in PERSONAL_CONTEXT_MARKERS)

    if has_personal_marker and not any(marker in lowered for marker in EXPLICIT_LIBRARY_MARKERS):
        return False

    return True


def infer_grade_from_query(text: str) -> int | None:
    if not text:
        return None

    patterns = [
        r"\b([1-9]|1[0-2])\s*(?:сынып|класс|grade)\b",
        r"(?:сынып|класс|grade)\s*([1-9]|1[0-2])\b",
        r"(?:алгебра|algebra|математика|mathematics|информатика|informatics)\s*([1-9]|1[0-2])\b",
    ]
    lowered = text.casefold()
    for pattern in patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def strip_reasoning_blocks(text: str) -> str:
    """Remove provider reasoning + stray tool-call artifacts before
    returning content to the UI.

    Session 22 (2026-04-22): the Dashscope/failover providers
    (qwen3.5/qwen-plus, kimi, minimax) sometimes emit literal
    ``<function_calls>…</function_calls>`` and ``[TOOL_CALL]…[/TOOL_CALL]``
    markers as prose when the router does not request the
    function-calling channel (notably the WS path, which is
    stream-only, non-tool-calling). If we pass those through they
    render as garbage tags inside the assistant bubble. Scrub them
    defensively. We also tolerate orphan open/close tags in case the
    model emitted only one side before stopping.
    """
    if not text:
        return ""
    cleaned = text
    # Full paired blocks first.
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"<function_calls>[\s\S]*?</function_calls>",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\[TOOL_CALL\][\s\S]*?\[/TOOL_CALL\]",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    # Orphan openers/closers (truncated stream, etc.).
    cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?function_calls>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[/?TOOL_CALL\]", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _visible_assistant_content(raw_content: str | None) -> str:
    return strip_reasoning_blocks(normalize_markdown(raw_content or "")).strip()


def _empty_response_fallback(language: str) -> str:
    return (
        "Извините, ответ от модели получился пустым. Попробуйте ещё раз."
        if language != "kz"
        else "Кешіріңіз, модельдің жауабы бос болып шықты. Қайтадан көріңіз."
    )


async def _recover_blank_assistant_content(
    *,
    model_name: str,
    messages: list[dict],
    language: str,
) -> str:
    recovery_instruction = (
        "Предыдущий черновик ответа оказался пустым после удаления внутренних блоков. "
        "Сформулируй один обычный видимый ответ для пользователя без tool-calls и без <think>."
        if language != "kz"
        else "Алдыңғы жауаптың көрінетін бөлігі бос болып қалды. "
        "Пайдаланушыға арналған бір кәдімгі көрінетін жауап бер, tool-call мен <think> қоспа."
    )
    recovery_messages = [
        *messages,
        {"role": "system", "content": recovery_instruction},
    ]

    try:
        recovery_response = await client.chat.completions.create(
            model=model_name,
            messages=recovery_messages,
        )
    except Exception as exc:  # noqa: BLE001 — broad: any LLM/transport failure → fallback message
        logger.warning("recovery completion failed; returning empty fallback: %s", exc)
        return _empty_response_fallback(language)

    if not recovery_response.choices:
        return _empty_response_fallback(language)

    recovery_message = recovery_response.choices[0].message
    content = _visible_assistant_content(getattr(recovery_message, "content", None))
    return content or _empty_response_fallback(language)


def _format_major_label(label: str) -> str:
    text = str(label or "").strip()
    match = re.match(r"^([A-Za-z]\d{3})\s+[—-]\s+(.+)$", text)
    if match:
        return f"{match.group(2).strip()} ({match.group(1).upper()})"
    return text


def _extract_explicit_university_hints(text: str) -> list[str]:
    original = text or ""
    lowered = original.casefold()
    if not lowered.strip():
        return []

    positioned_hits: list[tuple[int, str]] = []
    for alias, canonical in UNIVERSITY_ALIAS_HINTS.items():
        for match in re.finditer(re.escape(alias), lowered):
            positioned_hits.append((match.start(), canonical))

    for match in re.finditer(
        r"\b([a-z][a-z0-9&.-]*(?:\s+[a-z][a-z0-9&.-]*){0,4}\s+university)\b",
        lowered,
    ):
        start, end = match.span(1)
        positioned_hits.append((start, original[start:end].strip()))

    for match in re.finditer(
        r"\b([а-яё][а-яё0-9-]*(?:\s+[а-яё][а-яё0-9-]*){0,4}\s+университет)\b",
        lowered,
    ):
        start, end = match.span(1)
        positioned_hits.append((start, original[start:end].strip()))

    positioned_hits.sort(key=lambda item: item[0])
    deduped: list[str] = []
    seen: set[str] = set()
    for _, university_name in positioned_hits:
        key = str(university_name).casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(university_name)
    return deduped


def _has_personal_query_scope(text: str) -> bool:
    lowered = (text or "").casefold()
    if not lowered.strip():
        return False
    if "samga" in lowered or any(marker in lowered for marker in PERSONAL_CONTEXT_MARKERS):
        return True
    return any(re.search(pattern, lowered) for pattern in PERSONAL_QUERY_PATTERNS)


def _detect_personal_university_advice_mode(text: str) -> tuple[str | None, list[str]]:
    lowered = (text or "").casefold()
    if not lowered.strip():
        return None, []

    if not _has_personal_query_scope(lowered):
        return None, []

    university_hints = _extract_explicit_university_hints(text)
    has_chance_scope = any(marker in lowered for marker in UNIVERSITY_CHANCE_MARKERS)
    has_comparison_scope = any(marker in lowered for marker in UNIVERSITY_COMPARISON_MARKERS)
    has_options_scope = any(marker in lowered for marker in UNIVERSITY_OPTIONS_MARKERS)

    if has_comparison_scope and len(university_hints) >= 2:
        return "compare", university_hints[:2]
    if has_options_scope:
        return "options", university_hints[:2]
    if has_chance_scope and university_hints:
        return "single", university_hints[:1]
    return None, []


def _should_attach_user_context(
    text: str,
    profile_conflict: object | None = None,
) -> bool:
    lowered = (text or "").casefold()
    if not lowered.strip():
        return False
    if profile_conflict is not None:
        return True
    if "samga" in lowered:
        return True
    if any(marker in lowered for marker in PERSONAL_CONTEXT_MARKERS):
        return True
    if _has_personal_query_scope(text):
        return True
    return any(
        marker in lowered
        for marker in (
            "мой",
            "менің",
            "my",
            "profile",
            "профиль",
            "профил",
            "mistake",
            "ошиб",
            "қате",
            "exam",
            "пробник",
            "емтихан",
        )
    )


def _profile_total_score(user: User | None) -> int | None:
    profile = getattr(user, "profile", None) if user else None
    if not profile or not isinstance(profile.last_test_results, dict):
        return None

    latest_scores: dict[str, int] = {}
    for raw_subject, raw_scores in profile.last_test_results.items():
        subject = normalize_subject_name(str(raw_subject))
        if not isinstance(raw_scores, list):
            continue
        max_score = get_max_score(subject)
        valid_scores = []
        for raw_score in raw_scores[:5]:
            try:
                score = int(raw_score)
            except (TypeError, ValueError):
                continue
            if 0 <= score <= max_score:
                valid_scores.append(score)
        if valid_scores:
            latest_scores[subject] = valid_scores[-1]

    chosen_subjects = [
        normalize_subject_name(subject)
        for subject in (profile.chosen_subjects or [])[:2]
        if isinstance(subject, str)
    ]
    required_subjects = [*get_compulsory_subjects(), *chosen_subjects]
    if not required_subjects or any(subject not in latest_scores for subject in required_subjects):
        return None
    return sum(latest_scores[subject] for subject in required_subjects)


def _display_subject_label(subject: str, language: str) -> str:
    subject_obj = get_subject_by_name(subject)
    if not subject_obj:
        return subject
    return subject_obj.name_kz if language == "kz" else subject_obj.name_ru


def _top_profile_reserves(user: User | None, language: str) -> list[tuple[str, int]]:
    profile = getattr(user, "profile", None) if user else None
    if not profile or not isinstance(profile.last_test_results, dict):
        return []

    latest_scores: dict[str, int] = {}
    for raw_subject, raw_scores in profile.last_test_results.items():
        subject = normalize_subject_name(str(raw_subject))
        if not isinstance(raw_scores, list):
            continue
        max_score = get_max_score(subject)
        valid_scores = []
        for raw_score in raw_scores[:5]:
            try:
                score = int(raw_score)
            except (TypeError, ValueError):
                continue
            if 0 <= score <= max_score:
                valid_scores.append(score)
        if valid_scores:
            latest_scores[subject] = valid_scores[-1]

    required_subjects = [
        *get_compulsory_subjects(),
        *[
            normalize_subject_name(subject)
            for subject in (profile.chosen_subjects or [])[:2]
            if isinstance(subject, str)
        ],
    ]
    reserves: list[tuple[str, int]] = []
    for subject in required_subjects:
        if subject not in latest_scores:
            continue
        gap = max(0, get_max_score(subject) - latest_scores[subject])
        if gap > 0:
            reserves.append((_display_subject_label(subject, language), gap))
    reserves.sort(key=lambda item: item[1], reverse=True)
    return reserves


async def _load_target_major_context(
    profile: StudentProfile,
    db: AsyncSession,
) -> tuple[str | None, list[str]]:
    major_input = None
    target_major_labels: list[str] = []
    if getattr(profile, "target_majors", None):
        major_input = str(profile.target_majors[0])
        try:
            target_major_labels = [
                _format_major_label(label)
                for label in await resolve_major_titles(db, profile.target_majors or [])
            ]
        except Exception as exc:  # noqa: BLE001 — broad: any DB/lookup error → empty labels (degraded UI, not failure)
            logger.debug("resolve_major_titles failed; returning empty labels: %s", exc)
            target_major_labels = []
    return major_input, target_major_labels


async def _resolve_historical_threshold_year(
    *,
    db: AsyncSession,
    language: str,
    user: User | None,
    university_hint: str,
    major_input: str | None,
    threshold: int,
) -> int | None:
    raw_history = await execute_tool(
        "get_historical_data",
        {
            "uni_name": university_hint,
            "major_code": major_input,
        },
        db,
        language,
        user_id=user.id if user else None,
    )
    try:
        payload = json.loads(raw_history)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list):
        return None

    matching_years: list[int] = []
    fallback_years: list[int] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        year = row.get("year")
        min_score = row.get("min_score")
        try:
            year_int = int(year)
        except (TypeError, ValueError):
            continue
        fallback_years.append(year_int)
        try:
            if int(min_score) == threshold:
                matching_years.append(year_int)
        except (TypeError, ValueError):
            continue

    if matching_years:
        return max(matching_years)
    if fallback_years:
        return max(fallback_years)
    return None


async def _fetch_university_chance_snapshot(
    *,
    user: User | None,
    db: AsyncSession,
    language: str,
    university_hint: str,
    quota_type: str,
    score: int,
    major_input: str | None,
    major_text: str,
) -> dict | None:
    raw_tool_response = await execute_tool(
        "check_grant_chance",
        {
            "uni_name": university_hint,
            "major_code": major_input,
            "score": score,
            "quota_type": quota_type or "GENERAL",
        },
        db,
        language,
        user_id=user.id if user else None,
    )
    shaped = shape_tool_part(
        "check_grant_chance",
        {
            "uni_name": university_hint,
            "major_code": major_input,
            "score": score,
            "quota_type": quota_type or "GENERAL",
        },
        raw_tool_response,
    )
    if not shaped:
        return None

    try:
        payload = json.loads(raw_tool_response)
    except (TypeError, json.JSONDecodeError):
        payload = {}

    data = shaped["result"]["data"]
    threshold = data.get("threshold")
    if threshold is None:
        return None

    threshold_int = int(threshold)
    data_year = payload.get("data_year")
    if data_year is None:
        data_year = await _resolve_historical_threshold_year(
            db=db,
            language=language,
            user=user,
            university_hint=university_hint,
            major_input=major_input,
            threshold=threshold_int,
        )

    return {
        "university": university_hint,
        "threshold": threshold_int,
        "data_year": data_year,
        "probability": data.get("probability"),
        "margin": score - threshold_int,
        "major_text": major_text,
        "score": score,
    }


def _format_margin_line(language: str, score: int, margin: int) -> str:
    if language == "kz":
        return (
            f"қазіргі {score}/140 база бұл межеден +{margin} жоғары"
            if margin >= 0
            else f"қазіргі {score}/140 базадан +{abs(margin)} жетпейді"
        )
    return (
        f"от текущей базы {score}/140 это запас +{margin}"
        if margin >= 0
        else f"от текущей базы {score}/140 не хватает +{abs(margin)}"
    )


def _format_probability_line(language: str, probability: float | None) -> str:
    if language == "kz":
        if probability is not None and probability >= 0.9:
            return "Шанс қазір жоғары."
        if probability is not None and probability >= 0.5:
            return "Шанс жұмыс диапазонында, бірақ шекараға жақын."
        return "Шанс қазір төмен."

    if probability is not None and probability >= 0.9:
        return "Шанс сейчас высокий."
    if probability is not None and probability >= 0.5:
        return "Шанс рабочий, но близко к границе."
    return "Шанс пока низкий."


def _format_year_text(language: str, data_year: int | None) -> str:
    if data_year is not None:
        return str(data_year)
    return "жылы белгісіз" if language == "kz" else "год данных неизвестен"


def _best_university_snapshot(snapshots: list[dict]) -> dict:
    return max(snapshots, key=lambda item: (item["margin"], item["threshold"] * -1))


def _summarize_reserve_line(language: str, reserves: list[tuple[str, int]]) -> str:
    if not reserves:
        return ""
    if language == "kz":
        line = f"\n\nКелесі қадам: негізгі резерв — {reserves[0][0]} +{reserves[0][1]}."
        if len(reserves) > 1:
            line += f" Одан кейін {reserves[1][0]} +{reserves[1][1]}."
        return line
    line = f"\n\nСледующий шаг: главный резерв сейчас — {reserves[0][0]} +{reserves[0][1]}."
    if len(reserves) > 1:
        line += f" Затем {reserves[1][0]} +{reserves[1][1]}."
    return line


def _build_single_university_advice(
    *,
    language: str,
    snapshot: dict,
    reserves: list[tuple[str, int]],
) -> str:
    year_text = _format_year_text(language, snapshot["data_year"])
    margin_line = _format_margin_line(language, snapshot["score"], snapshot["margin"])
    probability_line = _format_probability_line(language, snapshot["probability"])
    reserve_line = _summarize_reserve_line(language, reserves)

    if language == "kz":
        return (
            f"{snapshot['university']} үшін {snapshot['major_text']} бойынша {snapshot['threshold']}/140 ({year_text}) ориентирін көріп тұрмын. "
            f"Samga профилің бойынша {margin_line}. {probability_line}{reserve_line}"
        )
    return (
        f"По {snapshot['university']} для {snapshot['major_text']} вижу ориентир {snapshot['threshold']}/140 ({year_text}). "
        f"По твоему Samga-профилю {margin_line}. {probability_line}{reserve_line}"
    )


def _build_comparison_university_advice(
    *,
    language: str,
    snapshots: list[dict],
    reserves: list[tuple[str, int]],
) -> str:
    first, second = snapshots[:2]
    best = _best_university_snapshot(snapshots)
    reserve_line = _summarize_reserve_line(language, reserves)

    if language == "kz":
        better_line = f"Егер осы екеуінің бірін қазір негізгі мақсат қылсаң, қауіпсізірек бағыт — {best['university']}."
        comparison_lines = [
            f"- {item['university']}: {item['threshold']}/140 ({_format_year_text('kz', item['data_year'])}), {_format_margin_line('kz', item['score'], item['margin'])}."
            for item in snapshots[:2]
        ]
        return (
            f"Сенің қазіргі Samga базаң {first['score']}/140 болғанда {first['major_text']} бойынша айырма мынадай:\n"
            + "\n".join(comparison_lines)
            + f"\n\n{better_line}{reserve_line}"
        )

    better_line = f"Если выбирать между ними как рабочую цель прямо сейчас, более уверенный вариант — {best['university']}."
    comparison_lines = [
        f"- {item['university']}: {item['threshold']}/140 ({_format_year_text('ru', item['data_year'])}), {_format_margin_line('ru', item['score'], item['margin'])}."
        for item in snapshots[:2]
    ]
    return (
        f"С твоей текущей Samga-базой {first['score']}/140 по {first['major_text']} разница такая:\n"
        + "\n".join(comparison_lines)
        + f"\n\n{better_line}{reserve_line}"
    )


def _format_bucket_items(items: list[dict], *, language: str, label: str) -> str:
    if not items:
        return ""
    lines = [label]
    for item in items:
        year = _format_year_text(language, item.get("data_year"))
        margin = item.get("your_margin", 0)
        if language == "kz":
            margin_text = f"қор +{margin}" if margin >= 0 else f"+{abs(margin)} жетпейді"
        else:
            margin_text = f"запас +{margin}" if margin >= 0 else f"не хватает +{abs(margin)}"
        lines.append(
            f"- {item.get('uni_name')}: {item.get('min_score')}/140 ({year}), {margin_text}"
        )
    return "\n".join(lines)


async def _build_options_university_advice(
    *,
    user: User | None,
    db: AsyncSession,
    language: str,
    score: int,
    major_input: str | None,
    major_text: str,
    quota_type: str,
    reserves: list[tuple[str, int]],
) -> str | None:
    raw_tool_response = await execute_tool(
        "find_universities_by_score",
        {
            "score": score,
            "major_code": major_input,
            "quota_type": quota_type or "GENERAL",
        },
        db,
        language,
        user_id=user.id if user else None,
    )
    try:
        payload = json.loads(raw_tool_response)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("error"):
        return None

    safe = payload.get("safe_universities") or []
    target = payload.get("target_universities") or []
    reach = payload.get("reach_universities") or []
    if not safe and not target and not reach:
        return None

    reserve_line = _summarize_reserve_line(language, reserves)
    if language == "kz":
        sections = [
            f"Сенің Samga базаң {score}/140, ал {major_text} бойынша вектор мынадай:",
            _format_bucket_items(safe[:3], language="kz", label="Қауіпсіз нұсқалар:"),
            _format_bucket_items(target[:3], language="kz", label="Нысаналы нұсқалар:"),
            _format_bucket_items(
                reach[:2], language="kz", label="Күрделірек, бірақ жұмыс істеуге болатын нұсқалар:"
            ),
            "Жұмыс стратегиясы: 2 қауіпсіз + 1 нысаналы өтінім ұста.",
        ]
    else:
        sections = [
            f"С твоей Samga-базой {score}/140 по {major_text} я бы разложил варианты так:",
            _format_bucket_items(safe[:3], language="ru", label="Безопасные варианты:"),
            _format_bucket_items(target[:3], language="ru", label="Целевые варианты:"),
            _format_bucket_items(
                reach[:2], language="ru", label="Более рискованные, но ещё рабочие варианты:"
            ),
            "Рабочая стратегия подачи: 2 безопасных + 1 целевой вариант.",
        ]

    sections = [section for section in sections if section]
    return "\n\n".join(sections) + reserve_line


async def _build_personal_university_tool_fallback(
    *,
    user: User | None,
    db: AsyncSession,
    language: str,
    text: str,
    quota_type: str,
) -> str | None:
    profile = getattr(user, "profile", None) if user else None
    if not profile:
        return None

    mode, university_hints = _detect_personal_university_advice_mode(text)
    if not mode:
        return None

    score = _profile_total_score(user)
    if score is None:
        return None

    major_input, target_major_labels = await _load_target_major_context(profile, db)
    major_text = (
        target_major_labels[0]
        if target_major_labels
        else (major_input or "выбранная группа программ")
    )
    reserves = _top_profile_reserves(user, language)
    if mode == "options":
        return await _build_options_university_advice(
            user=user,
            db=db,
            language=language,
            score=score,
            major_input=major_input,
            major_text=major_text,
            quota_type=quota_type,
            reserves=reserves,
        )

    if mode == "compare":
        snapshots: list[dict] = []
        for university_hint in university_hints[:2]:
            snapshot = await _fetch_university_chance_snapshot(
                user=user,
                db=db,
                language=language,
                university_hint=university_hint,
                quota_type=quota_type,
                score=score,
                major_input=major_input,
                major_text=major_text,
            )
            if snapshot:
                snapshots.append(snapshot)
        if len(snapshots) < 2:
            return None
        return _build_comparison_university_advice(
            language=language,
            snapshots=snapshots,
            reserves=reserves,
        )

    snapshot = await _fetch_university_chance_snapshot(
        user=user,
        db=db,
        language=language,
        university_hint=university_hints[0],
        quota_type=quota_type,
        score=score,
        major_input=major_input,
        major_text=major_text,
    )
    if not snapshot:
        return None
    return _build_single_university_advice(
        language=language,
        snapshot=snapshot,
        reserves=reserves,
    )


def _strip_not_found_sentences(content: str) -> str:
    """When we have a trusted citation, remove contradictory 'not found' lines
    that the LLM may have produced in parallel.

    Handles both RU ("Не найдено в библиотеке") and KZ ("Кітапханада табылмады")
    variants, and in both *bolded* (``*(...)*``) and bare (``(...)``) forms. The
    bare form started appearing when the model places the parenthetical inline
    with the citation line (e.g. ``📚 *Дереккөз: математика оқулығы
    (Кітапханада табылмады)*``) — the regex set below catches both shapes.
    """
    if not content:
        return content
    patterns = [
        # Full-star form with optional trailing clause, e.g.
        #   "*(Не найдено в библиотеке)*"
        #   "*(Не найдено в библиотеке — ответ на основе общих знаний)*"
        # The `(?:\\?\*|\*)?` prefix tolerates a literal `\*` that some
        # models emit inside the parens when they try to "escape" the star
        # that follows the `(` — we saw this in geo-political-ru where the
        # tail read `*(\*Не найдено в библиотеке — информация ...)*`.
        r"\*\(\s*(?:\\\*|\*)?\s*Не найдено в библиотеке[^)]*\)\*",
        r"\*\(\s*(?:\\\*|\*)?\s*Кітапханада табылмады[^)]*\)\*",
        # Bare parenthetical (may appear inside another *...* span or on its own),
        # also allowing an em-dash / dash clause inside the parens and the
        # same optional escape-star prefix.
        r"\s*\(\s*(?:\\\*|\*)?\s*Не найдено в библиотеке[^)]*\)",
        r"\s*\(\s*(?:\\\*|\*)?\s*Кітапханада табылмады[^)]*\)",
        # Explicit "source not found" labels
        r"📚\s*\*Источник не найден[^\n*]*\*",
        r"📚\s*\*Дереккөз табылмады[^\n*]*\*",
        # Whole-sentence apologies that start with "К сожалению/Кешіріңіз" and
        # mention library/textbooks. Case-insensitive, line-anchored. We stop
        # at the sentence boundary (`.`, `!`, `?`) rather than end-of-line so
        # that if the model places the apology and the real answer on the
        # same line we don't swallow the answer with it.
        r"(?mi)^.{0,10}(?:К сожалению|Кешіріңіз|Sorry)[^\n.!?]*?(?:библиотек|учебник|кітапхана|оқулық|library|textbook)[^\n.!?]*[.!?\n]?\s?",
        # Newer KZ apology shape: "Кешіріңіз, бұл тақырыпты кітапханада таба алмадым."
        r"(?mi)^.{0,10}Кешіріңіз[^\n.!?]*?кітапханада таба алма[^\n.!?]*[.!?\n]?\s?",
        # Model's self-narrated KZ "library-miss" preamble, e.g.:
        #   "Кітапханада бұл тақырып табылмады, бірақ меншікті біліміммен түсіндіремін:"
        # Stop at the first terminator so the "бірақ …" payload that follows
        # survives.
        r"(?mi)^.{0,10}Кітапханада[^\n.!?:]*?(?:табылмады|таба алма)[^\n.!?:]*[.!?:\n]?\s?",
    ]
    cleaned = content
    for p in patterns:
        cleaned = re.sub(p, "", cleaned, flags=re.IGNORECASE)
    # Fix citation labels that ended up with a trailing space before the closing *
    cleaned = re.sub(r":\s+\*", ":*", cleaned)
    cleaned = re.sub(r"\s+\*(\s*\n)", r"*\1", cleaned)
    # Collapse runs of blank lines introduced by removals
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def apply_library_outcome_markers(
    content: str,
    language: str,
    citation: str | None = None,
    no_results: bool = False,
    book_id: int | None = None,
    page_number: int | None = None,
) -> str:
    has_citation_marker = any(
        marker in (content or "") for marker in ["Дереккөз:", "Источник:", "Source:"]
    )

    # Phase A (s20c): if the backend knows the exact book_id+page that served
    # this turn, embed an HTML comment. `citations.ts::parseCitationSegments`
    # will prefer it over the fuzzy resolver, eliminating mis-attribution
    # when two editions share words ("Algebra 10" vs "Algebra 11").
    def _with_hint(prose: str) -> str:
        if book_id is not None and page_number is not None:
            return (
                f"<!-- samga-citation book_id={int(book_id)} page={int(page_number)} -->\n{prose}"
            )
        return prose

    if citation:
        # A trusted citation overrides any "not found" noise the model emitted.
        cleaned = _strip_not_found_sentences(content)
        # The model sometimes injects a SECOND 📚 line that reads "Кітапханада
        # табылмады" / "Источник не найден" right after our real citation.
        # Strip those spurious headers explicitly so the single true citation
        # we prepend below is the only one in the output.
        spurious_headers = [
            r"(?m)^📚\s*\*?\s*Кітапханада табылмады\s*\*?\s*$",
            r"(?m)^📚\s*\*?\s*Не найдено в библиотеке\s*\*?\s*$",
            r"(?m)^📚\s*\*?\s*Источник не найден[^\n]*\*?\s*$",
            r"(?m)^📚\s*\*?\s*Дереккөз табылмады[^\n]*\*?\s*$",
        ]
        for pat in spurious_headers:
            cleaned = re.sub(pat, "", cleaned).strip()
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

        # Session 22: guard against the "only citation, no prose" render bug.
        # If our strippers reduced the body below a meaningful threshold
        # (e.g. the model's entire answer was a single apology sentence
        # scrubbed by `_strip_not_found_sentences`), keep the original
        # content instead of prepending a citation onto emptiness. The FE
        # would otherwise render just the chip with no explanation.
        body_without_citation = re.sub(
            r"📚\s*\*?[^\n]*(?:Page|Страница|Бет)\s*\d+[^\n]*\*?",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip()
        if len(body_without_citation) < 40 and (content or "").strip():
            # Re-derive `cleaned` from the raw content with ONLY the spurious
            # "not found" banner removed — preserve everything else.
            cleaned = content.strip()
            for pat in spurious_headers:
                cleaned = re.sub(pat, "", cleaned).strip()
            cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
            body_without_citation = re.sub(
                r"📚\s*\*?[^\n]*(?:Page|Страница|Бет)\s*\d+[^\n]*\*?",
                "",
                cleaned,
                flags=re.IGNORECASE,
            ).strip()

        # Session 22: the model itself sometimes returns an empty body after
        # the tool call (1/3 rate observed live). Inject a short fallback
        # prose so users don't see a bare citation chip with nothing to
        # read. This only fires when the body is truly empty after all
        # cleanup — real answers are untouched.
        if not body_without_citation:
            fallback = (
                "Жауап көзден цитатаға негізделген. Толық мәтінді оқу үшін сілтемені ашыңыз."
                if language == "kz"
                else "Ответ основан на указанном источнике. Для полного текста откройте цитату ниже."
            )
            cleaned = fallback

        if not has_citation_marker:
            citation_label = "Дереккөз" if language == "kz" else "Источник"
            return _with_hint(f"📚 *{citation_label}: {citation}*\n\n{cleaned}")
        return _with_hint(cleaned)

    # BUG-11 follow-up: even without a trusted prefetched citation, if the LLM
    # emitted a citation line of its own AND appended a "not found" tail, those
    # two claims contradict each other. Scrub the not-found line so the user
    # sees a coherent response instead of "Дереккөз: X ... (Кітапханада
    # табылмады)".
    if has_citation_marker:
        return _with_hint(_strip_not_found_sentences(content))

    if no_results:
        missing_marker = (
            "*(Кітапханада табылмады)*" if language == "kz" else "*(Не найдено в библиотеке)*"
        )
        if missing_marker not in (content or ""):
            return f"{content}\n\n{missing_marker}".strip()

    return content


def detect_failure(ai_response: str) -> bool:
    response = (ai_response or "").lower()
    return any(marker in response for marker in FAILURE_MARKERS)


async def capture_failed_query(
    user_query: str,
    ai_response: str,
    current_user: User | None,
    tool_calls: list[dict] | None = None,
    db: AsyncSession | None = None,
):
    if not db:
        return

    try:
        failed_query = FailedQuery(
            user_id=current_user.id if current_user else None,
            user_query=user_query,
            ai_response=ai_response,
            status=FailedQueryStatus.PENDING,
            tool_calls_attempted=tool_calls or [],
        )
        db.add(failed_query)
        await db.commit()
    except Exception as capture_error:  # noqa: BLE001 — broad: capture is best-effort, never block the chat turn
        logger.warning("Failed to capture failed query: %s", capture_error)
        try:
            await db.rollback()
        except Exception as rollback_exc:  # noqa: BLE001 — broad: best-effort rollback after a best-effort write
            logger.debug("rollback after failed-query capture failed: %s", rollback_exc)


# Initialize OpenAI client with explicit httpx client to avoid proxy issues
# DEFENSIVE: Check for API key before initializing
openai_api_key = settings.OPENAI_API_KEY.get_secret_value() or os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    logger.warning(
        "OPENAI_API_KEY not set — chat functionality will not work without a valid API key."
    )

# v3.4 (2026-04-29): register so lifespan shutdown can aclose(). Audit #5.
from ..utils.http_client_registry import register_http_client  # noqa: E402

http_client = register_http_client(
    httpx.AsyncClient(timeout=60.0)
)  # Increased timeout for OpenAI calls
client = AsyncOpenAI(api_key=openai_api_key, http_client=http_client)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    user_score: int | None = None
    user_quota: str | None = "GENERAL"
    language: str | None = "ru"
    # s22: optional thread scope. None = legacy "Main chat" bucket. A
    # non-NULL value must belong to `current_user` or the endpoint 404s.
    thread_id: int | None = None


class ChatResponse(BaseModel):
    role: str
    content: str
    # Phase A (s20c): nullable deep-link metadata so the FE can render
    # a first-class citation chip + hover thumbnail without any
    # client-side fuzzy resolution. Absent for non-library turns.
    # Kept as top-level optional fields (not a nested `metadata` dict)
    # to match what chat_endpoint already sets on `response[...]`.
    rag_query_log_id: int | None = None
    book_id: int | None = None
    page_number: int | None = None
    # Phase C (s22): structured tool-result parts for inline cards
    # (GrantChanceGauge, UniComparisonTable, HistoricalThresholdSparkline,
    # RecommendationList). Absent for turns that made no recognised
    # tool call or whose tool response could not be shaped. Validated
    # only as a generic list[dict] at the envelope layer — detailed
    # shape lives in app.services.chat.parts_shaper.
    parts: list[dict] | None = None


class ChatHistoryResponse(BaseModel):
    messages: list[dict]


# --- USER CONTEXT BUILDER ---


# ---------------------------------------------------------------------------
# Agent harness (s24, agent-harness branch, 2026-04-26)
# ---------------------------------------------------------------------------
async def _build_agent_base_messages(
    *,
    request: "ChatRequest",
    db: AsyncSession,
    current_user: User | None,
    language: str,
) -> tuple[list[dict], int]:
    """Build the initial `messages` list for the agent loop.

    Returns (messages, preferred_grade). Replicates the production path's
    system prompt + history truncation logic but drops the eager RAG
    prefetch — the agent decides when to call consult_library itself.
    """
    MAX_HISTORY_MESSAGES = 30
    raw_messages = [{"role": m.role, "content": m.content} for m in request.messages]
    if len(raw_messages) > MAX_HISTORY_MESSAGES:
        truncated = [raw_messages[0]] if raw_messages else []
        truncated.extend(raw_messages[-MAX_HISTORY_MESSAGES:])
        raw_messages = truncated

    last_user_msg = (
        request.messages[-1].content
        if request.messages and request.messages[-1].role == "user"
        else ""
    )

    profile_prompt_conflict = await detect_profile_prompt_conflict(
        current_user, db, last_user_msg or ""
    )

    user_context = ""
    if _should_attach_user_context(last_user_msg or "", profile_prompt_conflict):
        user_context = await build_user_context_prompt(current_user, db, language)

    premium = False
    model_name = DEFAULT_CHAT_MODEL
    if current_user:
        from ..dependencies.plan_guards import _is_premium

        premium = _is_premium(current_user)
        model_name = PREMIUM_CHAT_MODEL if premium else DEFAULT_CHAT_MODEL

    # s26 phase 7: prefer the profile's stored quota over the request
    # body. The body still wins if the FE explicitly overrides (e.g.
    # student temporarily exploring the other quota's thresholds in
    # chat), but a missing/blank request value now falls back to the
    # persisted choice instead of the GENERAL default. This keeps the
    # agent from asking quota questions on minimal prompts.
    profile_quota = None
    if current_user and getattr(current_user, "profile", None) is not None:
        profile_quota = (
            getattr(current_user.profile, "competition_quota", None) or ""
        ).strip().upper() or None
    body_quota = (request.user_quota or "").strip().upper() or None
    effective_quota = body_quota or profile_quota or "GENERAL"

    base_system_prompt = build_chat_system_prompt(
        language,
        user_context=user_context,
        model_name=model_name,
        is_premium=premium,
        active_quota_type=effective_quota,
    )
    profile_conflict_system_note = build_profile_conflict_system_note(
        profile_prompt_conflict, language
    )
    system_content_parts = [base_system_prompt]
    if profile_conflict_system_note:
        system_content_parts.append(profile_conflict_system_note)

    system_msg = {
        "role": "system",
        "content": "\n\n".join(system_content_parts),
    }
    if not raw_messages or raw_messages[0].get("role") != "system":
        raw_messages.insert(0, system_msg)
    else:
        raw_messages[0] = system_msg

    student_grade = None
    if (
        current_user
        and getattr(current_user, "profile", None)
        and getattr(current_user.profile, "current_grade", None)
    ):
        student_grade = current_user.profile.current_grade

    explicit_library_grade = infer_grade_from_query(last_user_msg or "")
    preferred_grade = explicit_library_grade or student_grade
    return raw_messages, preferred_grade


async def _quota_check_only(
    *, current_user: User | None, db: AsyncSession
) -> tuple[bool, str, Any]:
    """v3.84 (2026-05-03): pre-flight quota gate WITHOUT incrementing.

    Returns ``(premium, model_name, counter)``. ``counter`` is the
    today's ``UsageCounter`` row (or ``None`` when ``current_user``
    is anonymous). The caller is expected to invoke
    :func:`_quota_charge` AFTER the model call succeeds — see v3.3
    for the WS-path original of this charge-after-success pattern.

    Pre-v3.84 the REST and SSE chat paths charged the counter
    BEFORE the model call (function name was
    ``_quota_check_and_increment``). Every model timeout, content
    filter, and 5xx burned a daily message off the user's budget.
    The WebSocket path was fixed in v3.3; v3.84 ports the same
    pattern to REST + SSE.

    Raises ``HTTPException(429)`` on quota breach. Anonymous users
    bypass the gate entirely (returns ``(False, default, None)``).
    """
    premium = False
    model_name = DEFAULT_CHAT_MODEL
    if not current_user:
        return premium, model_name, None
    from ..dependencies.plan_guards import (
        PLAN_QUOTAS,
        _get_or_create_counter,
        _is_premium,
    )
    from ..models import SubscriptionTier

    premium = _is_premium(current_user)
    plan = SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE
    model_name = PREMIUM_CHAT_MODEL if premium else DEFAULT_CHAT_MODEL
    counter = await _get_or_create_counter(current_user.id, db)
    limits = PLAN_QUOTAS.get(plan, PLAN_QUOTAS[SubscriptionTier.FREE])
    limit = limits.get("chat_messages", 20)
    if counter.chat_messages >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "quota_exceeded",
                "resource": "chat_messages",
                "limit": limit,
                "used": counter.chat_messages,
                "plan": plan.value,
            },
        )
    return premium, model_name, counter


async def _quota_charge(*, counter: Any, db: AsyncSession) -> None:
    """v3.84: charge one ``chat_messages`` unit. No-op if anonymous.

    Call this AFTER the model has produced a response. If anything
    raises before this commit (model timeout, content-filter trip,
    upstream 5xx, agent-loop crash), the user is not charged.

    Mirror of the v3.3 WS-path "best-effort guard against
    double-spend on a flaky stream" — if the call site bails before
    reaching this commit, the increment never reaches the DB.

    v3.85 (2026-05-03): the bump is now an atomic
    ``UPDATE ... SET chat_messages = chat_messages + 1 ... RETURNING``
    via :func:`_atomic_charge_counter` so two concurrent commits
    on the same UsageCounter row can't both write ``N+1`` and
    undercount the bump. The in-memory ORM row is updated with
    the post-increment value to keep it consistent.
    """
    if counter is None:
        return
    from ..dependencies.plan_guards import _atomic_charge_counter

    new_value = await _atomic_charge_counter(
        user_id=counter.user_id, resource="chat_messages", db=db
    )
    counter.chat_messages = new_value
    await db.commit()


async def _run_chat_agent_loop_path(
    *,
    request: "ChatRequest",
    http_request: Request,
    db: AsyncSession,
    current_user: User | None,
    language: str,
    effective_thread_id: int | None,
) -> dict:
    """Non-streaming agent loop response — drop-in for `/api/chat`.

    Aggregates the agent_loop generator into the same envelope shape
    the FE already understands (`role`, `content`, `parts`, `book_id`,
    `page_number`, `rag_query_log_id`). The streaming variant lives in
    `chat_stream_endpoint` below.
    """
    last_user_len = len(request.messages[-1].content or "")
    if last_user_len > 4000:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Сұрақ тым ұзын ({last_user_len} таңба)."
                if language == "kz"
                else f"Сообщение слишком длинное ({last_user_len} символов)."
            ),
        )

    # v3.84 (2026-05-03): pre-flight check only — charge AFTER the
    # agent loop completes so a crash mid-stream doesn't burn a
    # daily message. The `counter` we hold is the ORM row; mutating
    # + committing it after the loop is the canonical charge path.
    premium, model_name, counter = await _quota_check_only(current_user=current_user, db=db)

    base_messages, preferred_grade = await _build_agent_base_messages(
        request=request, db=db, current_user=current_user, language=language
    )

    last_user_msg = (
        request.messages[-1].content
        if request.messages and request.messages[-1].role == "user"
        else ""
    )

    final_content = ""
    final_parts: list[dict] | None = None
    book_id: int | None = None
    page_number: int | None = None
    rag_query_log_id: int | None = None
    # s27 (C1): captured for envelope + persistence; see streaming branch above.
    unverified_redacted: int = 0
    # s29 (A2): dedup'd citation list for the FE SourcesDrawer.
    consulted_sources: list[dict] = []
    # s30 (A4, 2026-04-27): per-tool failures + general-knowledge flag.
    failed_tool_calls: list[dict] = []
    is_general_knowledge: bool = False

    async for event in run_agent_loop(
        client=client,
        model_name=model_name,
        base_messages=base_messages,
        db=db,
        language=language,
        user_id=current_user.id if current_user else None,
        preferred_grade=preferred_grade,
    ):
        kind = event.get("kind")
        if kind == "done":
            final_content = event.get("content") or ""
            final_parts = event.get("parts")
            book_id = event.get("book_id")
            page_number = event.get("page_number")
            rag_query_log_id = event.get("rag_query_log_id")
            unverified_redacted = int(event.get("unverified_score_claims_redacted") or 0)
            consulted_sources = event.get("consulted_sources") or []
            # s30 (A4 / A6): pull through the trust-signal fields.
            failed_tool_calls = event.get("failed_tool_calls") or []
            is_general_knowledge = bool(event.get("is_general_knowledge"))
        elif kind == "error":
            logger.warning("agent loop error: %s", event.get("message"))

    if not final_content:
        final_content = (
            "Кешіріңіз, жауап алу мүмкін болмады. Қайталап көріңіз."
            if language == "kz"
            else "Извините, не удалось получить ответ. Попробуйте ещё раз."
        )

    # v3.84: charge-after-success. The agent loop completed without
    # raising; per the v3.3 convention, even an empty `final_content`
    # counts because the upstream model call(s) ran. If the loop had
    # raised, control would never reach this line and the user would
    # not be charged.
    await _quota_charge(counter=counter, db=db)

    response: dict[str, Any] = {"role": "assistant", "content": final_content}
    if rag_query_log_id is not None:
        response["rag_query_log_id"] = rag_query_log_id
    if book_id is not None:
        response["book_id"] = book_id
    if page_number is not None:
        response["page_number"] = page_number
    if final_parts:
        response["parts"] = final_parts
    if unverified_redacted:
        # s27 (C1): also bubble the count to the FE on the REST envelope
        # so the non-streaming code path (legacy & fallback) renders the
        # same RedactionPill the streaming path renders.
        response["unverified_score_claims_redacted"] = unverified_redacted
    if consulted_sources:
        # s29 (A2): "Used N sources" drawer feed. Only set when the agent
        # actually consulted the library this turn — saves JSON bytes for
        # zero-hit / non-RAG turns.
        response["consulted_sources"] = consulted_sources
    if failed_tool_calls:
        # s30 (A4): tool-failure pill feed. Only set on actual failures.
        response["failed_tool_calls"] = failed_tool_calls
    if is_general_knowledge:
        # s30 (A6): "answer not personalised" pill. Sent only when
        # true; absence means "regular grounded reply".
        response["is_general_knowledge"] = True

    await save_chat_messages(
        current_user,
        last_user_msg,
        final_content,
        db,
        assistant_metadata={
            "rag_query_log_id": rag_query_log_id,
            "book_id": book_id,
            "page_number": page_number,
            "parts": final_parts if final_parts else None,
            "agent_loop": True,
            # s25 A/B telemetry: non-streaming agent path.
            "chat_path": "agent",
            "stream": False,
            **(
                {"unverified_score_claims_redacted": unverified_redacted}
                if unverified_redacted
                else {}
            ),
            **({"consulted_sources": consulted_sources} if consulted_sources else {}),
            # s30 (A4 / A6): persist trust-signal fields so reload
            # surfaces the same pills the user saw live.
            **({"failed_tool_calls": failed_tool_calls} if failed_tool_calls else {}),
            **({"is_general_knowledge": True} if is_general_knowledge else {}),
        },
        thread_id=effective_thread_id,
    )
    logger.info(
        "chat_turn.completed path=agent stream=False book_id=%s page=%s "
        "rag_log=%s len=%d user_id=%s",
        book_id,
        page_number,
        rag_query_log_id,
        len(final_content or ""),
        current_user.id if current_user else None,
    )

    if last_user_msg and detect_failure(final_content):
        await capture_failed_query(last_user_msg, final_content, current_user, None, db)

    return response


# --- SSE streaming endpoint ------------------------------------------------


def _sse(event: dict) -> str:
    """Format a single Server-Sent Event line."""
    return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"


@router.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """SSE-flavoured agent loop. Emits typed events as the agent works.

    Always uses the agent loop regardless of the CHAT_AGENT_LOOP global —
    this endpoint exists to power the modern-harness UI and there's no
    legacy path to fall back to. The non-streaming `/api/chat` endpoint
    is the place that respects the flag.
    """
    from fastapi.responses import StreamingResponse

    accept_language = http_request.headers.get("Accept-Language", "ru")
    language = (
        accept_language.lower()
        if accept_language.lower() in ["ru", "kz"]
        else (request.language or "ru")
    )

    effective_thread_id: int | None = None
    if request.thread_id and current_user:
        thread_row = await db.execute(
            select(ChatThreadModel).where(
                ChatThreadModel.id == request.thread_id,
                ChatThreadModel.user_id == current_user.id,
            )
        )
        if thread_row.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Thread not found")
        effective_thread_id = request.thread_id

    if not request.messages or request.messages[-1].role != "user":
        raise HTTPException(status_code=422, detail="last message must be user")
    last_user_msg = (request.messages[-1].content or "").strip()
    if not last_user_msg:
        raise HTTPException(status_code=422, detail="empty message")
    if len(last_user_msg) > 4000:
        raise HTTPException(status_code=413, detail="message too long")

    # v3.84 (2026-05-03): pre-flight check only — charge inside
    # event_stream() AFTER the agent loop closes successfully so a
    # crash mid-stream doesn't burn a daily message. If the
    # `try/except Exception` arm below catches an agent-loop crash,
    # the charge call is skipped (early return after yielding the
    # error frame).
    premium, model_name, counter = await _quota_check_only(current_user=current_user, db=db)
    base_messages, preferred_grade = await _build_agent_base_messages(
        request=request, db=db, current_user=current_user, language=language
    )

    async def event_stream():
        # Greet the FE so it can render the in-flight assistant bubble
        # immediately rather than waiting for the first model token.
        yield _sse({"kind": "start", "model": model_name, "agent_mode": True})

        accumulated_text = ""
        # Shaped data parts (grant gauge, recommendation list, memory cards…)
        shaped_parts: list[dict] = []
        # Timeline tool-call entries we replay on reload (insertion order =
        # call order, keyed by tool_call_started.id).
        tool_calls_by_id: dict[str, dict] = {}
        thinking_text = ""
        book_id = None
        page_number = None
        rag_query_log_id = None
        # s27 (C1, 2026-04-27): captured from the agent loop's `done`
        # envelope and persisted into chat_messages.message_metadata so
        # the FE can light up RedactionPill on reload (not just live).
        unverified_redacted: int = 0
        # s29 (A2, 2026-04-27): dedup'd citation list for the FE
        # SourcesDrawer. Pulled off the `done` envelope and persisted
        # into message_metadata so the drawer survives reload.
        consulted_sources: list[dict] = []
        # s30 (A4 / A6, 2026-04-27): trust-signal fields, also pulled
        # off the `done` envelope. Persisted so pills survive reload.
        failed_tool_calls: list[dict] = []
        is_general_knowledge: bool = False
        # s26 (2026-04-26): track which agent iteration each tool_call
        # belongs to + per-call wall-clock timing. The FE ReasoningPanel
        # uses `iteration` to draw "Шаг N" separators between groups,
        # and `duration_ms` to render the per-row timing chip after
        # reload (during streaming the FE computes timing client-side).
        current_iteration = 0
        import time as _time

        tool_start_ts: dict[str, float] = {}

        try:
            async for event in run_agent_loop(
                client=client,
                model_name=model_name,
                base_messages=base_messages,
                db=db,
                language=language,
                user_id=current_user.id if current_user else None,
                preferred_grade=preferred_grade,
            ):
                kind = event["kind"]
                if kind == "text_delta":
                    accumulated_text += event["text"]
                elif kind == "text_replace":
                    accumulated_text = event.get("text") or accumulated_text
                elif kind == "thinking":
                    thinking_text += ("\n\n" if thinking_text else "") + (event.get("text") or "")
                elif kind == "thinking_delta":
                    thinking_text += event.get("text") or ""
                elif kind == "iteration":
                    # The agent loop emits this right before each pass.
                    # Stamp every subsequent tool_call_started with this
                    # value so reload-time can group by step.
                    current_iteration = int(event.get("n") or 0)
                elif kind == "tool_call_started":
                    tcid = str(event.get("id") or f"{event.get('name')}-{len(tool_calls_by_id)}")
                    tool_start_ts[tcid] = _time.time()
                    tool_calls_by_id[tcid] = {
                        "kind": "tool_call",
                        "id": tcid,
                        "tool": event.get("name"),
                        "args": event.get("args") or {},
                        "status": "running",
                        "iteration": current_iteration or None,
                    }
                elif kind == "tool_result":
                    tcid = str(event.get("id") or "")
                    if tcid in tool_calls_by_id:
                        started = tool_start_ts.get(tcid)
                        duration_ms = int((_time.time() - started) * 1000) if started else None
                        tool_calls_by_id[tcid].update(
                            {
                                "status": "error" if event.get("is_error") else "done",
                                "preview": event.get("content_preview"),
                                "isError": bool(event.get("is_error")),
                                "duration_ms": duration_ms,
                            }
                        )
                elif kind == "tool_part":
                    part = event.get("part") or {}
                    shaped_parts.append(part)
                    # If the shaped part shares a tool name with a running
                    # timeline entry that has no `result`, attach it so a
                    # single timeline row carries both status + card.
                    tname = part.get("tool")
                    if tname:
                        for tc in tool_calls_by_id.values():
                            if tc["tool"] == tname and "result" not in tc:
                                tc["result"] = part.get("result")
                                break
                elif kind == "done":
                    book_id = event.get("book_id")
                    page_number = event.get("page_number")
                    rag_query_log_id = event.get("rag_query_log_id")
                    # s27 (C1): pull through the redaction count so the
                    # SSE consumer sees it on the live `done` frame
                    # without needing a separate event type.
                    unverified_redacted = int(event.get("unverified_score_claims_redacted") or 0)
                    # s29 (A2): pass-through of the consulted-sources
                    # list. Stored locally for persistence; the SSE
                    # frame already carries it via `_sse(event)` below.
                    consulted_sources = event.get("consulted_sources") or []
                    # s30 (A4 / A6): same pass-through pattern for
                    # trust-signal fields.
                    failed_tool_calls = event.get("failed_tool_calls") or []
                    is_general_knowledge = bool(event.get("is_general_knowledge"))
                yield _sse(event)
        except Exception as exc:
            logger.exception("chat/stream: agent loop crashed")
            yield _sse(
                {
                    "kind": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                    "recoverable": False,
                }
            )
            # v3.84: agent loop crashed BEFORE producing a response.
            # Per the v3.3 convention, do NOT charge the quota — the
            # user shouldn't lose a daily message because of an
            # upstream failure.
            return

        # v3.84: charge-after-success. Reaching this line means the
        # agent loop closed cleanly. Per v3.3, even an empty
        # accumulated_text counts because the model call(s) ran.
        # We charge BEFORE persistence so the counter reflects the
        # turn even if the (non-fatal) persistence step below fails.
        try:
            await _quota_charge(counter=counter, db=db)
        except Exception:
            logger.exception("chat/stream: quota charge failed (non-fatal)")

        # Build the canonical parts list the FE expects on reload:
        # thinking → tool_call timeline (with shaped result attached) →
        # any leftover shaped_parts that didn't match a timeline row.
        canonical_parts: list[dict] = []
        if thinking_text.strip():
            canonical_parts.append({"kind": "thinking", "text": thinking_text})
        canonical_parts.extend(tool_calls_by_id.values())
        for sp in shaped_parts:
            tname = sp.get("tool")
            already = any(tc.get("result") == sp.get("result") for tc in tool_calls_by_id.values())
            if not already and tname:
                canonical_parts.append(sp)

        # Persist after the full stream completes so the DB row reflects
        # exactly what the user saw.
        try:
            await save_chat_messages(
                current_user,
                last_user_msg,
                accumulated_text,
                db,
                assistant_metadata={
                    "rag_query_log_id": rag_query_log_id,
                    "book_id": book_id,
                    "page_number": page_number,
                    "parts": canonical_parts if canonical_parts else None,
                    "agent_loop": True,
                    "stream": True,
                    # s25 A/B telemetry.
                    "chat_path": "agent",
                    "tool_calls_count": len(tool_calls_by_id),
                    # s27 (C1): persist redaction count so RedactionPill
                    # survives reload. Only stored when > 0 so the
                    # legacy "no redaction" case doesn't bloat the JSON.
                    **(
                        {"unverified_score_claims_redacted": unverified_redacted}
                        if unverified_redacted
                        else {}
                    ),
                    # s29 (A2): persist the dedup'd source list so the
                    # FE SourcesDrawer rehydrates on thread reload.
                    # Skipped on zero-hit / non-RAG turns to keep the
                    # JSON column lean.
                    **({"consulted_sources": consulted_sources} if consulted_sources else {}),
                    # s30 (A4 / A6): persist trust-signal fields so the
                    # tool-failure pill and general-knowledge pill light
                    # up on reload. Only stored when truthy.
                    **({"failed_tool_calls": failed_tool_calls} if failed_tool_calls else {}),
                    **({"is_general_knowledge": True} if is_general_knowledge else {}),
                },
                thread_id=effective_thread_id,
            )
        except Exception:
            logger.exception("chat/stream: persistence failed (non-fatal)")

        # s26 phase 8: after the first turn lands, ask the LLM for a 2-6
        # word topic and rename the thread. Guarded inside the helper so
        # follow-up turns and manually renamed threads are no-ops. Emit a
        # `thread_renamed` SSE frame so the rail flips live without
        # waiting for the post-stream /chat/threads refetch.
        if (
            current_user is not None
            and effective_thread_id is not None
            and last_user_msg
            and accumulated_text
        ):
            try:
                new_title = await auto_rename_thread_if_first_turn(
                    db=db,
                    thread_id=effective_thread_id,
                    user_id=current_user.id,
                    user_msg=last_user_msg,
                    assistant_msg=accumulated_text,
                )
            except Exception:
                logger.exception("chat/stream: auto-rename failed (non-fatal)")
                new_title = None
            if new_title:
                yield _sse(
                    {
                        "kind": "thread_renamed",
                        "thread_id": effective_thread_id,
                        "title": new_title,
                    }
                )
        logger.info(
            "chat_turn.completed path=agent stream=True tool_calls=%d "
            "book_id=%s page=%s rag_log=%s len=%d user_id=%s",
            len(tool_calls_by_id),
            book_id,
            page_number,
            rag_query_log_id,
            len(accumulated_text or ""),
            current_user.id if current_user else None,
        )

        yield _sse({"kind": "stream_end"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Legacy two-call dispatcher (production path; kept as the flag's OFF state)
# ---------------------------------------------------------------------------


@router.post("/chat", response_model=ChatResponse)  # Full path: /api/chat
async def chat_endpoint(
    request: ChatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """
    Chat endpoint with OpenAI integration.
    Returns JSON-serializable response (dict with role and content).
    Language preference is read from Accept-Language header (ru or kz).
    """
    try:
        # Get language from Accept-Language header, fallback to request.language or 'ru'
        accept_language = http_request.headers.get("Accept-Language", "ru")
        # Normalize: accept 'ru', 'kz', or default to 'ru'
        language = (
            accept_language.lower()
            if accept_language.lower() in ["ru", "kz"]
            else (request.language or "ru")
        )

        # s22 (BUG-S22-sidebar): if client scoped this turn to a thread,
        # validate ownership here rather than trusting the FE. Unknown or
        # cross-user thread_id → 404 so we never write into someone else's
        # sidebar bucket. None/0 → legacy "Main chat" (unchanged behaviour).
        effective_thread_id: int | None = None
        if request.thread_id and current_user:
            thread_row = await db.execute(
                select(ChatThreadModel).where(
                    ChatThreadModel.id == request.thread_id,
                    ChatThreadModel.user_id == current_user.id,
                )
            )
            if thread_row.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Thread not found")
            effective_thread_id = request.thread_id

        # DEFENSIVE: Check if OpenAI client is initialized
        if client is None:
            # Language-aware error message
            error_msg_ru = "Извините, сервис временно недоступен. OpenAI API ключ не настроен."
            error_msg_kz = "Кешіріңіз, қызмет уақытша қолжетімсіз. OpenAI API кілті бапталмаған."
            return {
                "role": "assistant",
                "content": error_msg_kz if language == "kz" else error_msg_ru,
            }

        # Validate: reject empty / whitespace-only last user message
        if not request.messages or request.messages[-1].role != "user":
            raise HTTPException(
                status_code=422,
                detail=(
                    "Соңғы хабар пайдаланушыдан болуы керек."
                    if language == "kz"
                    else "Последнее сообщение должно быть от пользователя."
                ),
            )
        if not (request.messages[-1].content or "").strip():
            raise HTTPException(
                status_code=422,
                detail=(
                    "Сұрақ бос болмауы керек."
                    if language == "kz"
                    else "Сообщение не может быть пустым."
                ),
            )

        # === Agent harness branch ===========================================
        # When CHAT_AGENT_LOOP is enabled (settings or per-request opt-in via
        # X-Chat-Agent-Loop: 1 header — useful for A/B-ing without a bounce),
        # delegate to the agent loop in services/chat/agent_loop.py. The legacy
        # path below is kept verbatim as the fallback so we can flip the flag
        # off and immediately recover production behaviour.
        agent_loop_header = http_request.headers.get("X-Chat-Agent-Loop", "").strip().lower()
        agent_loop_active = settings.CHAT_AGENT_LOOP or agent_loop_header in {
            "1",
            "true",
            "yes",
            "on",
        }
        if agent_loop_active:
            return await _run_chat_agent_loop_path(
                request=request,
                http_request=http_request,
                db=db,
                current_user=current_user,
                language=language,
                effective_thread_id=effective_thread_id,
            )
        # ====================================================================

        # Cap user message size to prevent token-burn / DoS via very-long inputs.
        # 4000 chars is roughly 1000 tokens (English) / 500 tokens (Cyrillic),
        # well within context limits for any model we support. Over that limit
        # we reject loudly rather than silently truncate, so students notice.
        MAX_USER_MESSAGE_CHARS = 4000
        last_user_len = len(request.messages[-1].content or "")
        if last_user_len > MAX_USER_MESSAGE_CHARS:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Сұрақ тым ұзын ({last_user_len} таңба). "
                    f"Көлемі {MAX_USER_MESSAGE_CHARS} таңбадан аспауы керек."
                    if language == "kz"
                    else f"Сообщение слишком длинное ({last_user_len} символов). "
                    f"Допустимо не более {MAX_USER_MESSAGE_CHARS} символов."
                ),
            )

        # Truncate chat history to prevent context length overflow
        # Keep only the last N messages (system prompt will be added separately)
        MAX_HISTORY_MESSAGES = 30  # Keep last 30 messages (15 user + 15 assistant pairs)
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        # If history is too long, keep only the most recent messages
        if len(messages) > MAX_HISTORY_MESSAGES:
            # Keep first message (usually system or initial greeting) and last N messages
            truncated = [messages[0]] if messages else []
            truncated.extend(messages[-MAX_HISTORY_MESSAGES:])
            messages = truncated
            logger.info(
                "Chat history truncated: %d -> %d messages",
                len(request.messages),
                len(messages),
            )

        last_user_msg = (
            request.messages[-1].content
            if request.messages and request.messages[-1].role == "user"
            else None
        )

        # --- PLAN, MODEL, AND QUOTA LOGIC ---
        # v3.84 (2026-05-03): pre-flight check only — charge AFTER
        # the first model call returns successfully so timeouts /
        # content-filter trips / 5xx do NOT consume a daily message.
        # Counter is held locally and committed via _quota_charge
        # below. Pre-v3.84 the legacy path inlined an `_is_premium`
        # / `_get_or_create_counter` block + an early
        # `counter.chat_messages += 1; await db.commit()`. We keep
        # the inline guard structure (legacy path is gnarly to
        # refactor) but flip the increment to happen post-call.
        premium = False
        model_name = DEFAULT_CHAT_MODEL
        counter = None

        if current_user:
            from ..dependencies.plan_guards import (
                PLAN_QUOTAS,
                _get_or_create_counter,
                _is_premium,
            )
            from ..models import SubscriptionTier

            premium = _is_premium(current_user)

            plan = SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE
            model_name = PREMIUM_CHAT_MODEL if premium else DEFAULT_CHAT_MODEL

            # Quota check (NOT increment — see _quota_charge below)
            counter = await _get_or_create_counter(current_user.id, db)
            limits = PLAN_QUOTAS.get(plan, PLAN_QUOTAS[SubscriptionTier.FREE])
            limit = limits.get("chat_messages", 20)

            if counter.chat_messages >= limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "error": "quota_exceeded",
                        "resource": "chat_messages",
                        "limit": limit,
                        "used": counter.chat_messages,
                        "plan": plan.value,
                    },
                )
            # v3.84: increment moved to AFTER the first model call.
        # -------------------------------------

        profile_prompt_conflict = await detect_profile_prompt_conflict(
            current_user,
            db,
            last_user_msg or "",
        )

        profile_score_response = await build_profile_score_analysis_response(
            current_user,
            db,
            language,
            last_user_msg or "",
            quota_type=request.user_quota or "GENERAL",
            profile_conflict=profile_prompt_conflict,
        )
        if profile_score_response:
            await save_chat_messages(
                current_user,
                last_user_msg,
                profile_score_response,
                db,
                thread_id=effective_thread_id,
            )
            return {"role": "assistant", "content": profile_score_response}

        personal_university_tool_response = await _build_personal_university_tool_fallback(
            user=current_user,
            db=db,
            language=language,
            text=last_user_msg or "",
            quota_type=request.user_quota or "GENERAL",
        )
        if personal_university_tool_response:
            await save_chat_messages(
                current_user,
                last_user_msg,
                personal_university_tool_response,
                db,
                thread_id=effective_thread_id,
            )
            return {"role": "assistant", "content": personal_university_tool_response}

        # Build user context only when this turn is actually about the user's
        # profile or progress. Generic academic turns do not need the whole
        # profile block in the prompt.
        user_context = ""
        if _should_attach_user_context(last_user_msg or "", profile_prompt_conflict):
            user_context = await build_user_context_prompt(current_user, db, language)

        # Determine quota type
        quota_type = request.user_quota or "GENERAL"

        base_system_prompt = build_chat_system_prompt(
            language,
            user_context=user_context,
            model_name=model_name,
            is_premium=premium,
            active_quota_type=quota_type,
        )
        profile_conflict_system_note = build_profile_conflict_system_note(
            profile_prompt_conflict,
            language,
        )

        system_content_parts = [base_system_prompt]
        if profile_conflict_system_note:
            system_content_parts.append(profile_conflict_system_note)

        system_prompt = {
            "role": "system",
            "content": "\n\n".join(system_content_parts),
        }

        # Legacy inline prompt (~200 lines) removed on 2026-04-18; see
        # services/chat/prompts.build_chat_system_prompt for the replacement.

        if not messages or messages[0].get("role") != "system":
            messages.insert(0, system_prompt)

        prefetched_library_results = []
        prefetched_library_citation = None
        prefetched_library_no_results = False
        # Session 16 (2026-04-21): rag_query_log.id from whichever
        # retrieval call actually served this turn. Populated by either
        # the server-side prefetch or the LLM-triggered tool call.
        consult_library_rag_query_log_id: int | None = None
        # Phase A (s20c): book_id + page_number of the top hit that
        # actually served this turn (prefetch OR tool call). Used to
        # embed a structured hint in apply_library_outcome_markers and
        # to persist ChatMessage.message_metadata.
        consult_library_book_id: int | None = None
        consult_library_page_number: int | None = None
        inferred_library_subject = infer_subject_from_query(last_user_msg or "")
        explicit_library_grade = infer_grade_from_query(last_user_msg or "")
        library_context_allowed = should_use_library_context(last_user_msg or "")

        student_grade = None
        if (
            current_user
            and getattr(current_user, "profile", None)
            and getattr(current_user.profile, "current_grade", None)
        ):
            student_grade = current_user.profile.current_grade

        preferred_library_grade = explicit_library_grade or student_grade

        if last_user_msg and inferred_library_subject and library_context_allowed:
            prefetched_library_results = await consult_library(
                db=db,
                query=last_user_msg,
                subject=inferred_library_subject,
                language=language,
                grade=explicit_library_grade,
                preferred_grade=preferred_library_grade,
                user_id=current_user.id if current_user else None,
            )

            if prefetched_library_results:
                prefetched_library_citation = prefetched_library_results[0].get("citation")
                # Phase A (s20c): capture the top-hit book_id + page
                # for the metadata hint + message_metadata persistence.
                try:
                    _top = prefetched_library_results[0]
                    _bid = _top.get("book_id")
                    _pg = _top.get("page_number")
                    if _bid is not None:
                        consult_library_book_id = int(_bid)
                    if _pg is not None:
                        consult_library_page_number = int(_pg)
                except Exception as exc:  # noqa: BLE001 — broad: any shape drift → leave book_id/page None
                    logger.debug("prefetch top-citation parse failed: %s", exc)
                # Session 16 (2026-04-21): the prefetch path is what
                # actually served context to the model for the vast
                # majority of turns (server-side, no tool call). Carry
                # its rag_query_log.id through to the response so the
                # feedback widget can attribute a thumbs-up/down to
                # the exact retrieval call.
                for _item in prefetched_library_results:
                    _rqli = _item.get("rag_query_log_id")
                    if _rqli is not None:
                        consult_library_rag_query_log_id = int(_rqli)
                        break
                prefetched_context = "\n\n".join(
                    f"{idx}. {item['citation']}\n{item['content']}"
                    for idx, item in enumerate(prefetched_library_results[:2], 1)
                )
                messages[0]["content"] += (
                    "\n\n====================================================\n"
                    "СЕРВЕРНЫЙ КОНТЕКСТ ИЗ ОФИЦИАЛЬНОЙ БИБЛИОТЕКИ\n"
                    "====================================================\n"
                    "Сервер уже получил релевантные академические выдержки. "
                    "Сначала опирайся на них и не противоречь им.\n\n"
                    f"{prefetched_context}"
                )
            else:
                prefetched_library_no_results = True
                messages[0]["content"] += (
                    "\n\n====================================================\n"
                    "ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА БИБЛИОТЕКИ\n"
                    "====================================================\n"
                    "Сервер заранее проверил официальную библиотеку по этому "
                    "академическому вопросу и не нашёл релевантных отрывков. "
                    "Если отвечаешь по общим знаниям, обязательно добавь пометку "
                    "'*(Не найдено в библиотеке)*' или казахский эквивалент."
                )

        # Call OpenAI API
        response = await client.chat.completions.create(
            model=model_name, messages=messages, tools=tools, tool_choice="auto"
        )

        # v3.84: charge-after-success. The first model call returned
        # without raising; charge ONE unit now. If anything had
        # raised before this point (timeout, content-filter, 5xx)
        # the user would not be charged. The second model call (in
        # the tool-call branch below) does NOT consume an additional
        # unit — same one-charge-per-turn convention as v3.3 WS.
        await _quota_charge(counter=counter, db=db)

        # DEFENSIVE: Check if response has choices
        if not response.choices or len(response.choices) == 0:
            return {
                "role": "assistant",
                "content": "Извините, не удалось получить ответ. Попробуйте ещё раз.",
            }

        response_message = response.choices[0].message
        tool_calls = getattr(response_message, "tool_calls", None)

        if tool_calls:
            consult_library_called = bool(
                prefetched_library_citation or prefetched_library_no_results
            )
            consult_library_first_citation = prefetched_library_citation
            consult_library_no_results = prefetched_library_no_results
            # Phase C (s22): structured parts accumulated across tool calls.
            shaped_parts: list[dict] = []

            # Convert OpenAI Message object to dict for messages list
            messages.append(
                {
                    "role": response_message.role,
                    "content": response_message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": tc.type,
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ]
                    if tool_calls
                    else None,
                }
            )

            for tool_call in tool_calls:
                function_name = tool_call.function.name
                try:
                    function_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    continue

                tool_response_content = ""

                skipped_personal_library_lookup = (
                    function_name == "consult_library" and not library_context_allowed
                )

                if skipped_personal_library_lookup:
                    tool_response_content = json.dumps(
                        {
                            "query": function_args.get("query", last_user_msg or ""),
                            "count": 0,
                            "citations": [],
                            "note": (
                                "Library lookup skipped because this turn asks "
                                "for personal profile/progress data."
                            ),
                        },
                        ensure_ascii=False,
                    )
                else:
                    if function_name == "consult_library" and explicit_library_grade:
                        function_args.setdefault("grade", explicit_library_grade)

                    tool_response_content = await execute_tool(
                        function_name,
                        function_args,
                        db,
                        http_request.headers.get("x-user-language", "ru"),
                        preferred_grade=preferred_library_grade,
                        user_id=current_user.id if current_user else None,
                    )

                # Phase C (s22): shape this tool's raw JSON response
                # into a FE-ready MessagePart, if it's one of the four
                # card-worthy tools and the payload is well-formed. All
                # failure modes are swallowed inside shape_tool_part;
                # the FE ignores unknown / missing shapes.
                try:
                    shaped = shape_tool_part(function_name, function_args, tool_response_content)
                    if shaped is not None:
                        shaped_parts.append(shaped)
                except Exception as exc:  # noqa: BLE001 — broad: shaping must never abort the chat loop
                    # Never let shaping failures affect the chat loop;
                    # the FE silently ignores missing/unknown shapes.
                    logger.debug("shape_tool_part failed for %s: %s", function_name, exc)

                # Truncate tool response if it's too long (max 5000 characters per tool response)
                MAX_TOOL_RESPONSE_LENGTH = 5000
                if len(tool_response_content) > MAX_TOOL_RESPONSE_LENGTH:
                    tool_response_content = (
                        tool_response_content[:MAX_TOOL_RESPONSE_LENGTH]
                        + "... [ответ обрезан из-за размера]"
                    )
                    logger.info(
                        "Tool response truncated for %s: %d chars",
                        function_name,
                        len(tool_response_content),
                    )

                if function_name == "consult_library" and not skipped_personal_library_lookup:
                    consult_library_called = True
                    try:
                        parsed_tool_response = json.loads(tool_response_content)
                        citations = parsed_tool_response.get("citations", [])
                        count = parsed_tool_response.get("count", 0)
                        if citations and isinstance(citations, list):
                            consult_library_first_citation = citations[0].get("citation")
                            # Phase A (s20c): capture the top-hit
                            # book_id + page_number from the tool-call
                            # path too, for the metadata hint and
                            # message_metadata persistence.
                            top_citation = citations[0]
                            _bid = top_citation.get("book_id")
                            _pg = top_citation.get("page_number")
                            try:
                                if _bid is not None:
                                    consult_library_book_id = int(_bid)
                            except Exception as exc:  # noqa: BLE001 — broad: int() on upstream JSON; non-fatal
                                logger.debug("consult_library book_id int() failed: %s", exc)
                            try:
                                if _pg is not None and _pg != "":
                                    consult_library_page_number = int(_pg)
                            except Exception as exc:  # noqa: BLE001 — broad: int() on upstream JSON; non-fatal
                                logger.debug("consult_library page_number int() failed: %s", exc)
                        if count == 0:
                            consult_library_no_results = True
                        # Session 16 (2026-04-21): remember the RAG log
                        # id for this assistant turn so it can ride
                        # along on the response envelope.
                        rqli = parsed_tool_response.get("rag_query_log_id")
                        if rqli is not None:
                            consult_library_rag_query_log_id = int(rqli)
                    except Exception as exc:  # noqa: BLE001 — broad: upstream JSON shape drift; degrade silently
                        # Tool-response shape is upstream contract; if the
                        # JSON shape drifts, citation metadata silently
                        # goes None. Log at DEBUG so the regression is
                        # observable without aborting the chat turn.
                        logger.debug("consult_library payload parse failed: %s", exc)

                messages.append(
                    {
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": tool_response_content,
                    }
                )

            # Get final response after tool calls
            # Truncate messages again if they grew too large after tool calls
            # Estimate: each message ~100-500 tokens, keep last 50 messages max
            MAX_MESSAGES_WITH_TOOLS = 50
            if len(messages) > MAX_MESSAGES_WITH_TOOLS:
                # Keep system prompt and last N messages
                system_msg = [m for m in messages if m.get("role") == "system"]
                other_messages = [m for m in messages if m.get("role") != "system"]
                truncated_others = (
                    other_messages[-MAX_MESSAGES_WITH_TOOLS:]
                    if len(other_messages) > MAX_MESSAGES_WITH_TOOLS
                    else other_messages
                )
                messages = system_msg + truncated_others
                logger.info(
                    "Messages truncated after tool calls: %d total messages",
                    len(messages),
                )

            try:
                final_response = await client.chat.completions.create(
                    model=PREMIUM_CHAT_MODEL if premium else DEFAULT_CHAT_MODEL,
                    messages=messages,
                )

                if not final_response.choices or len(final_response.choices) == 0:
                    # Language-aware error message
                    error_msg_ru = "Извините, не удалось получить ответ. Попробуйте ещё раз."
                    error_msg_kz = "Кешіріңіз, жауап алу мүмкін болмады. Қайталап көріңіз."
                    error_response = {
                        "role": "assistant",
                        "content": error_msg_kz if request.language == "kz" else error_msg_ru,
                    }
                    # Save error message too
                    last_user_msg = (
                        request.messages[-1].content
                        if request.messages and request.messages[-1].role == "user"
                        else None
                    )
                    await save_chat_messages(
                        current_user,
                        last_user_msg,
                        error_response["content"],
                        db,
                        thread_id=effective_thread_id,
                    )

                    # Capture failed queries for analysis
                    if last_user_msg and detect_failure(error_response["content"]):
                        await capture_failed_query(
                            last_user_msg,
                            error_response["content"],
                            current_user,
                            None,
                            db,
                        )

                    return error_response

                final_message = final_response.choices[0].message
                # Normalize markdown formatting using dedicated function
                content = _visible_assistant_content(final_message.content or "")
                if not content:
                    content = await _recover_blank_assistant_content(
                        model_name=PREMIUM_CHAT_MODEL if premium else DEFAULT_CHAT_MODEL,
                        messages=messages,
                        language=request.language,
                    )
                if content == _empty_response_fallback(request.language):
                    fallback_content = await _build_personal_university_tool_fallback(
                        user=current_user,
                        db=db,
                        language=request.language,
                        text=last_user_msg or "",
                        quota_type=request.user_quota or "GENERAL",
                    )
                    if fallback_content:
                        content = fallback_content

                # Session 23 (2026-04-24, rag-eval bug Physics RU id=12241):
                # if after all recovery attempts the visible content is still
                # the bare "model returned empty" sentinel, we MUST NOT wrap
                # it in a prefetched library citation chip. Previously the
                # user saw a real-looking deep-link card to a book that was
                # never actually consulted for the answer (because there
                # wasn't one). Treat the sentinel as "no library turn" so
                # no citation prose, no <!-- samga-citation --> hint, and
                # no book_id/page_number/rag_query_log_id on the envelope.
                is_empty_fallback_tool_path = content == _empty_response_fallback(request.language)

                # Enforce explicit consult_library outcome markers for deterministic tests
                if consult_library_called and not is_empty_fallback_tool_path:
                    content = apply_library_outcome_markers(
                        content,
                        language,
                        consult_library_first_citation,
                        consult_library_no_results,
                        book_id=consult_library_book_id,
                        page_number=consult_library_page_number,
                    )

                # Convert OpenAI Message object to JSON-serializable dict
                response = {"role": final_message.role, "content": content}
                # Session 16 (2026-04-21): surface rag_query_log.id to
                # the client so the feedback widget can POST it back.
                # Nullable — absent for non-library turns.
                if consult_library_rag_query_log_id is not None and not is_empty_fallback_tool_path:
                    response["rag_query_log_id"] = consult_library_rag_query_log_id
                # Phase A (s20c): also surface the resolved book_id +
                # page_number so the FE can render a deep-link chip
                # with zero client-side fuzzy matching.
                if consult_library_book_id is not None and not is_empty_fallback_tool_path:
                    response["book_id"] = consult_library_book_id
                if consult_library_page_number is not None and not is_empty_fallback_tool_path:
                    response["page_number"] = consult_library_page_number
                # Phase C (s22): attach structured tool-card parts if any.
                if shaped_parts:
                    response["parts"] = shaped_parts

                # Save messages
                last_user_msg = (
                    request.messages[-1].content
                    if request.messages and request.messages[-1].role == "user"
                    else None
                )
                _legacy_tool_calls = getattr(response_message, "tool_calls", None) or []
                await save_chat_messages(
                    current_user,
                    last_user_msg,
                    response["content"],
                    db,
                    assistant_metadata={
                        "rag_query_log_id": consult_library_rag_query_log_id,
                        "book_id": consult_library_book_id,
                        "page_number": consult_library_page_number,
                        "parts": shaped_parts if shaped_parts else None,
                        # s25 A/B telemetry: legacy two-call dispatcher.
                        "chat_path": "legacy",
                        "tool_calls_count": len(_legacy_tool_calls),
                    },
                    thread_id=effective_thread_id,
                )
                logger.info(
                    "chat_turn.completed path=legacy tool_calls=%d "
                    "book_id=%s page=%s rag_log=%s len=%d user_id=%s",
                    len(_legacy_tool_calls),
                    consult_library_book_id,
                    consult_library_page_number,
                    consult_library_rag_query_log_id,
                    len(response["content"] or ""),
                    current_user.id if current_user else None,
                )

                # Capture failed queries for analysis
                if last_user_msg and detect_failure(response["content"]):
                    # Extract tool calls from the response if available
                    tool_calls = []
                    if hasattr(final_message, "tool_calls") and final_message.tool_calls:
                        tool_calls = [
                            {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            }
                            for tc in final_message.tool_calls
                        ]
                    await capture_failed_query(
                        last_user_msg, response["content"], current_user, tool_calls, db
                    )

                return response
            except Exception as e:
                logger.exception("Error in final OpenAI call: %s", e)
                error_response = {
                    "role": "assistant",
                    "content": "Извините, произошла ошибка при обработке запроса. Попробуйте ещё раз.",
                }
                # Save error message
                last_user_msg = (
                    request.messages[-1].content
                    if request.messages and request.messages[-1].role == "user"
                    else None
                )
                await save_chat_messages(
                    current_user,
                    last_user_msg,
                    error_response["content"],
                    db,
                    thread_id=effective_thread_id,
                )

                # Capture failed queries for analysis
                if last_user_msg and detect_failure(error_response["content"]):
                    await capture_failed_query(
                        last_user_msg, error_response["content"], current_user, None, db
                    )

                return error_response

        # No tool calls - return direct response
        # Normalize markdown formatting using dedicated function
        content = _visible_assistant_content(response_message.content or "")
        if not content:
            content = await _recover_blank_assistant_content(
                model_name=model_name,
                messages=messages,
                language=request.language,
            )
        if content == _empty_response_fallback(request.language):
            fallback_content = await _build_personal_university_tool_fallback(
                user=current_user,
                db=db,
                language=request.language,
                text=last_user_msg or "",
                quota_type=request.user_quota or "GENERAL",
            )
            if fallback_content:
                content = fallback_content
        # Session 23 (2026-04-24, rag-eval bug Physics RU id=12241):
        # see tool-path branch above — if content is still the "empty
        # model response" sentinel, surface no library metadata.
        is_empty_fallback_no_tool_path = content == _empty_response_fallback(request.language)
        if not is_empty_fallback_no_tool_path:
            content = apply_library_outcome_markers(
                content,
                language,
                prefetched_library_citation,
                prefetched_library_no_results,
                book_id=consult_library_book_id,
                page_number=consult_library_page_number,
            )

        # Convert OpenAI Message object to JSON-serializable dict
        response = {"role": response_message.role, "content": content}
        # Session 16 (2026-04-21): surface rag_query_log.id here too —
        # no-tool-call path after a server-side library prefetch.
        if consult_library_rag_query_log_id is not None and not is_empty_fallback_no_tool_path:
            response["rag_query_log_id"] = consult_library_rag_query_log_id
        # Phase A (s20c): surface book_id + page on the no-tool-call
        # path too (prefetch-only turns).
        if consult_library_book_id is not None and not is_empty_fallback_no_tool_path:
            response["book_id"] = consult_library_book_id
        if consult_library_page_number is not None and not is_empty_fallback_no_tool_path:
            response["page_number"] = consult_library_page_number

        # Save messages
        last_user_msg = (
            request.messages[-1].content
            if request.messages and request.messages[-1].role == "user"
            else None
        )
        await save_chat_messages(
            current_user,
            last_user_msg,
            response["content"],
            db,
            assistant_metadata={
                "rag_query_log_id": consult_library_rag_query_log_id,
                "book_id": consult_library_book_id,
                "page_number": consult_library_page_number,
            },
            thread_id=effective_thread_id,
        )

        # Capture failed queries for analysis (after saving messages)
        if last_user_msg and detect_failure(response["content"]):
            await capture_failed_query(last_user_msg, response["content"], current_user, None, db)

        return response

    except HTTPException:
        # Preserve FastAPI's native error handling (e.g. 422 empty input)
        raise
    except Exception as e:  # noqa: BLE001 — broad: top-level chat handler must always return a user-visible body
        error_type = type(e).__name__
        error_msg = str(e)
        # logger.exception attaches the traceback automatically; no manual format_exc needed.
        logger.exception(
            "Error in chat_endpoint: %s: %s",
            error_type,
            error_msg,
        )

        # Language-aware error message
        error_msg_ru = f"Извините, произошла ошибка: {error_type}: {error_msg[:100]}"
        error_msg_kz = f"Кешіріңіз, қате орын алды: {error_type}: {error_msg[:100]}"
        # Try to get language from request if available
        try:
            lang = request.language if hasattr(request, "language") else "ru"
        except Exception as lang_exc:  # noqa: BLE001 — broad: language probe is best-effort, default to RU
            logger.debug("language probe failed in error handler: %s", lang_exc)
            lang = "ru"
        return {
            "role": "assistant",
            "content": error_msg_kz if lang == "kz" else error_msg_ru,
        }


@router.delete("/chat/history")
async def clear_chat_history(
    thread_id: int | None = Query(None, description="s22: thread scope"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Очистить историю чата для текущего пользователя.

    s22: ``?thread_id=N`` deletes only that thread's messages (not the
    thread row itself — the left-rail sidebar keeps the bucket alive so
    the user can keep typing into it). ``?thread_id=0`` deletes only
    the legacy "Main chat" bucket. No param = nuke everything (legacy).
    """
    try:
        filters = [ChatMessageModel.user_id == current_user.id]
        if thread_id is not None:
            if thread_id == 0:
                filters.append(ChatMessageModel.thread_id.is_(None))
            else:
                from ..models import ChatThread as ChatThreadModel

                owner_check = await db.execute(
                    select(ChatThreadModel.id).where(
                        ChatThreadModel.id == thread_id,
                        ChatThreadModel.user_id == current_user.id,
                    )
                )
                if owner_check.scalar_one_or_none() is None:
                    raise HTTPException(status_code=404, detail="Thread not found")
                filters.append(ChatMessageModel.thread_id == thread_id)

        result = await db.execute(delete(ChatMessageModel).where(*filters))
        await db.commit()
        deleted_count = result.rowcount
        return {"success": True, "deleted_count": deleted_count}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — broad: clear-history is end-user-facing, must always return a 500
        logger.exception("Error clearing chat history")
        try:
            await db.rollback()
        except Exception as rollback_exc:  # noqa: BLE001 — broad: best-effort rollback in error handler
            logger.debug("db.rollback() failed in clear_chat_history: %s", rollback_exc)
        raise HTTPException(status_code=500, detail="Ошибка при очистке истории") from exc


@router.post("/chat/history/truncate")
async def truncate_chat_history_tail(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Phase C (s22): backend side of edit-and-resubmit.

    Drops the trailing `N` chat_messages rows for the current user so the
    FE can rewind the persisted thread to the point just before an edited
    user turn is re-submitted. The caller sends ``{"drop_last": N}``
    where N is the count of rows to remove from the end (ordered by
    created_at DESC). No-op if N <= 0 or the user has fewer rows.

    Why a dedicated endpoint rather than clear-everything: the user
    might be 20 turns deep when they edit turn #18 — wiping all 20
    would be a terrible UX. This only removes turn 18's user+assistant
    (and anything after them), letting the resubmit replay cleanly.

    Security notes:
      - Always scoped by `user_id == current_user.id`; cross-user
        truncation is impossible.
      - `drop_last` is coerced to int, clamped to [0, 10_000]; a
        runaway value can't nuke more than that user's own history.
    """
    try:
        raw = payload.get("drop_last", 0) if isinstance(payload, dict) else 0
        try:
            drop_last = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="drop_last must be an integer") from None
        if drop_last <= 0:
            return {"success": True, "deleted_count": 0}
        drop_last = min(drop_last, 10_000)

        # v3.88 (2026-05-04): single-statement DELETE...IN (SELECT ...)
        # to close a SELECT-then-DELETE race. Pre-v3.88 the handler
        # ran:
        #   1. SELECT id ... ORDER BY created_at DESC LIMIT N
        #   2. DELETE WHERE id IN (<ids from step 1>)
        # If a concurrent INSERT (e.g. an in-flight assistant turn
        # persisted by a parallel SSE writer) landed between (1) and
        # (2), the DELETE would still drop the *original* N ids —
        # which by then may no longer be the trailing N rows. The
        # user asked to "rewind the last N turns" but ended up with
        # mid-history holes plus the new turn left dangling.
        #
        # Folding the SELECT into the DELETE as a scalar subquery
        # makes the DB pick the trailing N ids and remove them in
        # one statement, under the same row lock. Portable across
        # PostgreSQL / SQLite / MySQL (all support DELETE ... WHERE
        # id IN (SELECT ...)). The earlier "two round-trips for
        # dialect portability" rationale was overly cautious.
        trailing_ids_subq = (
            select(ChatMessageModel.id)
            .where(ChatMessageModel.user_id == current_user.id)
            .order_by(
                ChatMessageModel.created_at.desc(),
                ChatMessageModel.id.desc(),
            )
            .limit(drop_last)
            .scalar_subquery()
        )
        del_result = await db.execute(
            delete(ChatMessageModel).where(
                ChatMessageModel.user_id == current_user.id,
                ChatMessageModel.id.in_(trailing_ids_subq),
            )
        )
        await db.commit()
        return {
            "success": True,
            "deleted_count": del_result.rowcount or 0,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — broad: truncate is end-user-facing, must always return a 500
        logger.exception("Error truncating chat history tail")
        try:
            await db.rollback()
        except Exception as rollback_exc:  # noqa: BLE001 — broad: best-effort rollback in error handler
            logger.debug("db.rollback() failed in truncate_chat_history_tail: %s", rollback_exc)
        raise HTTPException(status_code=500, detail="Ошибка при усечении истории") from exc


@router.get("/chat/history/export")
async def export_chat_history(
    format: str = Query("json", description="Формат экспорта: json или txt"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Экспортировать историю чата в JSON или TXT формат"""
    try:
        query = (
            select(ChatMessageModel)
            .where(ChatMessageModel.user_id == current_user.id)
            .order_by(ChatMessageModel.created_at.asc())
        )

        result = await db.execute(query)
        messages = result.scalars().all()

        if format == "txt":
            # Формат TXT: простой текстовый формат
            txt_content = f"История чата - {current_user.name or current_user.email}\n"
            txt_content += "=" * 70 + "\n\n"

            for msg in messages:
                role_label = "Вы" if msg.role == "user" else "Samga AI"
                timestamp = (
                    msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "N/A"
                )
                txt_content += f"[{timestamp}] {role_label}:\n{msg.content}\n\n"

            from fastapi.responses import Response

            return Response(
                content=txt_content,
                media_type="text/plain; charset=utf-8",
                headers={
                    "Content-Disposition": f'attachment; filename="chat_history_{current_user.id}.txt"'
                },
            )
        else:
            # Формат JSON
            history_data = {
                "user": {
                    "id": current_user.id,
                    "email": current_user.email,
                    "name": current_user.name,
                },
                "exported_at": datetime.now(UTC).isoformat(),
                "total_messages": len(messages),
                "messages": [
                    {
                        "role": msg.role,
                        "content": msg.content,
                        "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    }
                    for msg in messages
                ],
            }
            from fastapi.responses import JSONResponse

            return JSONResponse(
                content=history_data,
                headers={
                    "Content-Disposition": f'attachment; filename="chat_history_{current_user.id}.json"'
                },
            )
    except Exception as exc:
        logger.exception("Error exporting chat history")
        raise HTTPException(status_code=500, detail="Ошибка при экспорте истории") from exc


@router.get("/chat/history/search")
async def search_chat_history(
    q: str = Query(..., description="Поисковый запрос (минимум 2 символа)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Поиск по истории чата"""
    try:
        if not q or len(q.strip()) < 2:
            return {"messages": [], "query": q, "count": 0}

        search_term = f"%{q.strip()}%"
        query = (
            select(ChatMessageModel)
            .where(
                ChatMessageModel.user_id == current_user.id,
                ChatMessageModel.content.ilike(search_term),
            )
            .order_by(ChatMessageModel.created_at.asc())
        )

        result = await db.execute(query)
        messages = result.scalars().all()

        history_messages = [
            {
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            }
            for msg in messages
        ]

        return {
            "messages": history_messages,
            "query": q,
            "count": len(history_messages),
        }
    except Exception:
        logger.exception("Error searching chat history")
        return {"messages": [], "query": q, "count": 0}


@router.get("/chat/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    thread_id: int | None = Query(None, description="s22: thread scope"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get chat history for the current user.

    s22 (BUG-S22-sidebar): ``?thread_id=N`` narrows history to a single
    thread the user owns. ``?thread_id=0`` explicitly requests the
    legacy "Main chat" bucket (thread_id IS NULL). No parameter →
    full history across every thread (existing pre-s22 behaviour).
    """
    try:
        filters = [ChatMessageModel.user_id == current_user.id]
        if thread_id is not None:
            if thread_id == 0:
                filters.append(ChatMessageModel.thread_id.is_(None))
            else:
                from ..models import ChatThread as ChatThreadModel

                owner_check = await db.execute(
                    select(ChatThreadModel.id).where(
                        ChatThreadModel.id == thread_id,
                        ChatThreadModel.user_id == current_user.id,
                    )
                )
                if owner_check.scalar_one_or_none() is None:
                    raise HTTPException(status_code=404, detail="Thread not found")
                filters.append(ChatMessageModel.thread_id == thread_id)

        query = select(ChatMessageModel).where(*filters).order_by(ChatMessageModel.created_at.asc())

        result = await db.execute(query)
        messages = result.scalars().all()

        history_messages = [
            {
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                # Phase A (s20c): echo message_metadata so the FE can
                # restore book_id/page_number/rag_query_log_id on reload
                # without re-parsing the prose citation marker. `None`
                # for older rows where the column was empty — the
                # frontend falls back to its fuzzy resolver in that case.
                "metadata": msg.message_metadata,
            }
            for msg in messages
        ]

        return {"messages": history_messages}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error fetching chat history")
        return {"messages": []}


# -----------------------------------------------------------------------------
# s22 (BUG-S22-sidebar): /api/chat/threads CRUD
# -----------------------------------------------------------------------------
#
# The FE left-rail sidebar fetches /chat/threads on mount, shows one row per
# thread sorted by updated_at DESC, and calls POST to create, PATCH to rename,
# DELETE to remove. All routes are user-scoped; an auth'd user cannot see or
# mutate another user's threads.


class ThreadOut(BaseModel):
    id: int
    title: str | None = None
    created_at: str
    updated_at: str
    message_count: int = 0


class ThreadCreateRequest(BaseModel):
    title: str | None = None


class ThreadRenameRequest(BaseModel):
    title: str | None = None


def _thread_to_dict(row: ChatThreadModel, message_count: int = 0) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "message_count": message_count,
    }


@router.get("/chat/threads")
async def list_chat_threads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's chat threads, most-recently-updated first.

    Includes a synthetic ``message_count`` joined from chat_messages so the
    sidebar can skip empty threads (or dim them) client-side. Does NOT
    include the legacy "Main chat" bucket (thread_id IS NULL) — the FE
    renders that as a fixed pinned row above the dynamic list.
    """
    try:
        q = (
            select(
                ChatThreadModel,
                func.count(ChatMessageModel.id).label("message_count"),
            )
            .where(ChatThreadModel.user_id == current_user.id)
            .outerjoin(
                ChatMessageModel,
                ChatMessageModel.thread_id == ChatThreadModel.id,
            )
            .group_by(ChatThreadModel.id)
            .order_by(ChatThreadModel.updated_at.desc(), ChatThreadModel.id.desc())
        )
        rows = (await db.execute(q)).all()
        threads = [_thread_to_dict(t, int(cnt or 0)) for t, cnt in rows]

        # Also report whether the legacy bucket is non-empty so the sidebar
        # can decide to show/hide the "Main chat" pinned row.
        legacy_q = select(func.count(ChatMessageModel.id)).where(
            ChatMessageModel.user_id == current_user.id,
            ChatMessageModel.thread_id.is_(None),
        )
        legacy_count = int((await db.execute(legacy_q)).scalar() or 0)

        return {"threads": threads, "legacy_bucket_message_count": legacy_count}
    except Exception as e:
        logger.exception("Failed to list chat threads: %s", e)
        return {"threads": [], "legacy_bucket_message_count": 0}


# ═══════════════════════════════════════════════════════════════════
# Chat template context (session 22c)
# ═══════════════════════════════════════════════════════════════════
# Lightweight "signals" endpoint the empty-state uses to rank its
# one-click prompt pills. The FE fetches this on mount, picks an
# ordering, and hides `summarize_pdf` when there's no recent library
# activity. Kept intentionally shallow — counts + a single topic_tag
# — so it stays <50ms for a warm connection and doesn't grow into a
# "give me everything about the user" dumping ground.
#
# Contract (stable):
#   {
#     "unresolved_mistakes_count": int >= 0,
#     "exam_attempts_count": int >= 0,
#     "weakness_topic_tag": str | null,
#     "has_library_activity": bool,
#     "profile_subjects": list[str],
#     "weakest_subject": str | null,
#     "last_test_results_count": int >= 0,
#     "target_university_name": str | null,
#     "has_onboarding_profile": bool
#   }


@router.get("/chat/template-context")
async def get_chat_template_context(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return signals the empty-state uses to rank its template pills.

    Silent-fail design: any sub-query exception falls back to a
    zeroed-out payload. The FE already has a static fallback order,
    so the worst case here is "student sees the generic 6" rather
    than a broken UI.
    """
    out = {
        "unresolved_mistakes_count": 0,
        "exam_attempts_count": 0,
        "weakness_topic_tag": None,
        "has_library_activity": False,
        "profile_subjects": [],
        "weakest_subject": None,
        "last_test_results_count": 0,
        "target_university_name": None,
        "has_onboarding_profile": False,
    }
    profile_subject_scope: list[str] = []
    try:
        if current_user.profile and getattr(current_user.profile, "chosen_subjects", None):
            normalized_subjects = [
                normalize_subject_name(subject)
                for subject in (current_user.profile.chosen_subjects or [])
                if isinstance(subject, str)
            ]
            if len(normalized_subjects) >= 2:
                profile_subject_scope = [
                    *get_compulsory_subjects(),
                    *normalized_subjects[:2],
                ]
    except Exception as exc:  # noqa: BLE001 — broad: template-context probe; degrade to empty scope
        logger.debug("template-context: subject scope failed: %s", exc)
        profile_subject_scope = []
    try:
        out["unresolved_mistakes_count"] = await count_unresolved_mistakes(
            current_user.id,
            db,
            recent_days=45,
            question_types=("exam", "practice"),
            topic_tags=profile_subject_scope or None,
            recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
        )
        if not out["unresolved_mistakes_count"]:
            out["unresolved_mistakes_count"] = await count_unresolved_mistakes(
                current_user.id,
                db,
                recent_days=45,
                question_types=("exam", "practice"),
                recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
            )
    except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
        logger.debug("template-context: mistakes count failed: %s", e)

    try:
        weakness_rows = await cluster_mistakes_by_topic(
            current_user.id,
            db,
            recent_days=45,
            question_types=("exam", "practice"),
            topic_tags=profile_subject_scope or None,
            limit=1,
            recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
        )
        if not weakness_rows:
            weakness_rows = await cluster_mistakes_by_topic(
                current_user.id,
                db,
                recent_days=45,
                question_types=("exam", "practice"),
                limit=1,
                recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
            )
        if weakness_rows and weakness_rows[0].get("topic"):
            out["weakness_topic_tag"] = str(weakness_rows[0]["topic"])
    except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
        logger.debug("template-context: weakness topic failed: %s", e)

    try:
        exams_q = select(func.count(ExamAttempt.id)).where(ExamAttempt.user_id == current_user.id)
        out["exam_attempts_count"] = int((await db.execute(exams_q)).scalar() or 0)
    except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
        logger.debug("template-context: exam count failed: %s", e)

    try:
        # Proxy for "has the user opened a library PDF recently?" — we
        # don't have a dedicated library-open log today, so we fall
        # back to "any non-empty activity_logs row in the last 14 days"
        # as a liveness signal. Good enough to suppress the
        # summarize_pdf tile for brand-new signups who haven't touched
        # the library yet, which is the main failure mode we care
        # about. Once we add a LIBRARY_OPEN activity type we'll filter
        # by it here.
        from datetime import timedelta

        cutoff = datetime.now(UTC) - timedelta(days=14)
        activity_q = select(func.count(ActivityLog.id)).where(
            ActivityLog.user_id == current_user.id,
            ActivityLog.created_at >= cutoff,
        )
        out["has_library_activity"] = bool(int((await db.execute(activity_q)).scalar() or 0) > 0)
    except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
        logger.debug("template-context: activity probe failed: %s", e)

    try:
        profile = getattr(current_user, "profile", None)
        if profile is not None:
            raw_subjects = getattr(profile, "chosen_subjects", None) or []
            profile_subjects = [
                normalize_subject_name(subject)
                for subject in raw_subjects[:2]
                if isinstance(subject, str) and subject.strip()
            ]
            out["profile_subjects"] = profile_subjects

            raw_weakest = getattr(profile, "weakest_subject", None)
            if isinstance(raw_weakest, str) and raw_weakest.strip():
                out["weakest_subject"] = normalize_subject_name(raw_weakest)

            raw_results = getattr(profile, "last_test_results", None)
            if isinstance(raw_results, dict):
                result_count = 0
                for scores in raw_results.values():
                    if isinstance(scores, list):
                        result_count += len([score for score in scores if score is not None])
                out["last_test_results_count"] = result_count

            target_university_id = getattr(profile, "target_university_id", None)
            out["has_onboarding_profile"] = is_onboarding_completed(profile)

            if target_university_id:
                try:
                    uni_q = select(UniversityDetail).where(
                        UniversityDetail.id == target_university_id
                    )
                    uni = (await db.execute(uni_q)).scalar_one_or_none()
                    if uni:
                        out["target_university_name"] = (
                            getattr(uni, "full_name", None) or getattr(uni, "name", None) or None
                        )
                except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
                    logger.debug("template-context: target university failed: %s", e)
    except Exception as e:  # noqa: BLE001 — broad: template-context probe; degrade silently
        logger.debug("template-context: onboarding profile probe failed: %s", e)

    return out


@router.post("/chat/threads")
async def create_chat_thread(
    payload: ThreadCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a fresh thread. ``title`` optional; blank/whitespace → NULL
    so the sidebar shows the "New chat" placeholder until the user sends
    a first turn (at which point the FE auto-seeds the title client-side
    and calls PATCH)."""
    try:
        raw = (payload.title or "").strip()
        title: str | None = raw[:120] if raw else None
        thread = ChatThreadModel(user_id=current_user.id, title=title)
        db.add(thread)
        await db.commit()
        await db.refresh(thread)
        return _thread_to_dict(thread, 0)
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to create chat thread: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create thread") from exc


@router.patch("/chat/threads/{thread_id}")
async def rename_chat_thread(
    thread_id: int,
    payload: ThreadRenameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename a thread. Accepts null/empty title to reset to "untitled"."""
    try:
        row = await db.execute(
            select(ChatThreadModel).where(
                ChatThreadModel.id == thread_id,
                ChatThreadModel.user_id == current_user.id,
            )
        )
        thread = row.scalar_one_or_none()
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")
        raw = (payload.title or "").strip() if payload.title is not None else ""
        thread.title = raw[:120] if raw else None
        await db.commit()
        await db.refresh(thread)
        return _thread_to_dict(thread, 0)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to rename chat thread: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to rename thread") from exc


@router.delete("/chat/threads/{thread_id}")
async def delete_chat_thread(
    thread_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a thread and all of its messages (ON DELETE CASCADE).

    The legacy "Main chat" bucket (thread_id=NULL) is not deletable via
    this route — callers must go through DELETE /chat/history?thread_id=0
    to remove just that bucket, or no-param DELETE /chat/history for all.
    """
    try:
        row = await db.execute(
            select(ChatThreadModel).where(
                ChatThreadModel.id == thread_id,
                ChatThreadModel.user_id == current_user.id,
            )
        )
        thread = row.scalar_one_or_none()
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")
        # Delete the child messages first so we don't have to rely on
        # SQLAlchemy's relationship-cascade (which can inadvertently
        # NULL the thread_id on the children if the ORM mapping is
        # not wired with passive_deletes=True). The DB-level ON
        # DELETE CASCADE on chat_messages.thread_id also does this
        # transparently, but an explicit DELETE keeps us portable.
        await db.execute(
            delete(ChatMessageModel).where(
                ChatMessageModel.thread_id == thread_id,
                ChatMessageModel.user_id == current_user.id,
            )
        )
        await db.delete(thread)
        await db.commit()
        return {"success": True, "deleted_thread_id": thread_id}
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to delete chat thread: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to delete thread") from exc


# ---------------------------------------------------------------------------
# v3.12 (F5) — image upload → OCR → inline question
# ---------------------------------------------------------------------------


@router.post("/chat/ocr")
async def chat_image_ocr(
    image: UploadFile = File(...),
    lang: str = Query("ru", pattern="^(ru|kz)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run vision OCR on an uploaded textbook photo and return the
    transcribed text plus a composer-ready seed string.

    Pure helpers (allow-list, size cap, classifier, seed builder)
    live in `app.services.image_ocr`. The vision call goes through
    the existing `qwen_dashscope.ocr_image_bytes` (qwen-vl-ocr-latest)
    so we don't introduce a new model or key.

    The endpoint always returns 200 on classifier-driven failures
    (blank page / empty OCR) with `classification` set so the FE can
    render a localized toast. Network / upstream failures surface as
    502 with an RU/KZ error message.

    v3.82 (2026-05-03): gates FREE users on the daily chat_messages
    quota. Pre-v3.82 the endpoint accepted unbounded calls against
    qwen-vl-ocr-latest (a paid vision model) — a FREE user could
    submit thousands of images per day. The quota is checked BEFORE
    the upstream call (so a 429 doesn't waste a vision-model
    invocation) and incremented AFTER successful OCR (v3.3 pattern,
    so a user isn't billed for upstream failures).

    OCR calls piggyback on the ``chat_messages`` counter rather than
    a dedicated ``ocr_calls`` column, by design:
      1. OCR is a chat-flow side-feature (image → transcript →
         seeded chat composer), so the user-visible budget is one
         pool.
      2. No Alembic migration required.
      3. Easy to switch later: add an ``ocr_calls`` column + flip
         this branch.
    """
    # Validate content-type against the explicit allow-list. The
    # FE also gates on this via accept="image/jpeg,image/png" but a
    # crafted client can send anything — pin server-side too.
    if not is_allowed_ocr_content_type(image.content_type):
        raise HTTPException(
            status_code=415,
            detail=ocr_error_message("bad-type", lang),
        )

    # Read body. UploadFile.size is populated for in-memory uploads
    # but not always for spooled ones, so re-measure after read.
    try:
        png_bytes = await image.read()
    except Exception:
        logger.exception("chat_image_ocr: failed to read upload body")
        raise HTTPException(
            status_code=400,
            detail=ocr_error_message("upstream-failed", lang),
        ) from None

    if not png_bytes:
        raise HTTPException(
            status_code=400,
            detail=ocr_error_message("empty", lang),
        )
    if not is_within_ocr_size_cap(len(png_bytes)):
        raise HTTPException(
            status_code=413,
            detail=ocr_error_message("too-large", lang),
        )

    # v3.82 quota PRE-CHECK. Done after the cheap structural checks
    # (content-type, size, empty) so a malformed request can't
    # consume a model call AND surface the wrong error first. Done
    # BEFORE the upstream OCR so a user at the cap doesn't burn a
    # paid vision call only to be refused.
    from ..dependencies.plan_guards import (
        PLAN_QUOTAS,
        _atomic_charge_counter,
        _get_or_create_counter,
        _is_premium,
    )
    from ..models import SubscriptionTier

    premium = _is_premium(current_user)
    plan = SubscriptionTier.PREMIUM if premium else SubscriptionTier.FREE
    counter = await _get_or_create_counter(current_user.id, db)
    limits = PLAN_QUOTAS.get(plan, PLAN_QUOTAS[SubscriptionTier.FREE])
    limit = limits.get("chat_messages", 20)
    if counter.chat_messages >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "quota_exceeded",
                "resource": "chat_messages",
                "limit": limit,
                "used": counter.chat_messages,
                "plan": plan.value,
            },
        )

    # Defer the import so the helper module stays pure and so test
    # collection doesn't trip the source-introspection guard.
    import asyncio

    from ..services.qwen_dashscope import ocr_image_bytes

    try:
        transcribed = await asyncio.to_thread(ocr_image_bytes, png_bytes)
    except Exception as e:
        logger.exception(
            "chat_image_ocr: upstream OCR call failed for user_id=%s: %s",
            getattr(current_user, "id", None),
            e,
        )
        # v3.82: do NOT charge the quota — upstream failure should
        # not consume the user's daily budget (v3.3 pattern).
        raise HTTPException(
            status_code=502,
            detail=ocr_error_message("upstream-failed", lang),
        ) from e

    # v3.82 charge-after-success. Classifier-driven failures (blank
    # page / empty OCR) DO consume a unit because the upstream call
    # actually ran — same convention as the WS path (v3.3) where
    # a model that returned an empty string still counted.
    # v3.85 (2026-05-03): atomic UPDATE so concurrent OCR uploads
    # can't both read N and both write N+1.
    new_value = await _atomic_charge_counter(
        user_id=counter.user_id, resource="chat_messages", db=db
    )
    counter.chat_messages = new_value
    await db.commit()

    classification = classify_ocr_result(transcribed)
    seed_text = build_ocr_seed(transcribed, lang)

    return {
        "transcribed": transcribed if isinstance(transcribed, str) else "",
        "classification": classification,
        "seed_text": seed_text,
        "error_message": (
            None if classification == "ok" else ocr_error_message(classification, lang)
        ),
    }
