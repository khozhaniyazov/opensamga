import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.constants.subjects import (
    get_compulsory_subjects,
    get_max_score,
    get_subject_by_name,
    normalize_subject_name,
)
from app.models import (
    ActivityLog,
    ActivityType,
    ExamAttempt,
    UniversityDetail,
    User,
)
from app.services.chat.prompt_sanitizer import (
    sanitize_for_system_prompt,
    sanitize_iterable,
)
from app.services.gap_analyzer import (
    RECENT_RELEVANT_MISTAKE_LIMIT,
    cluster_mistakes_by_topic,
    count_unresolved_mistakes,
    get_user_target_threshold,
    is_representative_mock_exam,
)
from app.services.major_resolver import resolve_major_titles

logger = logging.getLogger(__name__)

UNT_TOTAL_MAX_SCORE = 140


def _format_major_display_labels(labels: list[str]) -> list[str]:
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


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _format_percent(value: float) -> str:
    return f"{value:.0f}%" if value.is_integer() else f"{value:.1f}%"


async def _is_representative_mock_exam_log(
    db: AsyncSession,
    log: ActivityLog,
) -> bool:
    metadata = log.metadata_blob if isinstance(log.metadata_blob, dict) else None
    if not metadata:
        return True

    exam_attempt_id = _coerce_int(metadata.get("exam_attempt_id"))
    if not exam_attempt_id:
        return True

    attempt_result = await db.execute(select(ExamAttempt).where(ExamAttempt.id == exam_attempt_id))
    attempt = attempt_result.scalar_one_or_none()
    if not attempt:
        return True

    total_questions = (
        _coerce_int(getattr(attempt, "total_questions", None))
        or _coerce_int(metadata.get("total_questions"))
        or 0
    )
    if total_questions <= 0:
        return True

    return is_representative_mock_exam(
        total_questions,
        getattr(attempt, "answers", None),
    )


def _build_threshold_context_metric(
    language: str,
    current_score: int,
    threshold: int,
) -> tuple[str, str]:
    delta = current_score - threshold
    if language == "kz":
        if delta > 0:
            return ("ориентирден жоғары қор", f"+{delta} балл")
        if delta == 0:
            return ("ориентирге қатысты деңгей", "дәл деңгейінде")
        return ("ағымдағы айырма", f"{abs(delta)} балл")

    if delta > 0:
        return ("запас над ориентиром", f"+{delta} баллов")
    if delta == 0:
        return ("уровень относительно ориентира", "ровно на уровне")
    return ("текущий разрыв", f"{abs(delta)} баллов")


def _ordered_score_subjects(
    chosen_subjects: list[str],
    result_subjects: list[str],
) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    def add(subject: str) -> None:
        normalized = normalize_subject_name(subject)
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(normalized)

    for subject in get_compulsory_subjects():
        add(subject)
    for subject in chosen_subjects[:2]:
        add(subject)
    for subject in result_subjects:
        add(subject)
    return ordered


async def build_user_context_prompt(
    user: User | None, db: AsyncSession, language: str = "ru"
) -> str:
    """
    Builds a personalized context block for the user based on their profile.
    Returns an empty string if user is None (guest mode).
    """
    if not user:
        return ""

    is_kz = language == "kz"

    def label(ru: str, kz: str) -> str:
        return kz if is_kz else ru

    def display_subject(name: str) -> str:
        subject = get_subject_by_name(name)
        if not subject:
            return name
        return subject.name_kz if is_kz else subject.name_ru

    context_parts = []
    profile_latest_total: int | None = None

    # 1. Identity
    # v3.80 (2026-05-03): sanitize free-form name before it lands
    # in the system prompt. Pre-v3.80 a crafted name could carry
    # newlines + Markdown headers + role labels into the
    # ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ block. See prompt_sanitizer module
    # docstring. Falls back to the localized default if the value
    # is empty or sanitizes to empty.
    safe_name = sanitize_for_system_prompt(user.name, max_len=100)
    name = safe_name or label("Пользователь", "Пайдаланушы")
    context_parts.append(f"- {label('Имя', 'Аты')}: {name}")

    # Access relationships - SQLAlchemy will lazy load if needed
    # We'll handle None cases gracefully

    # Grade
    if user.profile and user.profile.current_grade:
        context_parts.append(f"- {label('Класс', 'Сынып')}: {user.profile.current_grade}")

    # 2. Academic Goal
    target_uni_name = label("Не выбран", "Таңдалмаған")
    target_majors_display = label("Не выбрана", "Таңдалмаған")

    if user.profile and user.profile.target_university_id:
        uni_query = select(UniversityDetail).where(
            UniversityDetail.id == user.profile.target_university_id
        )
        uni_result = await db.execute(uni_query)
        target_uni = uni_result.scalar_one_or_none()
        if target_uni:
            target_uni_name = target_uni.full_name

    if user.profile and user.profile.target_majors:
        resolved_major_titles = await resolve_major_titles(db, user.profile.target_majors)
        # v3.80: sanitize each major title before joining. The
        # resolver returns DB-sourced titles when a code matches
        # (already trustworthy) but falls back to raw user input
        # for unresolved entries — those carry the same
        # injection risk as user.name. Sanitizer is a no-op on
        # already-clean DB strings.
        sanitized_majors = sanitize_iterable(
            _format_major_display_labels(
                resolved_major_titles or [str(item) for item in user.profile.target_majors]
            ),
            max_len=120,
        )
        if sanitized_majors:
            target_majors_display = ", ".join(sanitized_majors)

    if user.profile and user.profile.chosen_subjects:
        subjects_str = ", ".join(display_subject(s) for s in user.profile.chosen_subjects[:2])

    context_parts.append(f"- {label('Целевой университет', 'Арман ЖОО')}: {target_uni_name}")
    context_parts.append(
        f"- {label('Целевая специальность/группа программ', 'Мақсатты мамандық/бағдарлама тобы')}: "
        f"{target_majors_display}"
    )
    if user.profile and user.profile.chosen_subjects:
        context_parts.append(f"- {label('Предметы ЕНТ', 'ҰБТ пәндері')}: {subjects_str}")

    # s26 phase 7: surface the persisted quota so the agent does not
    # ask "общий конкурс / сельская / сиротская" on minimal prompts.
    # The chat router already wires this same value into
    # `active_quota_type`, which gets a separate emphatic line in the
    # system prompt; this entry just makes it visible in the human-
    # readable profile block too so the model sees consistent inputs.
    quota_value = None
    if user.profile:
        quota_value = (
            getattr(user.profile, "competition_quota", None) or ""
        ).strip().upper() or None
    if quota_value == "RURAL":
        quota_label = label("сельская квота", "ауыл квотасы")
    elif quota_value == "GENERAL":
        quota_label = label("общий конкурс", "жалпы конкурс")
    else:
        quota_label = label(
            "не указана — уточни у пользователя", "көрсетілмеген — пайдаланушыдан сұра"
        )
    context_parts.append(f"- {label('Тип квоты', 'Квота түрі')}: {quota_label}")

    # 3. Performance - Gamification Stats
    if user.gamification_profile:
        xp = user.gamification_profile.total_xp or 0
        league = (
            user.gamification_profile.league_tier.value
            if user.gamification_profile.league_tier
            else "BRONZE"
        )

        # Translate league to Russian/Kazakh
        league_translations = {
            "BRONZE": "Бронза" if language == "ru" else "Қола",
            "SILVER": "Серебро" if language == "ru" else "Күміс",
            "GOLD": "Золото" if language == "ru" else "Алтын",
            "DIAMOND": "Алмаз" if language == "ru" else "Алмас",
            "ELITE": "Элита",
        }
        league_display = league_translations.get(league, league)

        context_parts.append(
            f"- {label('Лига', 'Лига')}: {league_display}, "
            f"{label('Очки фокуса', 'Фокус ұпайы')}: {xp}"
        )
    else:
        context_parts.append(
            f"- {label('Лига', 'Лига')}: {label('Бронза', 'Қола')}, "
            f"{label('Очки фокуса', 'Фокус ұпайы')}: 0"
        )

    # 4. Recent Mock Exam Results
    latest_mock_score: int | None = None
    if user.id:
        test_query = (
            select(ActivityLog)
            .where(
                ActivityLog.user_id == user.id,
                ActivityLog.activity_type == ActivityType.TEST_COMPLETED,
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(3)
        )
        test_result = await db.execute(test_query)
        test_logs = test_result.scalars().all()

        if test_logs:
            scores = []
            for log in test_logs:
                if not await _is_representative_mock_exam_log(db, log):
                    continue
                if log.metadata_blob and isinstance(log.metadata_blob, dict):
                    score = log.metadata_blob.get("score")
                    if score is None:
                        score = log.metadata_blob.get("total_score")
                    if score is not None:
                        scores.append(int(score))

            if scores:
                latest_mock_score = scores[0]
                avg_score = sum(scores) / len(scores)
                exam_count_label = (
                    f"({len(scores)} тесттен)" if is_kz else f"(из {len(scores)} тестов)"
                )
                context_parts.append(
                    f"- {label('Последние пробные экзамены', 'Соңғы сынақ ҰБТ')}: "
                    f"{label('последний балл', 'соңғы балл')} {latest_mock_score}/140, "
                    f"{label('средний балл', 'орташа балл')} {avg_score:.0f}/140 "
                    f"{exam_count_label}"
                )
            else:
                context_parts.append(
                    f"- {label('Результаты тестов', 'Тест нәтижелері')}: "
                    f"{label('данные отсутствуют', 'дерек жоқ')}"
                )
        else:
            context_parts.append(
                f"- {label('Результаты тестов', 'Тест нәтижелері')}: "
                f"{label('тесты ещё не пройдены', 'тест әлі тапсырылмаған')}"
            )

    # 5. Onboarding profile and weak areas
    if user.profile and user.profile.chosen_subjects:
        subjects = user.profile.chosen_subjects
        if len(subjects) > 0:
            subjects_display = ", ".join(display_subject(s) for s in subjects[:2])
            context_parts.append(
                f"- {label('Профильные предметы', 'Бейіндік пәндер')}: {subjects_display}"
            )

    if user.profile and user.profile.weakest_subject:
        context_parts.append(
            f"- {label('Самый слабый предмет по профилю', 'Профиль бойынша ең әлсіз пән')}: "
            f"{display_subject(user.profile.weakest_subject)}"
        )

    if user.profile and isinstance(user.profile.last_test_results, dict):
        raw_results = user.profile.last_test_results
        normalized_results: dict[str, list[int]] = {}
        invalid_parts: list[str] = []

        for raw_subject, raw_scores in raw_results.items():
            subject = normalize_subject_name(str(raw_subject))
            if not isinstance(raw_scores, list):
                continue

            max_score = get_max_score(subject)
            clean_scores: list[int] = []
            impossible_scores: list[int] = []
            for raw_score in raw_scores[:5]:
                score = _coerce_int(raw_score)
                if score is None:
                    continue
                if 0 <= score <= max_score:
                    clean_scores.append(score)
                else:
                    impossible_scores.append(score)

            if clean_scores:
                normalized_results[subject] = clean_scores
            if impossible_scores:
                invalid_parts.append(
                    f"{display_subject(subject)}: "
                    f"{', '.join(str(score) for score in impossible_scores)} > {max_score}"
                )

        chosen_subjects = [
            normalize_subject_name(subject)
            for subject in (user.profile.chosen_subjects or [])
            if isinstance(subject, str)
        ]
        ordered_subjects = _ordered_score_subjects(
            chosen_subjects,
            [str(subject) for subject in raw_results.keys()],
        )

        result_parts: list[str] = []
        detail_parts: list[str] = []
        latest_rows: list[tuple[str, int, int, float, int]] = []

        for subject in ordered_subjects:
            scores = normalized_results.get(subject)
            if not scores:
                continue
            max_score = get_max_score(subject)
            latest_score = scores[-1]
            percent = (latest_score / max_score) * 100 if max_score else 0
            gap_to_max = max(0, max_score - latest_score)
            result_parts.append(
                f"{display_subject(subject)}: {', '.join(str(score) for score in scores)}"
            )
            detail_parts.append(
                f"{display_subject(subject)}: {latest_score}/{max_score} "
                f"({_format_percent(percent)}), "
                f"{label('до максимума', 'максимумға дейін')} {gap_to_max}"
            )
            latest_rows.append((subject, latest_score, max_score, percent, gap_to_max))

        if result_parts:
            scale_label = label(
                "История Казахстана 20; Математическая грамотность 10; "
                "Грамотность чтения 10; два профильных предмета по 50; всего 140",
                "Қазақстан тарихы 20; Математикалық сауаттылық 10; "
                "Оқу сауаттылығы 10; екі бейіндік пән 50-ден; барлығы 140",
            )
            context_parts.append(
                f"- {label('Последние результаты, введённые при регистрации', 'Тіркелу кезінде енгізілген соңғы нәтижелер')}: "
                f"{'; '.join(result_parts)}"
            )
            context_parts.append(f"- {label('Шкала ЕНТ', 'ҰБТ шкаласы')}: {scale_label}")
            context_parts.append(
                f"- {label('Нормализованные последние баллы', 'Нормаланған соңғы балдар')}: "
                f"{'; '.join(detail_parts)}"
            )

        if invalid_parts:
            context_parts.append(
                f"- {label('Исключены невозможные баллы профиля', 'Профильдегі мүмкін емес балдар есепке алынбады')}: "
                f"{'; '.join(invalid_parts)}"
            )

        required_subjects: list[str] = []
        if len(chosen_subjects) >= 2:
            required_subjects = [*get_compulsory_subjects(), *chosen_subjects[:2]]
            missing_subjects = [
                subject for subject in required_subjects if subject not in normalized_results
            ]
            if not missing_subjects:
                profile_latest_total = sum(
                    normalized_results[subject][-1] for subject in required_subjects
                )
                context_parts.append(
                    f"- {label('Сумма последних результатов профиля', 'Профильдің соңғы нәтижелер сомасы')}: "
                    f"{profile_latest_total}/{UNT_TOTAL_MAX_SCORE}; "
                    f"{label('можно добрать до максимума', 'максимумға дейін жинауға болады')} "
                    f"{UNT_TOTAL_MAX_SCORE - profile_latest_total}"
                )
            elif latest_rows:
                missing_display = ", ".join(
                    display_subject(subject) for subject in missing_subjects
                )
                context_parts.append(
                    f"- {label('Общий балл /140 не рассчитан', 'Жалпы /140 балл есептелмеді')}: "
                    f"{label('не хватает результатов по', 'нәтиже жетіспейтін пәндер')}: {missing_display}"
                )

        if latest_rows:
            strongest = max(latest_rows, key=lambda row: row[3])
            weakest_by_score = min(latest_rows, key=lambda row: row[3])
            context_parts.append(
                f"- {label('Сравнение предметов по проценту от максимума', 'Пәндерді максимум пайызымен салыстыру')}: "
                f"{label('сильнее', 'күштірек')} {display_subject(strongest[0])} "
                f"{strongest[1]}/{strongest[2]} ({_format_percent(strongest[3])}); "
                f"{label('ниже остальных', 'төменірек')} {display_subject(weakest_by_score[0])} "
                f"{weakest_by_score[1]}/{weakest_by_score[2]} ({_format_percent(weakest_by_score[3])})"
            )

    if user.id:
        try:
            score_for_gap = (
                latest_mock_score if latest_mock_score is not None else profile_latest_total
            )
            has_target_major = bool(user.profile and getattr(user.profile, "target_majors", None))
            if has_target_major:
                threshold_info = await get_user_target_threshold(user.id, db)
                grant_threshold = threshold_info.get("grant_threshold")
            else:
                threshold_info = {}
                grant_threshold = None

            if grant_threshold is not None and score_for_gap is not None:
                comparison_label, comparison_value = _build_threshold_context_metric(
                    language,
                    score_for_gap,
                    int(grant_threshold),
                )
                context_parts.append(
                    f"- {label('Целевой грантовый порог', 'Мақсатты грант шегі')}: "
                    f"{int(grant_threshold)}/140; "
                    f"{label('балл для сравнения', 'салыстыруға алынған балл')}: "
                    f"{score_for_gap}/140; "
                    f"{comparison_label}: {comparison_value}"
                )
            elif score_for_gap is not None and user.profile and user.profile.target_university_id:
                threshold_source = threshold_info.get("source")
                if threshold_source == "major_not_resolved":
                    gap_reason = label(
                        "точно не рассчитан: код/название группы программ из профиля не удалось надёжно сопоставить с базой",
                        "дәл есептелмеді: профильдегі бағдарлама тобының коды/атауы базамен сенімді сәйкестенбеді",
                    )
                    context_parts.append(
                        f"- {label('Разрыв до гранта', 'Грантқа дейінгі айырма')}: {gap_reason}"
                    )
                elif not has_target_major:
                    gap_reason = label(
                        "точно не рассчитан, потому что в профиле не выбрана специальность/группа программ",
                        "дәл есептелмеді, себебі профильде мамандық/бағдарлама тобы таңдалмаған",
                    )
                    context_parts.append(
                        f"- {label('Разрыв до гранта', 'Грантқа дейінгі айырма')}: {gap_reason}"
                    )
                elif threshold_source == "not_found":
                    gap_reason = label(
                        "точно не рассчитан: в базе пока нет надёжного порога для выбранной программы и университета",
                        "дәл есептелмеді: базада таңдалған бағдарлама мен ЖОО үшін сенімді шек әлі жоқ",
                    )
                    context_parts.append(
                        f"- {label('Разрыв до гранта', 'Грантқа дейінгі айырма')}: {gap_reason}"
                    )
        except Exception as exc:
            # Non-fatal: grant-gap is an optional context block. Logged at
            # DEBUG so retrieval regressions are at least observable; an
            # exception here would abort the whole prompt assembly.
            logger.debug("grant-gap context skipped: %s", exc)

        try:
            profile_subject_scope = []
            if user.profile and getattr(user.profile, "chosen_subjects", None):
                normalized_subjects = [
                    normalize_subject_name(subject)
                    for subject in (user.profile.chosen_subjects or [])
                    if isinstance(subject, str)
                ]
                if len(normalized_subjects) >= 2:
                    profile_subject_scope = [
                        *get_compulsory_subjects(),
                        *normalized_subjects[:2],
                    ]

            unresolved_count = await count_unresolved_mistakes(
                user.id,
                db,
                recent_days=45,
                question_types=("exam", "practice"),
                topic_tags=profile_subject_scope or None,
                recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
            )
            if not unresolved_count:
                unresolved_count = await count_unresolved_mistakes(
                    user.id,
                    db,
                    recent_days=45,
                    question_types=("exam", "practice"),
                    recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
                )
            if unresolved_count:
                top_rows = await cluster_mistakes_by_topic(
                    user.id,
                    db,
                    recent_days=45,
                    question_types=("exam", "practice"),
                    topic_tags=profile_subject_scope or None,
                    limit=3,
                    recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
                )
                if not top_rows:
                    top_rows = await cluster_mistakes_by_topic(
                        user.id,
                        db,
                        recent_days=45,
                        question_types=("exam", "practice"),
                        limit=3,
                        recent_limit=RECENT_RELEVANT_MISTAKE_LIMIT,
                    )
                top_topics = [
                    f"{display_subject(row['topic'])}: {int(row.get('mistake_count') or 0)} "
                    f"{label('ошибок', 'қате')}, {int(row.get('points_lost') or 0)} "
                    f"{label('потерянных баллов', 'жоғалған балл')}"
                    for row in top_rows
                ]
                suffix = (
                    f"; {label('топ тем', 'топ тақырыптар')}: {'; '.join(top_topics)}"
                    if top_topics
                    else ""
                )
                context_parts.append(
                    f"- {label('Актуальные нерешённые ошибки', 'Өзекті шешілмеген қателер')}: "
                    f"{unresolved_count}{suffix}"
                )
        except Exception as exc:
            # Non-fatal: unresolved-mistakes context is optional. DEBUG so a
            # mistake-clustering regression is observable without aborting
            # the prompt assembly. Same shape as the grant-gap block above.
            logger.debug("unresolved-mistakes context skipped: %s", exc)

    # 6. Quota Type (from request, but we can infer from profile if needed)
    # This will be passed separately in the system prompt

    if not context_parts:
        return ""

    context_block = "\n".join(context_parts)
    heading = label("КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ", "ПАЙДАЛАНУШЫ КОНТЕКСТІ")
    return f"""
====================================================
{heading}
====================================================
{context_block}
====================================================
"""
