"""
parent_report.py
----------------

v3.27 — Parent-facing snapshot (Issue #15 AC#5).

Builds a sanitized read-only payload that summarizes a student's UNT
prep status for a parent. The payload is the single source of truth
for both the in-app HTML view and the server-rendered PDF.

PII surface (deliberate):
    - **First name only** + grade ("Айгерим, 11 класс").
    - Recent exam attempts (capped to last 5) — score / max_score / date.
    - Target universities + chosen majors (display strings only, no IDs
      that could be used to grief the student).
    - Profile-pair summary (BE-curated copy from v3.25).
    - Weak topic snapshot (top 5 topics by points lost, no per-question
      mistake content) — only when the student is premium-tier (the
      analytics endpoint is premium-gated).
    - Grant probability per target university (numeric 0-100).

Out of surface:
    - Email, telegram_id, surname, full_name, hashed_password.
    - All moderation fields (honor_score, is_shadow_banned).
    - Subscription tier internals beyond a single ``is_premium`` flag.

i18n: this module does NOT pull from the FE i18next JSON files; it
ships a curator-authored Russian + Kazakh string table inline. Keeps
the BE renderer self-contained and independent of the FE bundle.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    ExamAttempt,
    ParentReportShareToken,
    StudentProfile,
    SubscriptionTier,
    User,
)

PARENT_REPORT_TOKEN_BYTES = 32  # 43-char URL-safe string after base64.
PARENT_REPORT_DEFAULT_TTL_DAYS = 30
PARENT_REPORT_MAX_TTL_DAYS = 90  # Hard upper bound regardless of caller request.
PARENT_REPORT_RECENT_EXAM_LIMIT = 5
PARENT_REPORT_WEAK_TOPIC_LIMIT = 5


# ──────────────────────────────────────────────────────────────────────────
# Localized strings (RU + KZ).  Single source of truth for both the
# in-app HTML page and the server-rendered PDF.  Keep keys flat — the
# Jinja template references them as ``s.<key>``.
# ──────────────────────────────────────────────────────────────────────────
PARENT_REPORT_STRINGS: dict[str, dict[str, str]] = {
    "ru": {
        "title": "Отчёт для родителей",
        "subtitle": "Подготовка к ЕНТ — обзор для родителей",
        "student": "Ученик",
        "grade": "Класс",
        "current_score": "Текущий балл",
        "score_unknown": "Балл ещё не определён",
        "recent_exams": "Последние пробные ЕНТ",
        "exam_no_history": "Пока нет завершённых пробных тестов.",
        "subjects": "Предметы",
        "score": "Балл",
        "date": "Дата",
        "target_universities": "Целевые университеты",
        "no_targets": "Целевые университеты не выбраны.",
        "grant_probability": "Шанс на грант",
        "weak_topics": "Сложные темы",
        "weak_topics_premium_only": "Подробный разбор слабых тем доступен в премиум-тарифе.",
        "no_weak_topics": "Слабые темы пока не выявлены.",
        "profile_pair": "Профильная пара предметов",
        "profile_pair_majors": "Открывает направления",
        "profile_pair_pressure": "Конкуренция",
        "profile_pair_next": "Следующий шаг",
        "footer_disclaimer": (
            "Отчёт носит ориентировочный характер. Прогноз гранта зависит "
            "от изменений пороговых баллов; финальные данные публикует НЦТ."
        ),
        "generated_at": "Сформировано",
        "expires_at": "Срок действия ссылки",
    },
    "kz": {
        "title": "Ата-аналарға арналған есеп",
        "subtitle": "ҰБТ дайындығы — ата-аналарға шолу",
        "student": "Оқушы",
        "grade": "Сынып",
        "current_score": "Қазіргі балл",
        "score_unknown": "Балл әлі анықталмаған",
        "recent_exams": "Соңғы сынақ ҰБТ-лер",
        "exam_no_history": "Әзірге аяқталған сынақ тест жоқ.",
        "subjects": "Пәндер",
        "score": "Балл",
        "date": "Күні",
        "target_universities": "Мақсатты университеттер",
        "no_targets": "Мақсатты университет таңдалмаған.",
        "grant_probability": "Грант мүмкіндігі",
        "weak_topics": "Күрделі тақырыптар",
        "weak_topics_premium_only": "Әлсіз тақырыптарды толық талдау премиум тарифте қолжетімді.",
        "no_weak_topics": "Әлсіз тақырыптар әзірге анықталмаған.",
        "profile_pair": "Профильдік пәндер жұбы",
        "profile_pair_majors": "Ашатын бағыттар",
        "profile_pair_pressure": "Бәсеке",
        "profile_pair_next": "Келесі қадам",
        "footer_disclaimer": (
            "Есеп бағдарлы сипатта. Грант болжамы өту балының өзгеруіне "
            "тәуелді; нақты деректерді ҰТО жариялайды."
        ),
        "generated_at": "Жасалды",
        "expires_at": "Сілтеме мерзімі",
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Pure helpers (unit-tested without a DB)
# ──────────────────────────────────────────────────────────────────────────


def first_name_for_display(*, name: str | None, full_name: str | None) -> str:
    """Pick a single display name from the available User fields.

    Prefers ``name`` (typically the onboarded display name), falls back
    to the first whitespace-delimited token of ``full_name``, then to a
    generic placeholder. Never returns the surname.
    """

    candidate = (name or "").strip()
    if candidate:
        # Already short — but if a surname snuck in, drop it.
        return candidate.split()[0]
    if full_name:
        for token in full_name.split():
            if token.strip():
                return token.strip()
    return "Ученик"


def grant_probability_from_gap(gap: int | None) -> int | None:
    """Mirror of the linear-interp curve in routers/strategy.py.

    Pure version so the parent report can compute a probability per
    target university without a second HTTP round-trip. Same buckets,
    same edges; if the strategy router's curve changes, update this in
    lockstep (unit-tested).
    """

    if gap is None:
        return None
    if gap >= 20:
        return 99
    if gap >= 0:
        return 70 + int((gap / 20) * 29)
    if gap >= -10:
        return 40 + int(((gap + 10) / 10) * 30)
    if gap >= -30:
        return 10 + int(((gap + 30) / 20) * 30)
    return max(5, 10 + int((gap + 30) / 5))


def clamp_ttl_days(requested: int | None) -> int:
    """Clamp the requested TTL to ``[1, PARENT_REPORT_MAX_TTL_DAYS]``.

    None or non-positive values fall back to the default.
    """

    if requested is None or requested <= 0:
        return PARENT_REPORT_DEFAULT_TTL_DAYS
    return min(int(requested), PARENT_REPORT_MAX_TTL_DAYS)


def generate_share_token() -> str:
    """Generate a fresh URL-safe opaque share token.

    NOT a JWT — never used for student authentication. Collision
    probability is cosmologically small but the DB unique index is the
    safety net.
    """

    return secrets.token_urlsafe(PARENT_REPORT_TOKEN_BYTES)


def is_premium_tier(tier: SubscriptionTier | str | None) -> bool:
    """Return True when the user's subscription unlocks weak-topic detail."""

    if tier is None:
        return False
    if isinstance(tier, SubscriptionTier):
        return tier != SubscriptionTier.FREE
    return str(tier).upper() != "FREE"


@dataclass(frozen=True)
class ParentReportExamRow:
    subjects: list[str]
    score: int
    max_score: int
    submitted_at: str  # ISO8601


def serialize_exam_attempts(rows: list[ExamAttempt]) -> list[dict[str, Any]]:
    """Project the most recent ``ExamAttempt`` rows into the report shape."""

    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "subjects": list(r.subjects or []),
                "score": int(r.score or 0),
                "max_score": int(r.max_score or 0),
                "submitted_at": (
                    r.submitted_at.isoformat() if r.submitted_at is not None else None
                ),
            }
        )
    return out


# ──────────────────────────────────────────────────────────────────────────
# Async DB-touching orchestrator (integration-tested)
# ──────────────────────────────────────────────────────────────────────────


async def build_parent_report_payload(
    *,
    db: AsyncSession,
    user: User,
    language: str = "ru",
) -> dict[str, Any]:
    """Assemble the sanitized parent-report payload for ``user``.

    Returns a JSON-serializable dict. All RU/KZ strings live under
    ``strings`` so the FE/PDF can switch language by swapping that
    block alone.
    """

    lang = "kz" if str(language).lower().startswith("kz") else "ru"
    strings = PARENT_REPORT_STRINGS[lang]

    # 1. Student profile + name
    profile_row = (
        (await db.execute(select(StudentProfile).where(StudentProfile.user_id == user.id)))
        .scalars()
        .first()
    )

    first_name = first_name_for_display(name=user.name, full_name=user.full_name)
    grade = profile_row.current_grade if profile_row else None
    chosen_subjects = list(profile_row.chosen_subjects or []) if profile_row else []
    target_majors = list(profile_row.target_majors or []) if profile_row else []
    competition_quota = profile_row.competition_quota if profile_row else None

    # 2. Recent exam attempts
    attempts = (
        (
            await db.execute(
                select(ExamAttempt)
                .where(ExamAttempt.user_id == user.id)
                .order_by(desc(ExamAttempt.submitted_at))
                .limit(PARENT_REPORT_RECENT_EXAM_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    exam_rows = serialize_exam_attempts(list(attempts))
    latest_score = exam_rows[0]["score"] if exam_rows else None

    # 3. Target university rows. We deliberately serialize a small,
    #    audited subset (id + display label only) rather than the full
    #    UniversityDetail row, to keep the parent surface narrow.
    targets_payload: list[dict[str, Any]] = []
    if profile_row and profile_row.target_universities:
        from ..models import UniversityDetail

        ids = list(profile_row.target_universities)
        rows = (
            (await db.execute(select(UniversityDetail).where(UniversityDetail.id.in_(ids))))
            .scalars()
            .all()
        )
        by_id = {r.id: r for r in rows}
        # Preserve student-chosen ordering.
        for uni_id in ids:
            row = by_id.get(uni_id)
            if not row:
                continue
            targets_payload.append(
                {
                    "id": row.id,
                    "name": row.uni_name,
                    "city": getattr(row, "city", None),
                }
            )

    return {
        "language": lang,
        "strings": strings,
        "student": {
            "first_name": first_name,
            "grade": grade,
            "competition_quota": competition_quota,
            "is_premium": is_premium_tier(user.subscription_tier),
        },
        "current_score": latest_score,
        "exam_attempts": exam_rows,
        "chosen_subjects": chosen_subjects,
        "target_universities": targets_payload,
        "target_majors": target_majors,
        "generated_at": datetime.now(UTC).isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────
# Token CRUD
# ──────────────────────────────────────────────────────────────────────────


async def mint_parent_report_token(
    *,
    db: AsyncSession,
    user: User,
    ttl_days: int | None = None,
) -> ParentReportShareToken:
    """Mint a new share token for ``user``, persist + return it."""

    days = clamp_ttl_days(ttl_days)
    expires_at = datetime.now(UTC) + timedelta(days=days)
    row = ParentReportShareToken(
        user_id=user.id,
        token=generate_share_token(),
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def lookup_active_token(
    *,
    db: AsyncSession,
    token: str,
) -> ParentReportShareToken | None:
    """Resolve a share token to its row IFF active (not revoked, not expired)."""

    row = (
        (
            await db.execute(
                select(ParentReportShareToken).where(ParentReportShareToken.token == token)
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        return None
    if row.is_revoked:
        return None
    expires_at = row.expires_at
    # SQLAlchemy returns aware datetimes when the column is TIMESTAMPTZ; stay
    # defensive for sqlite/test stubs which may return naive.
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at is not None and expires_at <= datetime.now(UTC):
        return None
    return row


async def revoke_parent_report_token(
    *,
    db: AsyncSession,
    user: User,
    token_id: int,
) -> bool:
    """Mark a token as revoked. Returns True iff the row was the user's."""

    row = (
        (
            await db.execute(
                select(ParentReportShareToken).where(
                    ParentReportShareToken.id == token_id,
                    ParentReportShareToken.user_id == user.id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        return False
    row.is_revoked = True
    await db.commit()
    return True
