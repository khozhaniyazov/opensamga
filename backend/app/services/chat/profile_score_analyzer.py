from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.constants.subjects import (
    get_compulsory_subjects,
    get_max_score,
    get_subject_by_name,
    normalize_subject_name,
)
from app.models import ExamAttempt, PracticeSession, StudentProfile, UniversityDetail, User
from app.services.gap_analyzer import (
    RECENT_RELEVANT_MISTAKE_LIMIT,
    cluster_mistakes_by_topic,
    count_unresolved_mistakes,
    get_user_target_threshold,
    is_representative_mock_exam,
)
from app.services.major_resolver import resolve_major_titles

UNT_TOTAL_MAX_SCORE = 140
RECENT_MISTAKE_WINDOW_DAYS = 45
RECENT_EXAM_LOOKBACK_LIMIT = 20
RECENT_PRACTICE_LOOKBACK_LIMIT = 20

_PROFILE_SCOPE_MARKERS = (
    "my profile",
    "profile results",
    "last results",
    "my scores",
    "мой профиль",
    "профил",
    "мои результаты",
    "последние результаты",
    "мои баллы",
    "менің профил",
    "менің нәтиж",
    "соңғы нәтиж",
)

_SCORE_MARKERS = (
    "score",
    "scores",
    "result",
    "results",
    "points",
    "балл",
    "баллы",
    "результат",
    "нәтиже",
    "ұпай",
)

_ANALYSIS_MARKERS = (
    "analyze",
    "analysis",
    "stronger",
    "weaker",
    "weakest",
    "gap",
    "grant",
    "dream university",
    "проанализ",
    "анализ",
    "сильнее",
    "слабее",
    "добрать",
    "грант",
    "университет мечты",
    "цель",
    "күшт",
    "әлсіз",
    "грант",
    "арман",
    "мақсат",
)

_FOLLOWUP_MARKERS = (
    "focus",
    "improve",
    "improvement",
    "plan",
    "next step",
    "next steps",
    "what next",
    "what should i do",
    "what should i do next",
    "что дальше",
    "что делать дальше",
    "что делать",
    "что мне делать",
    "что мне делать дальше",
    "план",
    "улучш",
    "подтян",
    "сфокус",
    "следующ",
    "рекомен",
    "нестеу",
    "не істеу",
    "маған не істеу",
    "ары қарай",
    "маған ары қарай не істеу",
    "жоспар",
    "жақсарт",
    "фокус",
    "қадам",
)

_PROFILE_FACT_MARKERS = (
    "profile subjects",
    "weakest subject",
    "dream university",
    "профильные предметы",
    "самый слабый предмет",
    "университет мечты",
    "бейіндік пән",
    "ең әлсіз пән",
    "арман университет",
    "арман жоо",
)

_ACADEMIC_EXPLANATION_MARKERS = (
    "explain",
    "solve",
    "textbook",
    "source",
    "citation",
    "объясни",
    "реши",
    "учебник",
    "источник",
    "цитат",
    "түсіндір",
    "шеш",
    "оқулық",
    "дереккөз",
)

_PROFILE_SUBJECT_PATTERNS = (
    r"(?:profile subjects|профильные предметы|бейіндік пән(?:дер)?і?)\s*[:\-]\s*([^\n;]+)",
)

_WEAKEST_SUBJECT_PATTERNS = (
    r"(?:weakest subject|самый слабый предмет|ең әлсіз пән)\s*[:\-]\s*([^\n;]+)",
)

_DREAM_UNIVERSITY_PATTERNS = (
    r"(?:dream university|университет мечты|арман университет|арман жоо)\s*[:\-]\s*([^\n;]+)",
)

_HYPOTHETICAL_MARKERS = (
    "hypothetical",
    "suppose",
    "imagine",
    "let's say",
    "what if",
    "example",
    "for example",
    "если бы",
    "предположим",
    "допустим",
    "представь",
    "пример",
    "гипотет",
    "мысалы",
    "мысал",
    "елестет",
    "айталық",
)

_COMPARISON_MARKERS = (
    "stronger",
    "weaker",
    "weakest",
    "сильнее",
    "слабее",
    "самый слабый",
    "күштірек",
    "әлсіз",
)

_TARGET_QUERY_MARKERS = (
    "grant",
    "threshold",
    "admission",
    "chance",
    "fit",
    "target university",
    "сколько баллов",
    "грант",
    "порог",
    "проходной",
    "поступить",
    "шанс",
    "подойду",
    "смогу ли",
    "қанша балл",
    "шанс",
    "түсу",
    "порог",
)

_COMPACT_MARKERS = (
    "one line",
    "single line",
    "short answer",
    "briefly",
    "коротко",
    "кратко",
    "одной строкой",
    "в одной строке",
    "одним предложением",
    "қысқа",
    "бір жол",
    "бір сөйлем",
)

_TODAY_MARKERS = (
    "today",
    "for today",
    "сегодня",
    "на сегодня",
    "бүгін",
)

_WEEKLY_PLAN_MARKERS = (
    "this week",
    "weekly",
    "week plan",
    "plan for the week",
    "7 day",
    "7 days",
    "на неделю",
    "неделю",
    "недель",
    "апта",
    "апталық",
    "7 күн",
)

_SPRINT_MARKERS = (
    "3 day",
    "3-day",
    "three day",
    "sprint",
    "3 days",
    "3 дня",
    "3-днев",
    "на 3 дня",
    "трехднев",
    "спринт",
    "үш күн",
    "3 күн",
)

_MISTAKE_MARKERS = (
    "mistake",
    "mistakes",
    "mistake review",
    "weak topic",
    "gap analysis",
    "ошиб",
    "ошибка",
    "разбор ошибок",
    "қате",
    "қател",
    "олқылық",
)

_EXAM_MARKERS = (
    "exam",
    "mock exam",
    "test",
    "quiz",
    "пробник",
    "экзам",
    "тест",
    "сынақ",
    "емтихан",
)

_PRACTICE_MARKERS = (
    "practice set",
    "practice session",
    "samga practice",
    "last practice",
    "after this practice",
    "after the last practice",
    "after this drill",
    "after the last drill",
    "practice run",
    "drill",
    "drills",
    "practice",
    "практика",
    "практики",
    "после этой практики",
    "после последней практики",
    "после этого дрилла",
    "после последнего дрилла",
    "после этой серии",
    "дрилл",
    "дрилла",
    "жаттығу",
    "жаттығудан кейін",
    "соңғы практика",
    "осы практикадан кейін",
    "соңғы жаттығудан кейін",
)

_STUDY_MARKERS = (
    "study",
    "prepare",
    "practice",
    "учить",
    "учеб",
    "готов",
    "заним",
    "тренир",
    "оқу",
    "дайындал",
    "жаттығ",
    "практик",
)

_BREAKDOWN_MARKERS = (
    "analysis",
    "analyze",
    "проанализ",
    "последние результаты",
    "my results",
    "profile results",
    "мои результаты",
    "results",
    "результат",
    "результаты",
)

_PERSONAL_SCOPE_PATTERNS = (
    r"\bmy\b",
    r"\bme\b",
    r"\bcan i\b",
    r"\bdo i\b",
    r"\bмой\b",
    r"\bмоя\b",
    r"\bмои\b",
    r"\bмне\b",
    r"\bменя\b",
    r"\bя\b",
    r"\bу меня\b",
    r"\bменің\b",
    r"\bмаған\b",
    r"\bмен\b",
)

_EXPLICIT_TARGET_MARKERS = (
    "samga",
    "профиль samga",
    "profile samga",
    "мой профиль",
    "my profile",
    "менің профил",
)

_UNIVERSITY_REFERENCE_MARKERS = (
    "aitu",
    "kbtu",
    "sdu",
    "enu",
    "narxoz",
    "nu",
)


@dataclass(frozen=True)
class ScoreRow:
    subject: str
    scores: tuple[int, ...]
    max_score: int

    @property
    def latest(self) -> int:
        return self.scores[-1]

    @property
    def gap_to_max(self) -> int:
        return max(0, self.max_score - self.latest)

    @property
    def percent(self) -> float:
        return (self.latest / self.max_score) * 100 if self.max_score else 0.0


@dataclass(frozen=True)
class PromptProfileFacts:
    chosen_subjects: tuple[str, ...] = ()
    weakest_subject: str | None = None
    dream_university: str | None = None


@dataclass(frozen=True)
class MistakeClusterSignal:
    topic: str
    points_lost: int
    mistake_count: int


@dataclass(frozen=True)
class PracticeTrendSignal:
    subject: str
    sessions: int
    answered: int
    correct: int
    points_lost: int


@dataclass(frozen=True)
class StudySignals:
    latest_exam_attempt_id: int | None = None
    latest_exam_score: int | None = None
    latest_exam_max_score: int | None = None
    latest_exam_subjects: tuple[str, ...] = ()
    latest_exam_mistakes_are_exact: bool = False
    latest_practice_session_id: int | None = None
    latest_practice_score: int | None = None
    latest_practice_max_score: int | None = None
    latest_practice_subjects: tuple[str, ...] = ()
    latest_practice_mistakes_are_exact: bool = False
    recent_practice_trends: tuple[PracticeTrendSignal, ...] = ()
    unresolved_mistakes_count: int = 0
    top_mistakes: tuple[MistakeClusterSignal, ...] = ()

    @property
    def primary_mistake(self) -> MistakeClusterSignal | None:
        return self.top_mistakes[0] if self.top_mistakes else None

    @property
    def primary_practice_trend(self) -> PracticeTrendSignal | None:
        return self.recent_practice_trends[0] if self.recent_practice_trends else None

    @property
    def has_grounded_evidence(self) -> bool:
        return bool(
            self.primary_mistake
            or self.primary_practice_trend
            or self.latest_exam_score is not None
            or self.latest_practice_score is not None
        )


@dataclass(frozen=True)
class ProfilePromptConflict:
    prompt_subjects: tuple[str, ...]
    stored_subjects: tuple[str, ...]
    prompt_weakest_subject: str | None
    stored_weakest_subject: str | None
    prompt_dream_university: str | None
    stored_dream_university: str | None

    @property
    def has_conflict(self) -> bool:
        subject_conflict = (
            len(self.prompt_subjects) == 2
            and len(self.stored_subjects) == 2
            and tuple(sorted(self.prompt_subjects)) != tuple(sorted(self.stored_subjects))
        )
        weakest_conflict = bool(
            self.prompt_weakest_subject
            and self.stored_weakest_subject
            and self.prompt_weakest_subject != self.stored_weakest_subject
        )
        university_conflict = bool(
            self.prompt_dream_university
            and self.stored_dream_university
            and _normalize_free_text(self.prompt_dream_university)
            != _normalize_free_text(self.stored_dream_university)
        )
        return subject_conflict or weakest_conflict or university_conflict


def should_handle_profile_score_analysis(text: str, user: User | None) -> bool:
    profile = getattr(user, "profile", None) if user else None
    if not profile or not isinstance(profile.last_test_results, dict):
        return False

    lowered = (text or "").casefold()
    if not lowered.strip():
        return False

    has_profile_scope = any(marker in lowered for marker in _PROFILE_SCOPE_MARKERS)
    has_score_scope = any(marker in lowered for marker in _SCORE_MARKERS)
    has_analysis_scope = any(marker in lowered for marker in _ANALYSIS_MARKERS)
    has_followup_scope = any(marker in lowered for marker in _FOLLOWUP_MARKERS)
    has_profile_fact_scope = any(marker in lowered for marker in _PROFILE_FACT_MARKERS)
    has_target_scope = any(marker in lowered for marker in _TARGET_QUERY_MARKERS)
    has_comparison_scope = any(marker in lowered for marker in _COMPARISON_MARKERS)
    has_mistake_scope = any(marker in lowered for marker in _MISTAKE_MARKERS)
    has_exam_scope = any(marker in lowered for marker in _EXAM_MARKERS)
    has_practice_scope = any(marker in lowered for marker in _PRACTICE_MARKERS)
    has_week_scope = any(marker in lowered for marker in _WEEKLY_PLAN_MARKERS)
    has_study_scope = any(marker in lowered for marker in _STUDY_MARKERS)
    has_personal_scope = _has_personal_scope(lowered)
    has_explicit_target_anchor = any(marker in lowered for marker in _EXPLICIT_TARGET_MARKERS)
    has_personal_advice_scope = (
        (has_personal_scope and has_target_scope)
        or (
            has_personal_scope
            and has_followup_scope
            and (has_target_scope or has_explicit_target_anchor)
        )
        or (has_personal_scope and has_analysis_scope and has_comparison_scope)
    )
    has_personal_recovery_scope = has_personal_scope and (
        has_mistake_scope
        or has_exam_scope
        or has_practice_scope
        or has_week_scope
        or (has_followup_scope and has_study_scope)
    )

    if any(marker in lowered for marker in _ACADEMIC_EXPLANATION_MARKERS):
        return has_profile_scope and (has_score_scope or has_analysis_scope or has_followup_scope)

    return (
        (has_profile_scope and (has_score_scope or has_analysis_scope or has_followup_scope))
        or (has_score_scope and (has_analysis_scope or has_followup_scope))
        or (has_profile_fact_scope and (has_analysis_scope or has_followup_scope))
        or has_personal_advice_scope
        or has_personal_recovery_scope
    )


def _has_personal_scope(text: str) -> bool:
    lowered = (text or "").casefold()
    return any(re.search(pattern, lowered) for pattern in _PERSONAL_SCOPE_PATTERNS)


def _university_reference_tokens(university_name: str | None) -> set[str]:
    if not university_name:
        return set()

    normalized_full = _normalize_free_text(university_name)
    tokens: set[str] = {normalized_full} if normalized_full else set()
    words = [word for word in re.split(r"\s+", normalized_full) if word]
    meaningful_words = [
        word for word in words if word not in {"университет", "university", "college", "вуз", "жоо"}
    ]
    tokens.update(word for word in meaningful_words if len(word) >= 3)

    acronym_words = [word for word in words if len(word) >= 2]
    if acronym_words:
        acronym = "".join(word[0] for word in acronym_words)
        if len(acronym) >= 2:
            tokens.add(acronym)
        compact_acronym = "".join(word if len(word) <= 3 else word[0] for word in acronym_words)
        if len(compact_acronym) >= 2:
            tokens.add(compact_acronym)

    return {token for token in tokens if token}


def _prompt_mentions_saved_target_reference(
    text: str,
    university_name: str | None,
    target_major_labels: list[str],
) -> bool:
    normalized_text = _normalize_free_text(text or "")
    if not normalized_text:
        return False

    if any(token in normalized_text for token in _university_reference_tokens(university_name)):
        return True

    for label in target_major_labels:
        normalized_label = _normalize_free_text(label)
        if normalized_label and normalized_label in normalized_text:
            return True
        code_match = re.search(r"\(([A-Za-z]\d{3})\)$", str(label).strip())
        if code_match and code_match.group(1).casefold() in normalized_text:
            return True

    return False


def _prompt_mentions_any_university_reference(text: str) -> bool:
    normalized_text = _normalize_free_text(text or "")
    if not normalized_text:
        return False
    if any(marker in normalized_text for marker in _UNIVERSITY_REFERENCE_MARKERS):
        return True
    if re.search(
        r"\b[a-z][a-z0-9&.-]*(?:\s+[a-z][a-z0-9&.-]*){0,4}\s+university\b",
        normalized_text,
    ):
        return True
    if re.search(
        r"\b[а-яё][а-яё0-9-]*(?:\s+[а-яё][а-яё0-9-]*){0,4}\s+университет\b",
        normalized_text,
    ):
        return True
    return bool(re.search(r"\b[a-z]{2,6}u\b", normalized_text))


def _should_use_saved_profile_context(
    text: str,
    university_name: str | None,
    target_major_labels: list[str],
) -> bool:
    lowered = (text or "").casefold()
    has_profile_anchor = (
        any(marker in lowered for marker in _PROFILE_SCOPE_MARKERS)
        or any(marker in lowered for marker in _PROFILE_FACT_MARKERS)
        or any(marker in lowered for marker in _EXPLICIT_TARGET_MARKERS)
    )
    has_personal_scope = _has_personal_scope(lowered)
    has_target_scope = any(marker in lowered for marker in _TARGET_QUERY_MARKERS)
    has_followup_scope = any(marker in lowered for marker in _FOLLOWUP_MARKERS)
    has_comparison_scope = any(marker in lowered for marker in _COMPARISON_MARKERS)
    has_mistake_scope = any(marker in lowered for marker in _MISTAKE_MARKERS)
    has_exam_scope = any(marker in lowered for marker in _EXAM_MARKERS)
    has_practice_scope = any(marker in lowered for marker in _PRACTICE_MARKERS)
    has_week_scope = any(marker in lowered for marker in _WEEKLY_PLAN_MARKERS)
    has_study_scope = any(marker in lowered for marker in _STUDY_MARKERS)
    mentions_saved_target = _prompt_mentions_saved_target_reference(
        text,
        university_name,
        target_major_labels,
    )
    mentions_any_university = _prompt_mentions_any_university_reference(text)
    mentions_any_major_code = bool(re.search(r"\b[a-z]\d{3}\b", lowered))
    mentions_other_target_reference = (
        mentions_any_university or mentions_any_major_code
    ) and not mentions_saved_target

    if has_profile_anchor:
        if mentions_other_target_reference and (has_target_scope or has_followup_scope):
            return False
        return True
    if has_personal_scope and has_comparison_scope:
        return True
    if has_personal_scope and has_target_scope:
        if mentions_saved_target:
            return True
        if not mentions_any_university and not mentions_any_major_code:
            return True
    if has_personal_scope and (
        has_mistake_scope
        or has_exam_scope
        or has_practice_scope
        or has_week_scope
        or (has_followup_scope and has_study_scope)
    ):
        return True
    if has_personal_scope and has_followup_scope and (mentions_saved_target or has_target_scope):
        if mentions_other_target_reference:
            return False
        return True
    return False


async def detect_profile_prompt_conflict(
    user: User | None,
    db: AsyncSession,
    text: str,
) -> ProfilePromptConflict | None:
    profile = getattr(user, "profile", None) if user else None
    if not profile:
        return None
    if _is_hypothetical_profile_prompt(text):
        return None

    prompt_facts = _extract_prompt_profile_facts(text)
    if not (
        prompt_facts.chosen_subjects
        or prompt_facts.weakest_subject
        or prompt_facts.dream_university
    ):
        return None

    stored_subjects = tuple(_chosen_subjects(profile))
    stored_weakest = (
        normalize_subject_name(str(profile.weakest_subject))
        if getattr(profile, "weakest_subject", None)
        else None
    )
    stored_dream_university = await _get_target_university_name(profile, db)

    conflict = ProfilePromptConflict(
        prompt_subjects=prompt_facts.chosen_subjects,
        stored_subjects=stored_subjects,
        prompt_weakest_subject=prompt_facts.weakest_subject,
        stored_weakest_subject=stored_weakest,
        prompt_dream_university=prompt_facts.dream_university,
        stored_dream_university=stored_dream_university,
    )
    return conflict if conflict.has_conflict else None


def build_profile_conflict_system_note(
    conflict: ProfilePromptConflict | None,
    language: str,
) -> str | None:
    if not conflict or not conflict.has_conflict:
        return None

    is_kz = language == "kz"
    conflict_lines = _render_conflict_lines(conflict, language)
    if not conflict_lines:
        return None

    header = "КОНТРОЛЬ ПРОФИЛЯ" if not is_kz else "ПРОФИЛЬ БАҚЫЛАУЫ"
    instruction = (
        "В последнем сообщении есть профильные данные, которые не совпадают с сохранённым профилем Samga. "
        "Если пользователь не говорит, что это отдельный гипотетический сценарий, явно назови расхождение одной фразой и опирайся на сохранённый профиль аккаунта."
        if not is_kz
        else "Соңғы хабарламада Samga-да сақталған профильге сәйкес келмейтін профиль деректері бар. "
        "Егер пайдаланушы мұны бөлек гипотетикалық сценарий деп айтпаса, айырманы бір сөйлеммен ашық көрсет те, сақталған аккаунт профиліне сүйен."
    )
    bullets = "\n".join(f"- {line}" for line in conflict_lines)
    return _join_sections([header, instruction, bullets])


async def build_profile_score_analysis_response(
    user: User | None,
    db: AsyncSession,
    language: str,
    text: str,
    quota_type: str = "GENERAL",
    profile_conflict: ProfilePromptConflict | None = None,
) -> str | None:
    if not should_handle_profile_score_analysis(text, user):
        return None

    profile = getattr(user, "profile", None)
    if not profile:
        return None

    rows = _extract_score_rows(profile)
    if not rows:
        return None

    is_kz = language == "kz"
    university_name = await _get_target_university_name(profile, db)
    target_major_labels = _format_target_major_labels(
        await resolve_major_titles(db, profile.target_majors or [])
    )
    if not _should_use_saved_profile_context(text, university_name, target_major_labels):
        return None
    conflict = profile_conflict or await detect_profile_prompt_conflict(user, db, text)
    threshold_info = None
    if getattr(user, "id", None):
        threshold_info = await get_user_target_threshold(user.id, db, quota_type=quota_type)

    response_mode = _detect_response_mode(text)
    study_signals = None
    if response_mode in {"focus_plan", "mistake_plan", "weekly_plan", "daily_plan", "sprint_plan"}:
        study_signals = await _load_study_signals(
            user,
            db,
            preference=_detect_study_signal_preference(text),
        )
    if response_mode == "compact_focus":
        return (
            _render_compact_focus_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
            )
            if is_kz
            else _render_compact_focus_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
            )
        )
    if response_mode == "focus_plan":
        return (
            _render_focus_plan_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
            if is_kz
            else _render_focus_plan_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
        )
    if response_mode == "mistake_plan":
        return (
            _render_mistake_plan_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
            if is_kz
            else _render_mistake_plan_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
        )
    if response_mode == "daily_plan":
        return (
            _render_daily_plan_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
            if is_kz
            else _render_daily_plan_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
        )
    if response_mode == "sprint_plan":
        return (
            _render_sprint_plan_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
            if is_kz
            else _render_sprint_plan_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
        )
    if response_mode == "weekly_plan":
        return (
            _render_weekly_plan_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
            if is_kz
            else _render_weekly_plan_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
                study_signals or StudySignals(),
            )
        )
    if response_mode == "target_gap":
        return (
            _render_target_gap_kz(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
            )
            if is_kz
            else _render_target_gap_ru(
                profile,
                rows,
                university_name,
                target_major_labels,
                conflict,
                threshold_info,
            )
        )
    return (
        _render_kz(
            profile,
            rows,
            university_name,
            target_major_labels,
            conflict,
            threshold_info,
        )
        if is_kz
        else _render_ru(
            profile,
            rows,
            university_name,
            target_major_labels,
            conflict,
            threshold_info,
        )
    )


def _extract_score_rows(profile: StudentProfile) -> list[ScoreRow]:
    raw_results = profile.last_test_results
    if not isinstance(raw_results, dict):
        return []

    buckets: dict[str, list[int]] = {}
    for raw_subject, raw_scores in raw_results.items():
        subject = normalize_subject_name(str(raw_subject))
        if not isinstance(raw_scores, list):
            continue
        max_score = get_max_score(subject)
        clean_scores: list[int] = []
        for raw_score in raw_scores[:5]:
            score = _coerce_int(raw_score)
            if score is not None and 0 <= score <= max_score:
                clean_scores.append(score)
        if clean_scores:
            buckets.setdefault(subject, []).extend(clean_scores[:5])

    ordered_subjects = _ordered_subjects(profile, list(buckets.keys()))
    return [
        ScoreRow(
            subject=subject,
            scores=tuple(buckets[subject][-5:]),
            max_score=get_max_score(subject),
        )
        for subject in ordered_subjects
        if subject in buckets and buckets[subject]
    ]


def _ordered_subjects(profile: StudentProfile, result_subjects: list[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    def add(subject: str) -> None:
        normalized = normalize_subject_name(subject)
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(normalized)

    for subject in get_compulsory_subjects():
        add(subject)
    for subject in (profile.chosen_subjects or [])[:2]:
        if isinstance(subject, str):
            add(subject)
    for subject in result_subjects:
        add(subject)
    return ordered


async def _get_target_university_name(profile: StudentProfile, db: AsyncSession) -> str | None:
    target_university_id = getattr(profile, "target_university_id", None)
    if not target_university_id:
        return None

    try:
        result = await db.execute(
            select(UniversityDetail).where(UniversityDetail.id == target_university_id)
        )
        university = result.scalar_one_or_none()
        if university:
            return (
                getattr(university, "full_name", None) or getattr(university, "name", None) or None
            )
    except Exception:
        return None
    return None


def _extract_prompt_profile_facts(text: str) -> PromptProfileFacts:
    subjects = ()
    for pattern in _PROFILE_SUBJECT_PATTERNS:
        segment = _extract_labeled_segment(pattern, text)
        extracted = _extract_subjects_from_segment(segment)
        if extracted:
            subjects = extracted
            break

    weakest_subject = None
    for pattern in _WEAKEST_SUBJECT_PATTERNS:
        segment = _extract_labeled_segment(pattern, text)
        if segment:
            normalized = normalize_subject_name(segment)
            if get_subject_by_name(normalized):
                weakest_subject = normalized
                break

    dream_university = None
    for pattern in _DREAM_UNIVERSITY_PATTERNS:
        segment = _extract_labeled_segment(pattern, text)
        if segment:
            dream_university = segment
            break

    return PromptProfileFacts(
        chosen_subjects=subjects,
        weakest_subject=weakest_subject,
        dream_university=dream_university,
    )


def _extract_labeled_segment(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text or "", flags=re.IGNORECASE)
    if not match:
        return None
    value = re.split(r"[.!?](?:\s|$)", match.group(1).strip(), maxsplit=1)[0]
    value = value.strip(" .,:;")
    return value or None


def _extract_subjects_from_segment(segment: str | None) -> tuple[str, ...]:
    if not segment:
        return ()

    raw_parts = re.split(r"\s*(?:,|\+|/| и | және | & )\s*", segment, flags=re.IGNORECASE)
    subjects: list[str] = []
    seen: set[str] = set()
    for raw in raw_parts:
        normalized = normalize_subject_name(raw)
        if not get_subject_by_name(normalized):
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        subjects.append(normalized)
        if len(subjects) == 2:
            break
    return tuple(subjects)


def _is_hypothetical_profile_prompt(text: str) -> bool:
    lowered = (text or "").casefold()
    if not lowered.strip():
        return False
    return any(marker in lowered for marker in _HYPOTHETICAL_MARKERS)


def _is_meaningful_exam_attempt(attempt: ExamAttempt) -> bool:
    total_questions = _coerce_int(getattr(attempt, "total_questions", None)) or 0
    return is_representative_mock_exam(
        total_questions,
        getattr(attempt, "answers", None),
    )


def _relevant_mistake_topics(
    profile: StudentProfile | None,
    latest_exam: ExamAttempt | None,
    latest_practice: PracticeSession | None = None,
) -> tuple[str, ...]:
    topics: list[str] = []
    seen: set[str] = set()

    def _push(raw_value: object) -> None:
        text = str(raw_value or "").strip()
        if not text:
            return
        normalized = normalize_subject_name(text)
        if not get_subject_by_name(normalized):
            return
        key = normalized.casefold()
        if key in seen:
            return
        seen.add(key)
        topics.append(normalized)

    for subject in getattr(latest_exam, "subjects", None) or []:
        _push(subject)

    practice_subject = getattr(latest_practice, "subject", None)
    if practice_subject:
        _push(practice_subject)

    if profile:
        for subject in _required_subjects(profile):
            _push(subject)

    return tuple(topics)


def _coerce_mistake_cluster_signals(
    clusters: list[dict],
) -> tuple[MistakeClusterSignal, ...]:
    top_mistakes: list[MistakeClusterSignal] = []
    for cluster in clusters:
        topic = str(cluster.get("topic") or "").strip()
        points_lost = _coerce_int(cluster.get("points_lost")) or 0
        mistake_count = _coerce_int(cluster.get("mistake_count")) or 0
        if not topic or (points_lost <= 0 and mistake_count <= 0):
            continue
        top_mistakes.append(
            MistakeClusterSignal(
                topic=topic,
                points_lost=points_lost,
                mistake_count=mistake_count,
            )
        )
    return tuple(top_mistakes)


async def _load_latest_exam_mistake_clusters(
    user: User,
    db: AsyncSession,
    latest_exam: ExamAttempt | None,
) -> tuple[int, tuple[MistakeClusterSignal, ...]]:
    exam_attempt_id = _coerce_int(getattr(latest_exam, "id", None))
    if not exam_attempt_id:
        return 0, ()

    clusters = await cluster_mistakes_by_topic(
        user.id,
        db,
        question_types=("exam",),
        exam_attempt_id=exam_attempt_id,
        limit=3,
    )
    top_mistakes = _coerce_mistake_cluster_signals(clusters)
    if not top_mistakes:
        return 0, ()

    unresolved_count = await count_unresolved_mistakes(
        user.id,
        db,
        question_types=("exam",),
        exam_attempt_id=exam_attempt_id,
    )
    return unresolved_count, top_mistakes


def _is_meaningful_practice_session(session: PracticeSession | None) -> bool:
    if session is None:
        return False
    answered_questions = _coerce_int(getattr(session, "answered_questions_count", None)) or 0
    return answered_questions > 0


def _build_recent_practice_trends(
    practice_rows: list[PracticeSession],
) -> tuple[PracticeTrendSignal, ...]:
    aggregates: dict[str, dict[str, int]] = {}
    for session in practice_rows:
        if not _is_meaningful_practice_session(session):
            continue
        raw_subject = str(getattr(session, "subject", "") or "").strip()
        if not raw_subject:
            continue
        subject = normalize_subject_name(raw_subject)
        answered = _coerce_int(getattr(session, "answered_questions_count", None)) or 0
        correct = _coerce_int(getattr(session, "correct_answers_count", None)) or 0
        if answered <= 0:
            continue
        stats = aggregates.setdefault(
            subject,
            {"sessions": 0, "answered": 0, "correct": 0, "points_lost": 0},
        )
        stats["sessions"] += 1
        stats["answered"] += answered
        stats["correct"] += correct
        stats["points_lost"] += max(0, answered - correct)

    trends = [
        PracticeTrendSignal(
            subject=subject,
            sessions=stats["sessions"],
            answered=stats["answered"],
            correct=stats["correct"],
            points_lost=stats["points_lost"],
        )
        for subject, stats in aggregates.items()
        if stats["points_lost"] > 0
    ]
    trends.sort(
        key=lambda signal: (
            signal.points_lost,
            signal.sessions,
            signal.answered,
            signal.subject,
        ),
        reverse=True,
    )
    return tuple(trends[:3])


async def _load_latest_practice_mistake_clusters(
    user: User,
    db: AsyncSession,
    latest_practice: PracticeSession | None,
) -> tuple[int, tuple[MistakeClusterSignal, ...]]:
    practice_session_id = _coerce_int(getattr(latest_practice, "id", None))
    if not practice_session_id:
        return 0, ()

    clusters = await cluster_mistakes_by_topic(
        user.id,
        db,
        question_types=("practice",),
        practice_session_id=practice_session_id,
        limit=3,
    )
    top_mistakes = _coerce_mistake_cluster_signals(clusters)
    if not top_mistakes:
        return 0, ()

    unresolved_count = await count_unresolved_mistakes(
        user.id,
        db,
        question_types=("practice",),
        practice_session_id=practice_session_id,
    )
    return unresolved_count, top_mistakes


async def _load_relevant_mistake_clusters(
    user: User,
    db: AsyncSession,
    latest_exam: ExamAttempt | None,
    latest_practice: PracticeSession | None = None,
    *,
    preference: str = "auto",
) -> tuple[int, tuple[MistakeClusterSignal, ...]]:
    profile = getattr(user, "profile", None)
    topic_tags = _relevant_mistake_topics(profile, latest_exam, latest_practice)
    if preference == "practice":
        scoped_attempts = [
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("practice",),
                "topic_tags": topic_tags or None,
            },
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("practice",),
                "topic_tags": None,
            },
            {
                "recent_days": None,
                "question_types": ("practice",),
                "topic_tags": topic_tags or None,
            },
        ]
    elif preference == "exam":
        scoped_attempts = [
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("exam",),
                "topic_tags": topic_tags or None,
            },
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("exam",),
                "topic_tags": None,
            },
            {
                "recent_days": None,
                "question_types": ("exam",),
                "topic_tags": topic_tags or None,
            },
        ]
    else:
        scoped_attempts = [
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("exam", "practice"),
                "topic_tags": topic_tags or None,
            },
            {
                "recent_days": RECENT_MISTAKE_WINDOW_DAYS,
                "question_types": ("exam", "practice"),
                "topic_tags": None,
            },
            {
                "recent_days": None,
                "question_types": ("exam", "practice"),
                "topic_tags": topic_tags or None,
            },
        ]

    for scope in scoped_attempts:
        clusters = await cluster_mistakes_by_topic(
            user.id,
            db,
            recent_days=scope["recent_days"],
            question_types=scope["question_types"],
            topic_tags=scope["topic_tags"],
            limit=3,
            recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
        )
        if not clusters:
            continue

        unresolved_count = await count_unresolved_mistakes(
            user.id,
            db,
            recent_days=scope["recent_days"],
            question_types=scope["question_types"],
            topic_tags=scope["topic_tags"],
            recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
        )
        top_mistakes = _coerce_mistake_cluster_signals(clusters)
        if top_mistakes:
            return unresolved_count, top_mistakes

    return 0, ()


async def _load_study_signals(
    user: User | None,
    db: AsyncSession,
    *,
    preference: str = "auto",
) -> StudySignals:
    if not user or not getattr(user, "id", None):
        return StudySignals()

    latest_exam = None
    latest_practice = None
    practice_rows: list[PracticeSession] = []
    if preference != "practice":
        exam_rows = (
            (
                await db.execute(
                    select(ExamAttempt)
                    .where(ExamAttempt.user_id == user.id)
                    .order_by(ExamAttempt.submitted_at.desc())
                    .limit(RECENT_EXAM_LOOKBACK_LIMIT)
                )
            )
            .scalars()
            .all()
        )
        latest_exam = next(
            (attempt for attempt in exam_rows if _is_meaningful_exam_attempt(attempt)),
            None,
        )
    if preference == "practice":
        practice_rows = (
            (
                await db.execute(
                    select(PracticeSession)
                    .where(PracticeSession.user_id == user.id)
                    .order_by(PracticeSession.updated_at.desc(), PracticeSession.id.desc())
                    .limit(RECENT_PRACTICE_LOOKBACK_LIMIT)
                )
            )
            .scalars()
            .all()
        )
        latest_practice = next(
            (session for session in practice_rows if _is_meaningful_practice_session(session)),
            None,
        )

    unresolved_count = 0
    top_mistakes: tuple[MistakeClusterSignal, ...] = ()
    exact_latest_exam_mistakes = False
    exact_latest_practice_mistakes = False

    if preference == "practice":
        unresolved_count, top_mistakes = await _load_latest_practice_mistake_clusters(
            user,
            db,
            latest_practice,
        )
        exact_latest_practice_mistakes = bool(top_mistakes)
        if not top_mistakes:
            unresolved_count, top_mistakes = await _load_relevant_mistake_clusters(
                user,
                db,
                latest_exam,
                latest_practice,
                preference="practice",
            )
    else:
        unresolved_count, top_mistakes = await _load_latest_exam_mistake_clusters(
            user,
            db,
            latest_exam,
        )
        exact_latest_exam_mistakes = bool(top_mistakes)
        if not top_mistakes:
            unresolved_count, top_mistakes = await _load_relevant_mistake_clusters(
                user,
                db,
                latest_exam,
                latest_practice,
                preference=preference,
            )

    latest_subjects = tuple(
        str(subject).strip()
        for subject in (getattr(latest_exam, "subjects", None) or [])
        if str(subject).strip()
    )
    latest_practice_subjects = tuple(
        str(subject).strip()
        for subject in [getattr(latest_practice, "subject", None)]
        if str(subject or "").strip()
    )
    latest_practice_answered = _coerce_int(
        getattr(latest_practice, "answered_questions_count", None)
    )
    recent_practice_trends = (
        _build_recent_practice_trends(practice_rows) if preference == "practice" else ()
    )

    return StudySignals(
        latest_exam_attempt_id=_coerce_int(getattr(latest_exam, "id", None)),
        latest_exam_score=_coerce_int(getattr(latest_exam, "score", None)),
        latest_exam_max_score=_coerce_int(getattr(latest_exam, "max_score", None)),
        latest_exam_subjects=latest_subjects,
        latest_exam_mistakes_are_exact=exact_latest_exam_mistakes,
        latest_practice_session_id=_coerce_int(getattr(latest_practice, "id", None)),
        latest_practice_score=_coerce_int(getattr(latest_practice, "correct_answers_count", None)),
        latest_practice_max_score=(
            latest_practice_answered
            if latest_practice_answered is not None and latest_practice_answered > 0
            else _coerce_int(getattr(latest_practice, "target_questions", None))
        ),
        latest_practice_subjects=latest_practice_subjects,
        latest_practice_mistakes_are_exact=exact_latest_practice_mistakes,
        recent_practice_trends=recent_practice_trends,
        unresolved_mistakes_count=unresolved_count,
        top_mistakes=top_mistakes,
    )


def _detect_response_mode(text: str) -> str:
    lowered = (text or "").casefold()
    has_score_scope = any(marker in lowered for marker in _SCORE_MARKERS)
    has_followup_scope = any(marker in lowered for marker in _FOLLOWUP_MARKERS)
    has_comparison_scope = any(marker in lowered for marker in _COMPARISON_MARKERS)
    has_target_scope = any(marker in lowered for marker in _TARGET_QUERY_MARKERS)
    has_analysis_scope = any(marker in lowered for marker in _ANALYSIS_MARKERS)
    has_breakdown_scope = any(marker in lowered for marker in _BREAKDOWN_MARKERS)
    has_mistake_scope = any(marker in lowered for marker in _MISTAKE_MARKERS)
    has_exam_scope = any(marker in lowered for marker in _EXAM_MARKERS)
    has_practice_scope = any(marker in lowered for marker in _PRACTICE_MARKERS)
    has_week_scope = any(marker in lowered for marker in _WEEKLY_PLAN_MARKERS)
    has_sprint_scope = any(marker in lowered for marker in _SPRINT_MARKERS)
    has_today_scope = any(marker in lowered for marker in _TODAY_MARKERS)
    has_study_scope = any(marker in lowered for marker in _STUDY_MARKERS)
    wants_compact = any(marker in lowered for marker in _COMPACT_MARKERS)

    if wants_compact:
        return "compact_focus"
    if has_today_scope and (
        has_followup_scope
        or has_mistake_scope
        or has_exam_scope
        or has_practice_scope
        or has_study_scope
    ):
        return "daily_plan"
    if has_sprint_scope and (
        has_followup_scope
        or has_mistake_scope
        or has_exam_scope
        or has_practice_scope
        or has_study_scope
    ):
        return "sprint_plan"
    if has_week_scope and (
        has_followup_scope
        or has_mistake_scope
        or has_exam_scope
        or has_practice_scope
        or has_study_scope
    ):
        return "weekly_plan"
    if (has_mistake_scope or has_exam_scope or has_practice_scope) and (
        has_followup_scope or has_breakdown_scope or has_analysis_scope or has_comparison_scope
    ):
        return "mistake_plan"
    if (
        has_target_scope
        and not has_followup_scope
        and not has_comparison_scope
        and not has_breakdown_scope
    ):
        return "target_gap"
    if has_followup_scope and not has_score_scope and not has_comparison_scope:
        return "focus_plan"
    return "full_analysis"


def _detect_study_signal_preference(text: str) -> str:
    lowered = (text or "").casefold()
    has_exam_scope = any(marker in lowered for marker in _EXAM_MARKERS)
    has_practice_scope = any(marker in lowered for marker in _PRACTICE_MARKERS)
    if has_practice_scope and not has_exam_scope:
        return "practice"
    if has_exam_scope and not has_practice_scope:
        return "exam"
    if has_practice_scope:
        return "practice"
    return "auto"


def _format_target_major_labels(labels: list[str]) -> list[str]:
    formatted: list[str] = []
    seen: set[str] = set()
    for label in labels:
        text = str(label or "").strip()
        if not text:
            continue
        match = re.match(r"^([A-Za-z]\d{3})\s+[—-]\s+(.+)$", text)
        if match:
            text = f"{match.group(2).strip()} ({match.group(1).upper()})"
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        formatted.append(text)
    return formatted


def _quota_label(language: str, quota_type: str | None) -> str:
    normalized = str(quota_type or "GENERAL").strip().upper()
    if language == "kz":
        return "ауыл квотасы" if normalized == "RURAL" else "жалпы конкурс"
    return "сельская квота" if normalized == "RURAL" else "общий конкурс"


def _quota_context_label(language: str, quota_type: str | None) -> str:
    normalized = str(quota_type or "GENERAL").strip().upper()
    if language == "kz":
        return "ауыл квотасы бойынша" if normalized == "RURAL" else "жалпы конкурс бойынша"
    return "по сельской квоте" if normalized == "RURAL" else "по общему конкурсу"


def _compact_conflict_note(
    conflict: ProfilePromptConflict | None,
    language: str,
) -> str | None:
    if not conflict or not conflict.has_conflict:
        return None
    return (
        "Вижу, что текст в сообщении не совпадает с сохранённым профилем Samga, поэтому опираюсь на профиль аккаунта."
        if language == "ru"
        else "Хабарламадағы мәтін Samga-дағы сақталған профильмен сәйкес келмейді, сондықтан аккаунт профиліне сүйенемін."
    )


def _build_threshold_comparison_fragment(
    language: str,
    current_score: int,
    threshold: int,
    *,
    reference_kind: str,
    score_context: str = "profile_results",
) -> str:
    delta = current_score - threshold
    if language == "ru":
        reference = "этого уровня" if reference_kind == "level" else "этого ориентира"
        if score_context == "latest_exam":
            if delta > 0:
                return (
                    f"результат последнего осмысленного экзамена {current_score}/140 "
                    f"уже выше {reference} на +{delta}"
                )
            if delta == 0:
                return (
                    f"результат последнего осмысленного экзамена {current_score}/140 "
                    "уже на этом уровне"
                )
            return (
                f"по результату последнего осмысленного экзамена {current_score}/140 "
                f"не хватает +{abs(delta)}"
            )
        if delta > 0:
            return f"текущая база {current_score}/140 уже выше {reference} на +{delta}"
        if delta == 0:
            return f"текущая база {current_score}/140 уже на этом уровне"
        return f"от текущей базы {current_score}/140 не хватает +{abs(delta)}"

    reference = "осы деңгейден" if reference_kind == "level" else "осы ориентирден"
    if score_context == "latest_exam":
        if delta > 0:
            return (
                f"соңғы мағыналы емтихан нәтижесі {current_score}/140 {reference} +{delta} жоғары"
            )
        if delta == 0:
            return f"соңғы мағыналы емтихан нәтижесі {current_score}/140 осы деңгейде"
        return f"соңғы мағыналы емтихан нәтижесі {current_score}/140 бойынша +{abs(delta)} жетпейді"
    if delta > 0:
        return f"қазіргі {current_score}/140 база {reference} +{delta} жоғары"
    if delta == 0:
        return f"қазіргі {current_score}/140 база осы деңгейде"
    return f"қазіргі {current_score}/140 базадан +{abs(delta)} жетпейді"


def _build_target_snapshot_line(
    language: str,
    university_name: str | None,
    target_major_labels: list[str],
    total_latest: int | None,
    threshold_info: dict | None,
    *,
    score_context: str = "profile_results",
) -> str:
    target = university_name or (
        "университет не выбран" if language == "ru" else "университет таңдалмаған"
    )
    score_text = (
        f"{total_latest}/140"
        if total_latest is not None
        else ("/140 пока не собран" if language == "ru" else "/140 әзір толық жиналмаған")
    )

    if not target_major_labels:
        return (
            f"Цель: {target}. Сейчас вижу надёжную базу {score_text}, но точный разрыв не считаю без выбранной программы — иначе число будет выдумкой."
            if language == "ru"
            else f"Мақсат: {target}. Қазір сенімді база {score_text}, бірақ таңдалған бағдарлама болмаса нақты айырманы есептемеймін — әйтпесе сан ойдан шығады."
        )

    major_text = ", ".join(target_major_labels)
    source = (threshold_info or {}).get("source")
    threshold = (threshold_info or {}).get("grant_threshold")
    quota_label = _quota_label(language, (threshold_info or {}).get("quota_type"))
    quota_context = _quota_context_label(language, (threshold_info or {}).get("quota_type"))
    data_year = (threshold_info or {}).get("data_year")

    if threshold is None:
        if source == "major_not_resolved":
            return (
                f"Цель: {target}. Программа: {major_text}. Код/название программы пока не удалось надёжно связать с базой, поэтому точный разрыв не фиксирую."
                if language == "ru"
                else f"Мақсат: {target}. Бағыт: {major_text}. Бағдарлама коды/атауын базамен сенімді байланыстыра алмадым, сондықтан нақты айырманы бекітпеймін."
            )
        return (
            f"Цель: {target}. Программа: {major_text}. В базе пока нет надёжного порога, поэтому опираюсь только на текущую базу {score_text}."
            if language == "ru"
            else f"Мақсат: {target}. Бағыт: {major_text}. Базада сенімді шек әзір жоқ, сондықтан әзірге тек {score_text} ағымдағы базаға сүйенемін."
        )

    if total_latest is None:
        if data_year is not None:
            return (
                f"Цель: {target}. Программа: {major_text}. Вижу порог {threshold}/140 ({data_year}, {quota_label}), но без полного результата /140 точный разрыв не считаю."
                if language == "ru"
                else f"Мақсат: {target}. Бағыт: {major_text}. {threshold}/140 шегін көріп тұрмын ({data_year}, {quota_label}), бірақ толық /140 нәтиже болмаса нақты айырманы есептемеймін."
            )
        return (
            f"Цель: {target}. Программа: {major_text}. Вижу ориентир {threshold}/140 без явного года в источнике, поэтому точный разрыв не фиксирую."
            if language == "ru"
            else f"Мақсат: {target}. Бағыт: {major_text}. Дереккөзде жылы көрсетілмеген {threshold}/140 ориентирі бар, сондықтан нақты айырманы бекітпеймін."
        )

    comparison = _build_threshold_comparison_fragment(
        language,
        total_latest,
        threshold,
        reference_kind="level" if data_year is not None else "reference",
        score_context=score_context,
    )
    if data_year is not None:
        return (
            f"Цель: {target}. Программа: {major_text}. {quota_context.capitalize()} вижу порог {threshold}/140 ({data_year}), и {comparison}."
            if language == "ru"
            else f"Мақсат: {target}. Бағыт: {major_text}. {quota_context.capitalize()} {threshold}/140 шегін көріп тұрмын ({data_year}), ал {comparison}."
        )

    return (
        f"Цель: {target}. Программа: {major_text}. Вижу ориентир {threshold}/140 без явного года в источнике: {comparison}, но воспринимай это как рабочий ориентир, а не как официальный прошлогодний порог."
        if language == "ru"
        else f"Мақсат: {target}. Бағыт: {major_text}. Дереккөзде жылы көрсетілмеген {threshold}/140 ориентирін көріп тұрмын: {comparison}, бірақ мұны ресми былтырғы шек емес, жұмыс ориентирі ретінде қабылда."
    )


def _target_snapshot_score_for_study_context(
    profile_latest_total: int | None,
    study_signals: StudySignals,
) -> tuple[int | None, str]:
    latest_exam_score = study_signals.latest_exam_score
    latest_exam_max_score = study_signals.latest_exam_max_score
    if latest_exam_score is not None and latest_exam_max_score == UNT_TOTAL_MAX_SCORE:
        return latest_exam_score, "latest_exam"
    return profile_latest_total, "profile_results"


def _build_study_target_snapshot_line(
    language: str,
    university_name: str | None,
    target_major_labels: list[str],
    profile_latest_total: int | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    score, score_context = _target_snapshot_score_for_study_context(
        profile_latest_total,
        study_signals,
    )
    return _build_target_snapshot_line(
        language,
        university_name,
        target_major_labels,
        score,
        threshold_info,
        score_context=score_context,
    )


def _focus_summary_line(
    language: str,
    row: ScoreRow | None,
) -> str:
    if not row:
        return (
            "Сейчас главного резерва не вижу: введённые результаты уже на потолке."
            if language == "ru"
            else "Қазір негізгі резерв көрінбейді: енгізілген нәтижелер шегіне жеткен."
        )

    subject = _display_subject(row.subject, language)
    if language == "ru":
        return f"Главный фокус сейчас — {subject}: {row.latest}/{row.max_score}, резерв +{row.gap_to_max}."
    return f"Қазіргі негізгі фокус — {subject}: {row.latest}/{row.max_score}, резерв +{row.gap_to_max}."


def _follow_up_focus_line(
    language: str,
    rows: list[ScoreRow],
    top_row: ScoreRow | None,
) -> str:
    if not top_row:
        return (
            "Держи темп и обнови результаты после следующего полного пробника."
            if language == "ru"
            else "Қарқынды сақтап, келесі толық сынақтан кейін нәтижелерді жаңарт."
        )
    secondary = [row for row in rows if row.subject != top_row.subject and row.gap_to_max > 0]
    if secondary:
        next_row = secondary[0]
        next_subject = _display_subject(next_row.subject, language)
        if language == "ru":
            return f"После этого добери {next_subject}: там ещё +{next_row.gap_to_max}."
        return f"Одан кейін {next_subject}-ті жап: онда әлі +{next_row.gap_to_max} бар."

    return (
        "После следующего пробника обнови профиль, чтобы проверить, удержался ли результат."
        if language == "ru"
        else "Келесі пробниктен кейін нәтижені ұстап тұрғаныңды тексеру үшін профильді жаңарт."
    )


def _display_topic(topic: str, language: str) -> str:
    normalized = normalize_subject_name(str(topic))
    subject = get_subject_by_name(normalized)
    if subject:
        return subject.name_kz if language == "kz" else subject.name_ru
    return str(topic).strip()


def _ru_fresh_mistake_phrase(count: int) -> str:
    mod100 = count % 100
    mod10 = count % 10
    if 11 <= mod100 <= 14:
        return f"{count} свежих ошибок"
    if mod10 == 1:
        return f"{count} свежую ошибку"
    if 2 <= mod10 <= 4:
        return f"{count} свежие ошибки"
    return f"{count} свежих ошибок"


def _ru_last_exam_mistake_phrase(count: int) -> str:
    mod100 = count % 100
    mod10 = count % 10
    if 11 <= mod100 <= 14:
        return f"{count} ошибок из последнего экзамена"
    if mod10 == 1:
        return f"{count} ошибку из последнего экзамена"
    if 2 <= mod10 <= 4:
        return f"{count} ошибки из последнего экзамена"
    return f"{count} ошибок из последнего экзамена"


def _ru_last_practice_mistake_phrase(count: int) -> str:
    mod100 = count % 100
    mod10 = count % 10
    if 11 <= mod100 <= 14:
        return f"{count} ошибок из последней практики"
    if mod10 == 1:
        return f"{count} ошибку из последней практики"
    if 2 <= mod10 <= 4:
        return f"{count} ошибки из последней практики"
    return f"{count} ошибок из последней практики"


def _ru_lost_points_phrase(count: int) -> str:
    mod100 = count % 100
    mod10 = count % 10
    if 11 <= mod100 <= 14:
        return f"{count} потерянных баллов"
    if mod10 == 1:
        return f"{count} потерянный балл"
    if 2 <= mod10 <= 4:
        return f"{count} потерянных балла"
    return f"{count} потерянных баллов"


def _ru_in_errors_phrase(count: int) -> str:
    mod100 = count % 100
    mod10 = count % 10
    if 11 <= mod100 <= 14:
        return f"{count} ошибках"
    if mod10 == 1:
        return f"{count} ошибке"
    return f"{count} ошибках"


def _kz_last_practice_mistake_phrase(count: int) -> str:
    return f"соңғы практикадан {count} қатені"


def _kz_last_exam_mistake_phrase(count: int) -> str:
    return f"соңғы емтиханнан {count} қатені"


def _exact_mistake_context_kind(study_signals: StudySignals) -> str | None:
    if study_signals.latest_practice_mistakes_are_exact:
        return "practice"
    if study_signals.latest_exam_mistakes_are_exact:
        return "exam"
    return None


def _ru_exact_mistake_phrase(study_signals: StudySignals, count: int) -> str:
    exact_context = _exact_mistake_context_kind(study_signals)
    if exact_context == "practice":
        return _ru_last_practice_mistake_phrase(count)
    if exact_context == "exam":
        return _ru_last_exam_mistake_phrase(count)
    return _ru_fresh_mistake_phrase(count)


def _kz_exact_mistake_phrase(study_signals: StudySignals, count: int) -> str:
    exact_context = _exact_mistake_context_kind(study_signals)
    if exact_context == "practice":
        return _kz_last_practice_mistake_phrase(count)
    if exact_context == "exam":
        return _kz_last_exam_mistake_phrase(count)
    return f"{count} жаңа қатені"


def _latest_study_snapshot_line(
    language: str,
    study_signals: StudySignals,
) -> str | None:
    exact_context = _exact_mistake_context_kind(study_signals)
    if exact_context == "practice":
        if (
            study_signals.latest_practice_score is None
            or study_signals.latest_practice_max_score is None
        ):
            return None
        if language == "ru":
            return (
                f"Последняя практика: {study_signals.latest_practice_score}/"
                f"{study_signals.latest_practice_max_score}."
            )
        return (
            f"Соңғы практика: {study_signals.latest_practice_score}/"
            f"{study_signals.latest_practice_max_score}."
        )

    if study_signals.latest_exam_score is None or study_signals.latest_exam_max_score is None:
        return None
    if language == "ru":
        return (
            f"Последний осмысленный экзамен: {study_signals.latest_exam_score}/"
            f"{study_signals.latest_exam_max_score}."
        )
    return (
        f"Соңғы мағыналы емтихан: {study_signals.latest_exam_score}/"
        f"{study_signals.latest_exam_max_score}."
    )


def _find_row_for_topic(rows: list[ScoreRow], topic: str) -> ScoreRow | None:
    normalized_topic = normalize_subject_name(str(topic))
    for row in rows:
        if row.subject == normalized_topic:
            return row
    return None


def _gap_rows(rows: list[ScoreRow], *, exclude_subjects: set[str] | None = None) -> list[ScoreRow]:
    excluded = exclude_subjects or set()
    return sorted(
        [row for row in rows if row.gap_to_max > 0 and row.subject not in excluded],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )


def _ordered_plan_rows(
    profile: StudentProfile,
    rows: list[ScoreRow],
    study_signals: StudySignals,
    *,
    exclude_subjects: set[str] | None = None,
) -> list[ScoreRow]:
    excluded = exclude_subjects or set()
    row_by_subject = {row.subject: row for row in rows}
    ordered_rows: list[ScoreRow] = []
    seen_subjects: set[str] = set()

    def _push(row: ScoreRow | None) -> None:
        if row is None or row.subject in excluded or row.subject in seen_subjects:
            return
        seen_subjects.add(row.subject)
        ordered_rows.append(row)

    for signal in study_signals.top_mistakes:
        _push(_find_row_for_topic(rows, signal.topic))

    for trend in study_signals.recent_practice_trends:
        _push(row_by_subject.get(trend.subject))

    _push(_weakest_subject_row(profile, rows))

    for subject in _chosen_subjects(profile):
        _push(row_by_subject.get(subject))

    for row in _gap_rows(rows, exclude_subjects=excluded):
        _push(row)

    return ordered_rows


def _ru_practice_session_count_label(count: int) -> str:
    count = max(0, int(count))
    if count == 1:
        return "1 сессия"
    remainder_10 = count % 10
    remainder_100 = count % 100
    if remainder_10 in {2, 3, 4} and remainder_100 not in {12, 13, 14}:
        return f"{count} сессии"
    return f"{count} сессий"


def _practice_trend_summary_line(
    language: str,
    study_signals: StudySignals,
    rows: list[ScoreRow],
) -> str | None:
    trends = study_signals.recent_practice_trends
    if not trends:
        return None

    primary_subject = None
    primary = study_signals.primary_mistake
    if primary:
        related_row = _find_row_for_topic(rows, primary.topic)
        if related_row:
            primary_subject = related_row.subject

    distinct_trends = [trend for trend in trends if trend.points_lost > 0 and trend.answered > 0]
    if not distinct_trends:
        return None

    secondary_trends = [trend for trend in distinct_trends if trend.subject != primary_subject]
    if secondary_trends:
        shown = secondary_trends[:2]
        if language == "ru":
            details = "; ".join(
                (
                    f"{_display_subject(trend.subject, language)} — "
                    f"{_ru_practice_session_count_label(trend.sessions)}, "
                    f"потеряно {trend.points_lost} из {trend.answered}"
                )
                for trend in shown
            )
            return f"По недавним практикам повторяются ещё и такие зоны: {details}."
        details = "; ".join(
            (
                f"{_display_subject(trend.subject, language)} — "
                f"{trend.sessions} практика, жоғалғаны {trend.points_lost}/{trend.answered}"
            )
            for trend in shown
        )
        return f"Соңғы практикаларда қайталанатын әлсіз аймақтар да бар: {details}."

    lead = distinct_trends[0]
    if lead.sessions < 2:
        return None
    subject_display = _display_subject(lead.subject, language)
    if language == "ru":
        return (
            f"Это не разовая просадка: в последних {lead.sessions} практиках по "
            f"{subject_display} потеряно {lead.points_lost} из {lead.answered} баллов."
        )
    return (
        f"Бұл бір реттік құлдырау емес: соңғы {lead.sessions} практикада "
        f"{subject_display} бойынша {lead.points_lost}/{lead.answered} ұпай жоғалды."
    )


def _latest_exam_snapshot_line(language: str, study_signals: StudySignals) -> str | None:
    return _latest_study_snapshot_line(language, study_signals)


def _mistake_snapshot_line(
    language: str,
    study_signals: StudySignals,
    rows: list[ScoreRow],
) -> str:
    primary = study_signals.primary_mistake
    if not primary:
        return (
            "По актуальным нерешённым ошибкам данных пока мало, поэтому дальше опираюсь на профильные результаты."
            if language == "ru"
            else "Өзекті шешілмеген қателер бойынша дерек әзір аз, сондықтан төменде профиль нәтижелеріне сүйенемін."
        )

    topic_display = _display_topic(primary.topic, language)
    related_row = _find_row_for_topic(rows, primary.topic)
    if language == "ru":
        exact_context = _exact_mistake_context_kind(study_signals)
        scope_prefix = (
            "По последней практике"
            if exact_context == "practice"
            else "По последнему осмысленному экзамену"
            if exact_context == "exam"
            else "По актуальным нерешённым ошибкам"
        )
        line = (
            f"{scope_prefix} главный провал сейчас — {topic_display}: "
            f"{_ru_lost_points_phrase(primary.points_lost)} в {_ru_in_errors_phrase(primary.mistake_count)}."
        )
        if related_row and related_row.gap_to_max > 0:
            line += (
                f" По самому предмету там ещё резерв +{related_row.gap_to_max} "
                f"до {related_row.max_score}/{related_row.max_score}."
            )
        return line

    exact_context = _exact_mistake_context_kind(study_signals)
    line = (
        f"{'Соңғы практика бойынша' if exact_context == 'practice' else 'Соңғы мағыналы емтихан бойынша' if exact_context == 'exam' else 'Өзекті шешілмеген қателер бойынша'} "
        f"негізгі әлсіз жер қазір — {topic_display}: "
        f"{primary.mistake_count} қате ішінде {primary.points_lost} жоғалған балл."
    )
    if related_row and related_row.gap_to_max > 0:
        line += (
            f" Осы пәннің өзінде әлі +{related_row.gap_to_max} резерв бар, "
            f"яғни {related_row.max_score}/{related_row.max_score} дейін."
        )
    return line


def _checkpoint_step(
    language: str,
    study_signals: StudySignals,
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> str:
    threshold = (threshold_info or {}).get("grant_threshold")
    data_year = (threshold_info or {}).get("data_year")
    quota_label = _quota_label(language, (threshold_info or {}).get("quota_type"))
    latest_exam_score = study_signals.latest_exam_score
    latest_exam_max_score = study_signals.latest_exam_max_score

    if threshold is not None and data_year is not None:
        if language == "ru":
            return (
                f"В конце цикла сделай полный пробник и сверь новую базу с порогом "
                f"{threshold}/140 ({data_year}, {quota_label})."
            )
        return (
            f"Цикл соңында толық пробник жасап, жаңа базаңды {threshold}/140 "
            f"шегімен ({data_year}, {quota_label}) салыстыр."
        )

    if latest_exam_score is not None and latest_exam_max_score is not None:
        if language == "ru":
            return (
                f"После следующего полного пробника сравни результат с текущими "
                f"{latest_exam_score}/{latest_exam_max_score}, чтобы увидеть реальный сдвиг."
            )
        return (
            f"Келесі толық пробниктен кейін нәтижені қазіргі "
            f"{latest_exam_score}/{latest_exam_max_score}-пен салыстыр."
        )

    if university_name and target_major_labels:
        major_text = ", ".join(target_major_labels)
        if language == "ru":
            return f"После следующего полного пробника перепроверь разрыв до {university_name} по программе {major_text}."
        return f"Келесі толық пробниктен кейін {university_name} үшін {major_text} бағыты бойынша айырманы қайта тексер."

    return (
        "После следующего полного пробника обнови профиль и перепроверь слабые места."
        if language == "ru"
        else "Келесі толық пробниктен кейін профильді жаңартып, әлсіз жерлерді қайта тексер."
    )


def _grounded_plan_steps(
    language: str,
    rows: list[ScoreRow],
    study_signals: StudySignals,
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
    *,
    weekly: bool,
) -> list[str]:
    steps: list[str] = []
    excluded_subjects: set[str] = set()
    primary = study_signals.primary_mistake
    if primary:
        topic_display = _display_topic(primary.topic, language)
        related_row = _find_row_for_topic(rows, primary.topic)
        if related_row:
            excluded_subjects.add(related_row.subject)
        if language == "ru":
            steps.append(
                f"На этой неделе начни с темы {topic_display}: там {primary.points_lost} "
                f"в {primary.mistake_count} нерешённых ошибках {_ru_lost_points_phrase(primary.points_lost)}."
                if weekly
                else f"Сначала закрой тему {topic_display}: там {primary.points_lost} "
                f"в {primary.mistake_count} нерешённых ошибках {_ru_lost_points_phrase(primary.points_lost)}."
            )
        else:
            steps.append(
                f"Осы аптада {topic_display} тақырыбынан баста: онда {primary.mistake_count} "
                f"шешілмеген қателер ішінде {primary.points_lost} жоғалған балл бар."
                if weekly
                else f"Алдымен {topic_display} тақырыбын жап: онда {primary.mistake_count} "
                f"шешілмеген қателер ішінде {primary.points_lost} жоғалған балл бар."
            )

    gap_rows = _gap_rows(rows, exclude_subjects=excluded_subjects)
    if gap_rows:
        top_gap = gap_rows[0]
        subject_display = _display_subject(top_gap.subject, language)
        if language == "ru":
            steps.append(
                f"Параллельно держи профильный резерв по {subject_display}: там ещё +{top_gap.gap_to_max}."
            )
        else:
            steps.append(
                f"Қатарында {subject_display} бойынша профиль резервін ұста: онда әлі +{top_gap.gap_to_max} бар."
            )
    elif not steps:
        steps.append(
            "Сейчас баллы уже у потолка; держи стабильность и не теряй темп."
            if language == "ru"
            else "Қазір балдар шекке жақын; тұрақтылықты сақта да, қарқынды түсірме."
        )

    secondary_mistake = (
        study_signals.top_mistakes[1] if len(study_signals.top_mistakes) > 1 else None
    )
    if secondary_mistake:
        secondary_display = _display_topic(secondary_mistake.topic, language)
        if language == "ru":
            steps.append(
                f"Следом добей {secondary_display}: это ещё {_ru_lost_points_phrase(secondary_mistake.points_lost)}."
            )
        else:
            steps.append(
                f"Одан кейін {secondary_display}-ті жап: бұл тағы {secondary_mistake.points_lost} жоғалған балл."
            )
    elif len(gap_rows) > 1:
        second_gap = gap_rows[1]
        second_display = _display_subject(second_gap.subject, language)
        if language == "ru":
            steps.append(f"После этого добери {second_display}: там ещё +{second_gap.gap_to_max}.")
        else:
            steps.append(
                f"Одан кейін {second_display}-ті толықтыр: онда әлі +{second_gap.gap_to_max} бар."
            )
    else:
        steps.append(
            _checkpoint_step(
                language,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            )
        )
        return steps

    steps.append(
        _checkpoint_step(
            language,
            study_signals,
            university_name,
            target_major_labels,
            threshold_info,
        )
    )
    return steps


def _weakest_subject_row(
    profile: StudentProfile,
    rows: list[ScoreRow],
) -> ScoreRow | None:
    raw_weakest = getattr(profile, "weakest_subject", None)
    if not raw_weakest:
        return None
    normalized = normalize_subject_name(str(raw_weakest))
    for row in rows:
        if row.subject == normalized:
            return row
    return None


def _daily_reserve_target(row: ScoreRow) -> int:
    if row.gap_to_max <= 0:
        return 0
    if row.max_score >= 50:
        return min(row.gap_to_max, 8)
    if row.max_score >= 20:
        return min(row.gap_to_max, 4)
    return min(row.gap_to_max, 2)


def _build_weekly_schedule_lines(
    language: str,
    profile: StudentProfile,
    rows: list[ScoreRow],
    study_signals: StudySignals,
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> list[str]:
    lines: list[str] = []
    weakest_row = _weakest_subject_row(profile, rows)
    gap_rows = _gap_rows(rows)
    prioritized_rows = _ordered_plan_rows(profile, rows, study_signals)
    primary_gap_row = (
        next(
            (row for row in prioritized_rows if row.gap_to_max > 0),
            None,
        )
        or weakest_row
        or (gap_rows[0] if gap_rows else None)
    )
    primary_mistake = study_signals.primary_mistake
    row_by_subject = {row.subject: row for row in rows}
    chosen_rows = [
        row_by_subject.get(subject)
        for subject in _chosen_subjects(profile)
        if row_by_subject.get(subject) is not None
    ]

    def _first_gap_row(excluded: set[str]) -> ScoreRow | None:
        for row in gap_rows:
            if row.subject not in excluded:
                return row
        return None

    excluded_subjects = {primary_gap_row.subject} if primary_gap_row else set()
    secondary_gap_row = _first_gap_row(excluded_subjects)
    if secondary_gap_row:
        excluded_subjects.add(secondary_gap_row.subject)

    profile_support_row = next(
        (row for row in chosen_rows if row and row.subject not in excluded_subjects),
        None,
    )
    if profile_support_row:
        excluded_subjects.add(profile_support_row.subject)

    support_gap_row = _first_gap_row(excluded_subjects)
    if support_gap_row:
        excluded_subjects.add(support_gap_row.subject)

    used_subjects = {
        row.subject
        for row in (primary_gap_row, secondary_gap_row, profile_support_row)
        if row is not None
    }
    secondary_mistake = next(
        (
            signal
            for signal in study_signals.top_mistakes[1:]
            if _find_row_for_topic(rows, signal.topic) is None
            or _find_row_for_topic(rows, signal.topic).subject not in used_subjects
        ),
        None,
    )

    latest_total = _latest_total(_required_subjects(profile), row_by_subject)
    threshold = (threshold_info or {}).get("grant_threshold")
    remaining_gap = (
        max(0, threshold - latest_total)
        if threshold is not None and latest_total is not None
        else None
    )

    if primary_gap_row:
        subject_display = _display_subject(primary_gap_row.subject, language)
        related_primary_mistake = None
        if primary_mistake and _find_row_for_topic(rows, primary_mistake.topic) == primary_gap_row:
            related_primary_mistake = primary_mistake

        reserve_target = _daily_reserve_target(primary_gap_row)
        if language == "ru":
            checkpoint = (
                f"разобрать "
                f"{_ru_exact_mistake_phrase(study_signals, related_primary_mistake.mistake_count)} "
                f"и вернуть минимум +{max(1, min(related_primary_mistake.points_lost, 3))} "
                f"из доступных +{related_primary_mistake.points_lost}"
                if related_primary_mistake
                else (
                    f"снять первые +{reserve_target} из доступных +{primary_gap_row.gap_to_max} резерва"
                    if reserve_target > 0
                    else "удержать текущий максимум"
                )
            )
            lines.append(
                f"День 1 — {subject_display}: 70 минут точечных задач + 20 минут журнала ошибок. "
                f"Контрольная точка: {checkpoint}."
            )
            day2_checkpoint = (
                f"закрыть вчерашние ловушки и снять ещё первые +{reserve_target}."
                if reserve_target > 0
                else f"удержать {primary_gap_row.latest}/{primary_gap_row.max_score} без новых потерь."
            )
            lines.append(
                f"День 2 — {subject_display}: 60 минут тайм-сета + 20 минут повторного решения вчерашних ошибок. "
                f"Контрольная точка: {day2_checkpoint}"
            )
        else:
            checkpoint = (
                f"{related_primary_mistake.mistake_count} қатені талдап, {related_primary_mistake.points_lost} "
                f"жоғалған баллдың кемі {max(1, min(related_primary_mistake.points_lost, 3))}-ын қайтару"
                if related_primary_mistake
                else (
                    f"қолдағы +{primary_gap_row.gap_to_max} резервтің алғашқы +{reserve_target}-ын жабу"
                    if reserve_target > 0
                    else "қазіргі максимумды ұстап тұру"
                )
            )
            lines.append(
                f"1-күн — {subject_display}: 70 минут нүктелік тапсырма + 20 минут қате журналы. "
                f"Бақылау нүктесі: {checkpoint}."
            )
            day2_checkpoint = (
                f"{subject_display.lower()} бойынша шешілмеген қақпандар қалдырмау және тағы алғашқы +{reserve_target}-ын жабу."
                if reserve_target > 0
                else f"{primary_gap_row.latest}/{primary_gap_row.max_score} деңгейді жаңа жоғалтусыз ұстап тұру."
            )
            lines.append(
                f"2-күн — {subject_display}: 60 минут тайм-сет + 20 минут кешегі қателерді қайта шешу. "
                f"Бақылау нүктесі: {day2_checkpoint}"
            )

    def _next_schedule_row(excluded: set[str]) -> ScoreRow | None:
        candidate_lists = [
            [secondary_gap_row],
            [profile_support_row],
            [support_gap_row],
            chosen_rows,
            gap_rows,
            [primary_gap_row],
        ]
        for candidate_group in candidate_lists:
            for row in candidate_group:
                if row and row.subject not in excluded:
                    return row
        return None

    day3_row = _next_schedule_row({primary_gap_row.subject} if primary_gap_row else set())
    used_day_rows = {row.subject for row in (primary_gap_row, day3_row) if row is not None}
    day4_row = _next_schedule_row(used_day_rows)
    if day4_row:
        used_day_rows.add(day4_row.subject)
    day5_row = _next_schedule_row(used_day_rows)

    focus_day3_row = day3_row
    if focus_day3_row:
        subject_display = _display_subject(focus_day3_row.subject, language)
        reserve_target = _daily_reserve_target(focus_day3_row)
        if language == "ru":
            lines.append(
                f"День 3 — {subject_display}: 50 минут коротких дриллов + 20 минут теории и формул. "
                f"Контрольная точка: снять первые +{reserve_target} из доступных +{focus_day3_row.gap_to_max}."
            )
        else:
            lines.append(
                f"3-күн — {subject_display}: 50 минут қысқа дриллдар + 20 минут теория мен формула. "
                f"Бақылау нүктесі: қолдағы +{focus_day3_row.gap_to_max} резервтің алғашқы +{reserve_target}-ын жабу."
            )

    focus_day4_row = day4_row
    if focus_day4_row:
        subject_display = _display_subject(focus_day4_row.subject, language)
        reserve_target = _daily_reserve_target(focus_day4_row)
        if language == "ru":
            checkpoint = (
                f"добрать первые +{reserve_target} и не отдавать лёгкие профильные баллы"
                if reserve_target > 0
                else f"удержать {focus_day4_row.latest}/{focus_day4_row.max_score} и не просесть по темпу"
            )
            lines.append(
                f"День 4 — {subject_display}: 55 минут профильного mixed-сета + 15 минут разбора темпа. "
                f"Контрольная точка: {checkpoint}."
            )
        else:
            checkpoint = (
                f"алғашқы +{reserve_target}-ын толықтырып, жеңіл профиль ұпайларын беріп қоймау"
                if reserve_target > 0
                else f"{focus_day4_row.latest}/{focus_day4_row.max_score} деңгейді сақтап, темпті түсірмеу"
            )
            lines.append(
                f"4-күн — {subject_display}: 55 минут профильдік mixed-сет + 15 минут темп талдауы. "
                f"Бақылау нүктесі: {checkpoint}."
            )

    if secondary_mistake:
        topic_display = _display_topic(secondary_mistake.topic, language)
        if language == "ru":
            lines.append(
                f"День 5 — {topic_display}: 45 минут коротких дриллов + 15 минут конспекта ошибок. "
                f"Контрольная точка: вернуть хотя бы {max(1, min(secondary_mistake.points_lost, 3))} из "
                f"{secondary_mistake.points_lost} потерянных баллов."
            )
        else:
            lines.append(
                f"5-күн — {topic_display}: 45 минут қысқа дриллдар + 15 минут қате конспектісі. "
                f"Бақылау нүктесі: {secondary_mistake.points_lost} жоғалған баллдың кемі "
                f"{max(1, min(secondary_mistake.points_lost, 3))}-ын қайтару."
            )
    elif day5_row:
        subject_display = _display_subject(day5_row.subject, language)
        reserve_target = _daily_reserve_target(day5_row)
        if language == "ru":
            lines.append(
                f"День 5 — {subject_display}: 40 минут короткого сета + 15 минут разбора шаблонных ошибок. "
                f"Контрольная точка: снять первые +{reserve_target} из доступных +{day5_row.gap_to_max}."
            )
        else:
            lines.append(
                f"5-күн — {subject_display}: 40 минут қысқа сет + 15 минут үлгі қателерді талдау. "
                f"Бақылау нүктесі: қолдағы +{day5_row.gap_to_max} резервтің алғашқы +{reserve_target}-ын жабу."
            )

    if language == "ru":
        mixed_checkpoint = (
            f"зафиксировать, какие 2 темы всё ещё удерживают базу ниже {threshold}/140."
            if threshold is not None and remaining_gap is not None
            else (
                f"сравнить новый микрорезультат с текущей базой {latest_total}/140."
                if latest_total is not None
                else "зафиксировать, какие темы продолжают просаживать общую базу."
            )
        )
        lines.append(
            f"День 6 — мини-пробник по 5 предметам: 80 минут смешанного блока + 20 минут разбора. "
            f"Контрольная точка: {mixed_checkpoint}"
        )
    else:
        mixed_checkpoint = (
            f"қай 2 тақырыптың базаңды әлі {threshold}/140 деңгейінен төмен ұстап тұрғанын белгілеу."
            if threshold is not None and remaining_gap is not None
            else (
                f"жаңа микро-нәтижені қазіргі {latest_total}/140 базаңмен салыстыру."
                if latest_total is not None
                else "жалпы базаңды түсіріп тұрған тақырыптарды белгілеу."
            )
        )
        lines.append(
            f"6-күн — 5 пәндік мини-пробник: 80 минут аралас блок + 20 минут талдау. "
            f"Бақылау нүктесі: {mixed_checkpoint}"
        )

    checkpoint_step = _checkpoint_step(
        language,
        study_signals,
        university_name,
        target_major_labels,
        threshold_info,
    )
    if language == "ru":
        lines.append(
            f"День 7 — контрольный пробник: {checkpoint_step[0].lower()}{checkpoint_step[1:]}"
        )
    else:
        lines.append(f"7-күн — бақылау пробнигі: {checkpoint_step[0].lower()}{checkpoint_step[1:]}")

    return lines


def _build_daily_plan_lines(
    language: str,
    profile: StudentProfile,
    rows: list[ScoreRow],
    study_signals: StudySignals,
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> list[str]:
    prioritized_rows = _ordered_plan_rows(profile, rows, study_signals)
    primary_row = prioritized_rows[0] if prioritized_rows else None
    primary_mistake = study_signals.primary_mistake

    lines: list[str] = []
    if primary_row:
        subject_display = _display_subject(primary_row.subject, language)
        reserve_target = _daily_reserve_target(primary_row)
        related_primary_mistake = None
        if primary_mistake and _find_row_for_topic(rows, primary_mistake.topic) == primary_row:
            related_primary_mistake = primary_mistake

        if language == "ru":
            checkpoint = (
                f"разобрать "
                f"{_ru_exact_mistake_phrase(study_signals, related_primary_mistake.mistake_count)} "
                f"и вернуть минимум +{max(1, min(related_primary_mistake.points_lost, 3))}"
                if related_primary_mistake
                else f"снять первые +{reserve_target} из доступных +{primary_row.gap_to_max}"
            )
            lines.append(
                f"Блок 1 — {subject_display}: 55 минут точечных задач + 15 минут разбора. "
                f"Контрольная точка: {checkpoint}."
            )
        else:
            checkpoint = (
                f"{_kz_exact_mistake_phrase(study_signals, related_primary_mistake.mistake_count)} талдап, кемі "
                f"{max(1, min(related_primary_mistake.points_lost, 3))} балл қайтару"
                if related_primary_mistake
                else f"қолдағы +{primary_row.gap_to_max} резервтің алғашқы +{reserve_target}-ын жабу"
            )
            lines.append(
                f"1-блок — {subject_display}: 55 минут нүктелік тапсырма + 15 минут талдау. "
                f"Бақылау нүктесі: {checkpoint}."
            )

    support_row = next(
        (
            row
            for row in prioritized_rows
            if primary_row is None or row.subject != primary_row.subject
        ),
        None,
    )
    if support_row:
        subject_display = _display_subject(support_row.subject, language)
        reserve_target = _daily_reserve_target(support_row)
        if language == "ru":
            lines.append(
                f"Блок 2 — {subject_display}: 35 минут короткого mixed-сета + 10 минут формул и правил. "
                f"Контрольная точка: не отдать лёгкие баллы и добрать ещё +{reserve_target}."
            )
        else:
            lines.append(
                f"2-блок — {subject_display}: 35 минут қысқа mixed-сет + 10 минут формула мен ереже. "
                f"Бақылау нүктесі: жеңіл ұпайларды жоғалтпай, тағы +{reserve_target} толықтыру."
            )

    checkpoint_step = _checkpoint_step(
        language,
        study_signals,
        university_name,
        target_major_labels,
        threshold_info,
    )
    if language == "ru":
        lines.append(
            f"Финал дня — 20 минут самопроверки: {checkpoint_step[0].lower()}{checkpoint_step[1:]}"
        )
    else:
        lines.append(
            f"Күн соңында — 20 минут өзін-өзі тексеру: {checkpoint_step[0].lower()}{checkpoint_step[1:]}"
        )

    return lines


def _build_sprint_plan_lines(
    language: str,
    profile: StudentProfile,
    rows: list[ScoreRow],
    study_signals: StudySignals,
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> list[str]:
    prioritized_rows = _ordered_plan_rows(profile, rows, study_signals)
    primary_row = prioritized_rows[0] if prioritized_rows else None
    primary_mistake = study_signals.primary_mistake
    secondary_row = next(
        (
            row
            for row in prioritized_rows
            if primary_row is None or row.subject != primary_row.subject
        ),
        None,
    )

    lines: list[str] = []
    if primary_row:
        subject_display = _display_subject(primary_row.subject, language)
        reserve_target = _daily_reserve_target(primary_row)
        related_primary_mistake = None
        if primary_mistake and _find_row_for_topic(rows, primary_mistake.topic) == primary_row:
            related_primary_mistake = primary_mistake
        if language == "ru":
            checkpoint = (
                f"разобрать "
                f"{_ru_exact_mistake_phrase(study_signals, related_primary_mistake.mistake_count)} "
                f"и вернуть минимум +{max(1, min(related_primary_mistake.points_lost, 3))}"
                if related_primary_mistake
                else f"снять первые +{reserve_target}"
            )
            lines.append(
                f"День 1 — {subject_display}: 65 минут точечных задач + 20 минут разбора. Контрольная точка: {checkpoint}."
            )
        else:
            checkpoint = (
                f"{_kz_exact_mistake_phrase(study_signals, related_primary_mistake.mistake_count)} талдап, кемі "
                f"{max(1, min(related_primary_mistake.points_lost, 3))} балл қайтару"
                if related_primary_mistake
                else f"алғашқы +{reserve_target}-ын жабу"
            )
            lines.append(
                f"1-күн — {subject_display}: 65 минут нүктелік тапсырма + 20 минут талдау. Бақылау нүктесі: {checkpoint}."
            )

    if secondary_row:
        subject_display = _display_subject(secondary_row.subject, language)
        reserve_target = _daily_reserve_target(secondary_row)
        if language == "ru":
            lines.append(
                f"День 2 — {subject_display}: 50 минут mixed-сета + 20 минут теории. Контрольная точка: добрать ещё +{reserve_target} и не терять лёгкие баллы."
            )
        else:
            lines.append(
                f"2-күн — {subject_display}: 50 минут mixed-сет + 20 минут теория. Бақылау нүктесі: тағы +{reserve_target} толықтырып, жеңіл ұпайларды жоғалтпау."
            )

    checkpoint_step = _checkpoint_step(
        language,
        study_signals,
        university_name,
        target_major_labels,
        threshold_info,
    )
    if language == "ru":
        lines.append(
            f"День 3 — мини-пробник и разбор: {checkpoint_step[0].lower()}{checkpoint_step[1:]}"
        )
    else:
        lines.append(
            f"3-күн — мини-пробник пен талдау: {checkpoint_step[0].lower()}{checkpoint_step[1:]}"
        )

    return lines


def _render_conflict_lines(
    conflict: ProfilePromptConflict,
    language: str,
) -> list[str]:
    lines: list[str] = []

    if (
        len(conflict.prompt_subjects) == 2
        and len(conflict.stored_subjects) == 2
        and tuple(sorted(conflict.prompt_subjects)) != tuple(sorted(conflict.stored_subjects))
    ):
        prompt_value = " + ".join(
            _display_subject(subject, language) for subject in conflict.prompt_subjects
        )
        stored_value = " + ".join(
            _display_subject(subject, language) for subject in conflict.stored_subjects
        )
        lines.append(
            f"в сообщении: {prompt_value}; в сохранённом профиле: {stored_value}"
            if language == "ru"
            else f"хабарламада: {prompt_value}; сақталған профильде: {stored_value}"
        )

    if (
        conflict.prompt_weakest_subject
        and conflict.stored_weakest_subject
        and conflict.prompt_weakest_subject != conflict.stored_weakest_subject
    ):
        lines.append(
            f"слабый предмет в сообщении: {_display_subject(conflict.prompt_weakest_subject, language)}; "
            f"в профиле: {_display_subject(conflict.stored_weakest_subject, language)}"
            if language == "ru"
            else f"хабарламадағы әлсіз пән: {_display_subject(conflict.prompt_weakest_subject, language)}; "
            f"профильде: {_display_subject(conflict.stored_weakest_subject, language)}"
        )

    if (
        conflict.prompt_dream_university
        and conflict.stored_dream_university
        and _normalize_free_text(conflict.prompt_dream_university)
        != _normalize_free_text(conflict.stored_dream_university)
    ):
        lines.append(
            f"университет мечты в сообщении: {conflict.prompt_dream_university}; "
            f"в профиле: {conflict.stored_dream_university}"
            if language == "ru"
            else f"хабарламадағы арман ЖОО: {conflict.prompt_dream_university}; "
            f"профильде: {conflict.stored_dream_university}"
        )

    return lines


def _render_user_conflict_note(
    conflict: ProfilePromptConflict | None,
    language: str,
) -> str | None:
    if not conflict or not conflict.has_conflict:
        return None

    lines = _render_conflict_lines(conflict, language)
    if not lines:
        return None

    if language == "ru":
        return _join_sections(
            [
                "Вижу, что данные в сообщении расходятся с сохранённым профилем Samga.",
                "\n".join(f"- {line}" for line in lines),
                "Поэтому ниже опираюсь на сохранённый профиль аккаунта.",
            ]
        )

    return _join_sections(
        [
            "Хабарламадағы деректер Samga-да сақталған профильмен сәйкес келмейді.",
            "\n".join(f"- {line}" for line in lines),
            "Сондықтан төменде аккаунттағы сақталған профильге сүйенемін.",
        ]
    )


def _render_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    required_subjects = _required_subjects(profile)
    total_latest = _latest_total(required_subjects, row_by_subject)
    profile_rows = [
        row_by_subject[subject]
        for subject in _chosen_subjects(profile)
        if subject in row_by_subject
    ]

    table = "\n".join(
        [
            "| Предмет | Последние записи | Сейчас | Резерв |",
            "|---|---:|---:|---:|",
            *[
                (
                    f"| {_display_subject(row.subject, 'ru')} | "
                    f"{', '.join(str(score) for score in row.scores)} | "
                    f"{row.latest}/{row.max_score} ({_format_percent(row.percent)}) | "
                    f"+{row.gap_to_max} |"
                )
                for row in rows
            ],
        ]
    )

    sections: list[str] = [
        "Считаю по шкале ЕНТ: история Казахстана 20, матграмотность 10, грамотность чтения 10, два профильных предмета по 50. Максимум: 140.",
        table,
    ]
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.insert(0, user_note)
    if total_latest is not None:
        sections.append(
            f"Итого по 5 предметам: {total_latest}/140. До максимума можно добрать +{UNT_TOTAL_MAX_SCORE - total_latest}."
        )
    else:
        sections.append(
            "Итог /140 не считаю: в профиле не хватает валидных результатов по всем 5 предметам."
        )

    if len(profile_rows) >= 2:
        stronger = max(profile_rows, key=lambda row: (row.percent, row.latest))
        weaker = min(profile_rows, key=lambda row: (row.percent, row.latest))
        if stronger.subject == weaker.subject or abs(stronger.percent - weaker.percent) < 0.01:
            sections.append("Профильные предметы сейчас на одном уровне по доле от максимума.")
        else:
            sections.append(
                f"Сильнее по профильным предметам: {_display_subject(stronger.subject, 'ru')} "
                f"{stronger.latest}/{stronger.max_score} ({_format_percent(stronger.percent)})."
            )
            sections.append(
                f"Слабее по текущему баллу: {_display_subject(weaker.subject, 'ru')} "
                f"{weaker.latest}/{weaker.max_score} ({_format_percent(weaker.percent)}), резерв +{weaker.gap_to_max}."
            )

    weakest_note = _weakest_subject_note(profile, row_by_subject, "ru")
    if weakest_note:
        sections.append(weakest_note)

    sections.extend(
        _target_lines_ru(
            university_name,
            total_latest,
            target_major_labels,
            threshold_info,
        )
    )
    sections.append(_next_steps_ru(rows, university_name, target_major_labels, threshold_info))
    return _join_sections(sections)


def _render_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    required_subjects = _required_subjects(profile)
    total_latest = _latest_total(required_subjects, row_by_subject)
    profile_rows = [
        row_by_subject[subject]
        for subject in _chosen_subjects(profile)
        if subject in row_by_subject
    ]

    table = "\n".join(
        [
            "| Пән | Соңғы жазбалар | Қазір | Резерв |",
            "|---|---:|---:|---:|",
            *[
                (
                    f"| {_display_subject(row.subject, 'kz')} | "
                    f"{', '.join(str(score) for score in row.scores)} | "
                    f"{row.latest}/{row.max_score} ({_format_percent(row.percent)}) | "
                    f"+{row.gap_to_max} |"
                )
                for row in rows
            ],
        ]
    )

    sections: list[str] = [
        "ҰБТ шкаласымен есептеймін: Қазақстан тарихы 20, матсауат 10, оқу сауаттылығы 10, екі бейіндік пән 50-ден. Максимум: 140.",
        table,
    ]
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.insert(0, user_note)
    if total_latest is not None:
        sections.append(
            f"5 пән бойынша жиынтық: {total_latest}/140. Максимумға дейін +{UNT_TOTAL_MAX_SCORE - total_latest} жинауға болады."
        )
    else:
        sections.append(
            "Жалпы /140 балл есептелмейді: профильде барлық 5 пән бойынша валид нәтиже жоқ."
        )

    if len(profile_rows) >= 2:
        stronger = max(profile_rows, key=lambda row: (row.percent, row.latest))
        weaker = min(profile_rows, key=lambda row: (row.percent, row.latest))
        if stronger.subject == weaker.subject or abs(stronger.percent - weaker.percent) < 0.01:
            sections.append("Бейіндік пәндер максимум үлесі бойынша қазір бір деңгейде.")
        else:
            sections.append(
                f"Бейіндік пәндер ішінде күштірек: {_display_subject(stronger.subject, 'kz')} "
                f"{stronger.latest}/{stronger.max_score} ({_format_percent(stronger.percent)})."
            )
            sections.append(
                f"Қазіргі балл бойынша әлсіздеу: {_display_subject(weaker.subject, 'kz')} "
                f"{weaker.latest}/{weaker.max_score} ({_format_percent(weaker.percent)}), резерв +{weaker.gap_to_max}."
            )

    weakest_note = _weakest_subject_note(profile, row_by_subject, "kz")
    if weakest_note:
        sections.append(weakest_note)

    sections.extend(
        _target_lines_kz(
            university_name,
            total_latest,
            target_major_labels,
            threshold_info,
        )
    )
    sections.append(_next_steps_kz(rows, university_name, target_major_labels, threshold_info))
    return _join_sections(sections)


def _render_focus_plan_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)

    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)
    if study_signals.has_grounded_evidence:
        study_line = _latest_study_snapshot_line("ru", study_signals)
        if study_line:
            sections.append(study_line)
        sections.append(_mistake_snapshot_line("ru", study_signals, rows))
        trend_line = _practice_trend_summary_line("ru", study_signals, rows)
        if trend_line:
            sections.append(trend_line)
        sections.append(
            _build_study_target_snapshot_line(
                "ru",
                university_name,
                target_major_labels,
                total_latest,
                threshold_info,
                study_signals,
            )
        )
        sections.append(
            _numbered_block(
                "Что делать дальше:",
                _grounded_plan_steps(
                    "ru",
                    rows,
                    study_signals,
                    university_name,
                    target_major_labels,
                    threshold_info,
                    weekly=False,
                ),
            )
        )
        return _join_sections(sections)

    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None
    sections.append(_focus_summary_line("ru", top_row))
    sections.append(_follow_up_focus_line("ru", ranked_rows, top_row))
    sections.append(
        _build_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    )
    sections.append(_next_steps_ru(rows, university_name, target_major_labels, threshold_info))
    return _join_sections(sections)


def _render_focus_plan_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)

    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)
    if study_signals.has_grounded_evidence:
        study_line = _latest_study_snapshot_line("kz", study_signals)
        if study_line:
            sections.append(study_line)
        sections.append(_mistake_snapshot_line("kz", study_signals, rows))
        trend_line = _practice_trend_summary_line("kz", study_signals, rows)
        if trend_line:
            sections.append(trend_line)
        sections.append(
            _build_study_target_snapshot_line(
                "kz",
                university_name,
                target_major_labels,
                total_latest,
                threshold_info,
                study_signals,
            )
        )
        sections.append(
            _numbered_block(
                "Ары қарай не істеу керек:",
                _grounded_plan_steps(
                    "kz",
                    rows,
                    study_signals,
                    university_name,
                    target_major_labels,
                    threshold_info,
                    weekly=False,
                ),
            )
        )
        return _join_sections(sections)

    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None
    sections.append(_focus_summary_line("kz", top_row))
    sections.append(_follow_up_focus_line("kz", ranked_rows, top_row))
    sections.append(
        _build_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    )
    sections.append(_next_steps_kz(rows, university_name, target_major_labels, threshold_info))
    return _join_sections(sections)


def _render_mistake_plan_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)

    exam_line = _latest_exam_snapshot_line("ru", study_signals)
    if exam_line:
        sections.append(exam_line)
    sections.append(_mistake_snapshot_line("ru", study_signals, rows))
    trend_line = _practice_trend_summary_line("ru", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "Что делать дальше:",
            _grounded_plan_steps(
                "ru",
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
                weekly=False,
            ),
        )
    )
    return _join_sections(sections)


def _render_mistake_plan_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)

    exam_line = _latest_exam_snapshot_line("kz", study_signals)
    if exam_line:
        sections.append(exam_line)
    sections.append(_mistake_snapshot_line("kz", study_signals, rows))
    trend_line = _practice_trend_summary_line("kz", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "Ары қарай не істеу керек:",
            _grounded_plan_steps(
                "kz",
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
                weekly=False,
            ),
        )
    )
    return _join_sections(sections)


def _render_daily_plan_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)
    sections.append(_mistake_snapshot_line("ru", study_signals, rows))
    trend_line = _practice_trend_summary_line("ru", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "План на сегодня:",
            _build_daily_plan_lines(
                "ru",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_daily_plan_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)
    sections.append(_mistake_snapshot_line("kz", study_signals, rows))
    trend_line = _practice_trend_summary_line("kz", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "Бүгінгі жоспар:",
            _build_daily_plan_lines(
                "kz",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_sprint_plan_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)
    sections.append(_mistake_snapshot_line("ru", study_signals, rows))
    trend_line = _practice_trend_summary_line("ru", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "3-дневный спринт:",
            _build_sprint_plan_lines(
                "ru",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_sprint_plan_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)
    sections.append(_mistake_snapshot_line("kz", study_signals, rows))
    trend_line = _practice_trend_summary_line("kz", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "3 күндік спринт:",
            _build_sprint_plan_lines(
                "kz",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_weekly_plan_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)

    exam_line = _latest_exam_snapshot_line("ru", study_signals)
    if exam_line:
        sections.append(exam_line)
    sections.append(_mistake_snapshot_line("ru", study_signals, rows))
    trend_line = _practice_trend_summary_line("ru", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "План на неделю:",
            _build_weekly_schedule_lines(
                "ru",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_weekly_plan_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
    study_signals: StudySignals,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)

    exam_line = _latest_exam_snapshot_line("kz", study_signals)
    if exam_line:
        sections.append(exam_line)
    sections.append(_mistake_snapshot_line("kz", study_signals, rows))
    trend_line = _practice_trend_summary_line("kz", study_signals, rows)
    if trend_line:
        sections.append(trend_line)
    sections.append(
        _build_study_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
            study_signals,
        )
    )
    sections.append(
        _numbered_block(
            "Апталық жоспар:",
            _build_weekly_schedule_lines(
                "kz",
                profile,
                rows,
                study_signals,
                university_name,
                target_major_labels,
                threshold_info,
            ),
        )
    )
    return _join_sections(sections)


def _render_compact_focus_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None

    parts: list[str] = []
    conflict_note = _compact_conflict_note(profile_conflict, "ru")
    if conflict_note:
        parts.append(conflict_note)
    parts.append(_focus_summary_line("ru", top_row))
    parts.append(_follow_up_focus_line("ru", ranked_rows, top_row))

    target_line = _build_target_snapshot_line(
        "ru",
        university_name,
        target_major_labels,
        total_latest,
        threshold_info,
    )
    if "не хватает +" in target_line or "уже на этом уровне" in target_line:
        parts.append(target_line)
    return " ".join(part.strip() for part in parts if part and part.strip())


def _render_compact_focus_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None

    parts: list[str] = []
    conflict_note = _compact_conflict_note(profile_conflict, "kz")
    if conflict_note:
        parts.append(conflict_note)
    parts.append(_focus_summary_line("kz", top_row))
    parts.append(_follow_up_focus_line("kz", ranked_rows, top_row))

    target_line = _build_target_snapshot_line(
        "kz",
        university_name,
        target_major_labels,
        total_latest,
        threshold_info,
    )
    if "жетпейді" in target_line or "осы деңгейде" in target_line or "шамамен +" in target_line:
        parts.append(target_line)
    return " ".join(part.strip() for part in parts if part and part.strip())


def _render_target_gap_ru(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None

    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "ru")
    if user_note:
        sections.append(user_note)
    sections.append(
        _build_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    )
    sections.append(_focus_summary_line("ru", top_row))
    sections.append(_follow_up_focus_line("ru", ranked_rows, top_row))
    return _join_sections(sections)


def _render_target_gap_kz(
    profile: StudentProfile,
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    profile_conflict: ProfilePromptConflict | None,
    threshold_info: dict | None,
) -> str:
    row_by_subject = {row.subject: row for row in rows}
    total_latest = _latest_total(_required_subjects(profile), row_by_subject)
    ranked_rows = sorted(
        [row for row in rows if row.gap_to_max > 0],
        key=lambda row: row.gap_to_max,
        reverse=True,
    )
    top_row = ranked_rows[0] if ranked_rows else None

    sections: list[str] = []
    user_note = _render_user_conflict_note(profile_conflict, "kz")
    if user_note:
        sections.append(user_note)
    sections.append(
        _build_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    )
    sections.append(_focus_summary_line("kz", top_row))
    sections.append(_follow_up_focus_line("kz", ranked_rows, top_row))
    return _join_sections(sections)


def _target_lines_ru(
    university_name: str | None,
    total_latest: int | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> list[str]:
    return [
        _build_target_snapshot_line(
            "ru",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    ]


def _target_lines_kz(
    university_name: str | None,
    total_latest: int | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> list[str]:
    return [
        _build_target_snapshot_line(
            "kz",
            university_name,
            target_major_labels,
            total_latest,
            threshold_info,
        )
    ]


def _next_steps_ru(
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> str:
    gaps = [row for row in rows if row.gap_to_max > 0]
    gaps.sort(key=lambda row: row.gap_to_max, reverse=True)

    steps: list[str] = []
    threshold = (threshold_info or {}).get("grant_threshold")
    data_year = (threshold_info or {}).get("data_year")
    quota_label = _quota_label("ru", (threshold_info or {}).get("quota_type"))
    if university_name and not target_major_labels:
        steps.append(
            f"Выбери конкретную группу программ для {university_name}, чтобы Samga считал разрыв к реальному порогу, а не к абстрактному университету."
        )
    elif threshold is not None and data_year is not None:
        steps.append(
            f"Держи в голове ориентир {threshold}/140 ({data_year}, {quota_label}) и проверяй разницу после каждого полного пробника."
        )
    elif threshold is not None:
        steps.append(
            f"Используй текущий ориентир {threshold}/140 как рабочую цель, но перепроверь его, когда появится источник с явным годом."
        )
    else:
        steps.append(
            "Закрепи цель до конкретной группы программ, чтобы сравнение шло с правильным порогом."
        )

    if gaps:
        top = gaps[0]
        steps.append(
            f"Главный резерв сейчас: {_display_subject(top.subject, 'ru')} +{top.gap_to_max} "
            f"до {top.max_score}/{top.max_score}."
        )
    else:
        steps.append("Все введенные предметы на максимуме; задача теперь удержать стабильность.")

    remaining = [
        f"{_display_subject(row.subject, 'ru')} +{row.gap_to_max}"
        for row in gaps[1:4]
        if row.gap_to_max > 0
    ]
    if remaining:
        steps.append(f"Затем закрывай мелкие потери: {', '.join(remaining)}.")
    else:
        steps.append(
            "После следующего полного пробника обнови результаты, чтобы проверить стабильность по всем 5 предметам."
        )

    return _numbered_block("3 шага дальше:", steps)


def _next_steps_kz(
    rows: list[ScoreRow],
    university_name: str | None,
    target_major_labels: list[str],
    threshold_info: dict | None,
) -> str:
    gaps = [row for row in rows if row.gap_to_max > 0]
    gaps.sort(key=lambda row: row.gap_to_max, reverse=True)

    steps: list[str] = []
    threshold = (threshold_info or {}).get("grant_threshold")
    data_year = (threshold_info or {}).get("data_year")
    quota_label = _quota_label("kz", (threshold_info or {}).get("quota_type"))
    if university_name and not target_major_labels:
        steps.append(
            f"{university_name} үшін нақты бағдарлама тобын таңда: сонда Samga абстракт университетпен емес, нақты порогпен салыстырады."
        )
    elif threshold is not None and data_year is not None:
        steps.append(
            f"{threshold}/140 ориентирін ({data_year}, {quota_label}) ойда ұста да, әр толық пробниктен кейін айырманы қайта тексер."
        )
    elif threshold is not None:
        steps.append(
            f"{threshold}/140 ағымдағы ориентирін жұмыс мақсаты ретінде ұста, бірақ жылы анық дерек шыққанда қайта тексер."
        )
    else:
        steps.append("Мақсатты нақты бағдарлама тобына дейін бекіт.")

    if gaps:
        top = gaps[0]
        steps.append(
            f"Қазіргі ең үлкен резерв: {_display_subject(top.subject, 'kz')} +{top.gap_to_max} "
            f"{top.max_score}/{top.max_score} дейін."
        )
    else:
        steps.append("Енгізілген пәндердің бәрі максимумда; енді тұрақтылықты сақтау керек.")

    remaining = [
        f"{_display_subject(row.subject, 'kz')} +{row.gap_to_max}"
        for row in gaps[1:4]
        if row.gap_to_max > 0
    ]
    if remaining:
        steps.append(f"Кейін ұсақ жоғалтуларды жап: {', '.join(remaining)}.")
    else:
        steps.append(
            "Келесі толық сынақтан кейін нәтижелерді жаңартып, 5 пән бойынша тұрақтылықты тексер."
        )

    return _numbered_block("Келесі 3 қадам:", steps)


def _weakest_subject_note(
    profile: StudentProfile,
    row_by_subject: dict[str, ScoreRow],
    language: str,
) -> str | None:
    raw_weakest = getattr(profile, "weakest_subject", None)
    if not raw_weakest:
        return None

    weakest_subject = normalize_subject_name(str(raw_weakest))
    row = row_by_subject.get(weakest_subject)
    display = _display_subject(weakest_subject, language)
    if not row:
        return (
            f"В профиле слабым предметом указан {display}, но по нему нет валидного результата."
            if language == "ru"
            else f"Профильде әлсіз пән ретінде {display} көрсетілген, бірақ ол бойынша валид нәтиже жоқ."
        )

    if row.gap_to_max == 0:
        return (
            f"В профиле слабым выбран {display}, но введенный балл уже {row.latest}/{row.max_score}. Это максимум, его нужно удерживать, а не поднимать выше {row.max_score}."
            if language == "ru"
            else f"Профильде әлсіз пән ретінде {display} таңдалған, бірақ енгізілген балл {row.latest}/{row.max_score}. Бұл максимум, оны {row.max_score}-ден жоғары көтеру мүмкін емес, сақтау керек."
        )

    return (
        f"В профиле слабым выбран {display}; по текущему результату резерв +{row.gap_to_max}."
        if language == "ru"
        else f"Профильде әлсіз пән ретінде {display} таңдалған; қазіргі резерв +{row.gap_to_max}."
    )


def _required_subjects(profile: StudentProfile) -> list[str]:
    chosen_subjects = _chosen_subjects(profile)
    if len(chosen_subjects) < 2:
        return []
    return [*get_compulsory_subjects(), *chosen_subjects[:2]]


def _chosen_subjects(profile: StudentProfile) -> list[str]:
    return [
        normalize_subject_name(subject)
        for subject in (profile.chosen_subjects or [])[:2]
        if isinstance(subject, str) and subject.strip()
    ]


def _latest_total(
    required_subjects: list[str],
    row_by_subject: dict[str, ScoreRow],
) -> int | None:
    if not required_subjects:
        return None
    if any(subject not in row_by_subject for subject in required_subjects):
        return None
    return sum(row_by_subject[subject].latest for subject in required_subjects)


def _display_subject(subject_name: str, language: str) -> str:
    subject = get_subject_by_name(subject_name)
    if not subject:
        return subject_name
    return subject.name_kz if language == "kz" else subject.name_ru


def _normalize_free_text(value: str) -> str:
    lowered = re.sub(r"[\"'`]+", "", (value or "").casefold())
    lowered = re.sub(r"[\(\)\[\]\{\},.:;!?]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _format_percent(value: float) -> str:
    return f"{value:.0f}%" if value.is_integer() else f"{value:.1f}%"


def _join_sections(sections: list[str]) -> str:
    return "\n\n".join(section.strip() for section in sections if section and section.strip())


def _numbered_block(title: str, items: list[str]) -> str:
    numbered_items = [f"{index}. {item.strip()}" for index, item in enumerate(items, start=1)]
    return _join_sections([title, "\n".join(numbered_items)])


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
