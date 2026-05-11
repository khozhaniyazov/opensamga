"""
Agent harness (s24): "memory" tools that surface existing per-user
data into the chat loop.

Design rule: the agent's *memory* is what it can fetch. There is no
new persistence layer here — every tool reads tables that already
exist. The model decides when to call them.

These tools are exposed to the agent loop only when CHAT_AGENT_LOOP
is True. The legacy two-call dispatcher does not import this module.

Coverage today:
  - get_user_profile         → StudentProfile + User basics
  - get_recent_mistakes      → MistakeReview, optionally subject-filtered
  - get_recent_test_attempts → ExamAttempt, scored summaries
  - get_practice_summary     → PracticeSession aggregates

Each tool returns a JSON-serialisable dict. The agent loop wraps it
into a `tool` message back to the model. Errors never raise; we
return a {"error": "..."} payload so the model can recover.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import (
    ChatMessage as ChatMessageModel,
)
from app.models import (
    ChatThread,
    ExamAttempt,
    HistoricalGrantThreshold,
    MistakeReview,
    PracticeSession,
    StudentProfile,
    UniversityData,
    User,
)

logger = logging.getLogger(__name__)


# === Tool schemas (OpenAI tool-calling format) ===========================

MEMORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_user_profile",
            "description": (
                "Fetch the current authenticated student's saved profile: "
                "current grade, target majors, target universities, chosen "
                "UNT/ENT subjects. Call this when the user asks about *their* "
                "plan, progress, or fit for a university — do NOT guess."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_mistakes",
            "description": (
                "List the student's most recent unresolved mistakes from "
                "practice/exam/chat. Each mistake includes subject, topic_tag, "
                "user_answer, correct_answer, and ai_diagnosis. Call when the "
                "user asks 'what should I work on?', 'where am I weak?', or "
                "wants to drill specific gaps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {
                        "type": "string",
                        "description": "Optional subject filter (e.g. 'Mathematics', 'Physics').",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max rows to return (default 10, hard cap 25).",
                    },
                    "only_unresolved": {
                        "type": "boolean",
                        "description": "If true (default), skip mistakes the student has marked as resolved.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_test_attempts",
            "description": (
                "List the student's most recent mock-exam attempts with "
                "score/max_score, subjects, and submitted_at. Call when the "
                "user asks 'how am I doing on practice exams?' or for "
                "trend-vs-target reasoning."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max attempts to return (default 5, hard cap 15).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_practice_summary",
            "description": (
                "Summarise the student's recent practice activity: total "
                "sessions, total questions answered, accuracy by subject, "
                "weakest subjects (lowest accuracy)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Look-back window in days (default 30, hard cap 90).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dream_university_progress",
            "description": (
                "Compare the student's current best score against the "
                "historical grant thresholds of every university listed in "
                "their profile's target_universities. Returns one row per "
                "(uni, major) with gap_to_threshold (positive = above) and "
                "the year the threshold is from. Use when the user asks "
                "'do I have a chance?', 'how far am I from my dream uni?', "
                "or 'compare minimum scores vs my scores'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "score_override": {
                        "type": "integer",
                        "description": (
                            "Optional explicit score (140-pt scale) to compare "
                            "against. Defaults to the student's best ExamAttempt "
                            "in the last 90 days."
                        ),
                    },
                    "quota_type": {
                        "type": "string",
                        "enum": ["GENERAL", "RURAL", "ORPHAN"],
                        "description": "Quota track. Defaults to GENERAL.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chat_summary",
            "description": (
                "List the student's most recent chat threads with title, "
                "last activity time, and a one-line preview of the last "
                "user message. Use when the user asks 'what did we discuss "
                "last time?' or 'continue from yesterday'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max threads to return (default 5, hard cap 15).",
                    },
                },
                "required": [],
            },
        },
    },
]


# === Implementations =====================================================


async def _exec_get_user_profile(db: AsyncSession, user_id: int | None) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no profile available."}
    result = await db.execute(select(StudentProfile).where(StudentProfile.user_id == user_id))
    profile = result.scalar_one_or_none()
    user_row = await db.execute(select(User).where(User.id == user_id))
    user = user_row.scalar_one_or_none()
    if profile is None and user is None:
        return {"error": "No profile rows for this user."}
    # s26 phase 7: surface target_university_id, weakest_subject, and
    # competition_quota so the agent has every input check_grant_chance
    # needs and stops asking "по какой квоте?". Also pull a human-
    # readable target university name when present so the agent can
    # cite it back to the user without an extra tool round-trip.
    target_uni_name: str | None = None
    if profile is not None and profile.target_university_id:
        from app.models import UniversityDetail  # local import — avoids cycle on cold start

        try:
            uni_row = await db.execute(
                select(UniversityDetail).where(UniversityDetail.id == profile.target_university_id)
            )
            uni_obj = uni_row.scalar_one_or_none()
            if uni_obj is not None:
                target_uni_name = getattr(uni_obj, "full_name", None) or getattr(
                    uni_obj, "name", None
                )
        except Exception:
            # Non-fatal — the agent can still call get_university_data.
            target_uni_name = None
    return {
        "user": {
            "name": getattr(user, "name", None) if user else None,
            "email": getattr(user, "email", None) if user else None,
            "subscription_tier": (
                getattr(user, "subscription_tier", None).value
                if user and getattr(user, "subscription_tier", None) is not None
                else None
            ),
        },
        "profile": (
            {
                "current_grade": profile.current_grade,
                "chosen_subjects": list(profile.chosen_subjects or []),
                "target_majors": list(profile.target_majors or []),
                "target_universities": list(profile.target_universities or []),
                "target_university_id": profile.target_university_id,
                "target_university_name": target_uni_name,
                "weakest_subject": profile.weakest_subject,
                "competition_quota": ((profile.competition_quota or "").strip().upper() or None),
                # Mirror the chat-router rule for at-a-glance reads.
                "ready_for_grant_chance": bool(
                    profile.target_university_id
                    and (list(profile.target_majors or []))
                    and ((profile.competition_quota or "").strip().upper() in {"GENERAL", "RURAL"})
                ),
            }
            if profile
            else None
        ),
    }


async def _exec_get_recent_mistakes(
    db: AsyncSession, user_id: int | None, args: dict[str, Any]
) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no mistake history available."}
    subject = args.get("subject")
    limit = max(1, min(int(args.get("limit") or 10), 25))
    only_unresolved = bool(args.get("only_unresolved", True))

    stmt = (
        select(MistakeReview)
        .where(MistakeReview.user_id == user_id)
        .order_by(desc(MistakeReview.id))
        .limit(limit)
    )
    if only_unresolved:
        stmt = stmt.where(MistakeReview.is_resolved.is_(False))
    rows = (await db.execute(stmt)).scalars().all()

    out = []
    for r in rows:
        snap = r.original_question_snapshot or {}
        row_subject = snap.get("subject") if isinstance(snap, dict) else None
        if subject and row_subject and subject.lower() not in str(row_subject).lower():
            continue
        out.append(
            {
                "id": r.id,
                "subject": row_subject,
                "topic_tag": r.topic_tag,
                "question_type": r.question_type,
                "user_answer": r.user_answer,
                "correct_answer": r.correct_answer,
                "ai_diagnosis": (r.ai_diagnosis or "")[:600],
                "is_resolved": bool(r.is_resolved),
            }
        )
    return {"count": len(out), "mistakes": out}


async def _exec_get_recent_test_attempts(
    db: AsyncSession, user_id: int | None, args: dict[str, Any]
) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no exam history available."}
    limit = max(1, min(int(args.get("limit") or 5), 15))
    rows = (
        (
            await db.execute(
                select(ExamAttempt)
                .where(ExamAttempt.user_id == user_id)
                .order_by(desc(ExamAttempt.submitted_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return {
        "count": len(rows),
        "attempts": [
            {
                "id": r.id,
                "subjects": list(r.subjects or []),
                "score": r.score,
                "max_score": r.max_score,
                "percent": (round(100.0 * r.score / r.max_score, 1) if r.max_score else None),
                "submitted_at": (r.submitted_at.isoformat() if r.submitted_at else None),
                "time_taken_seconds": r.time_taken_seconds,
            }
            for r in rows
        ],
    }


async def _exec_get_practice_summary(
    db: AsyncSession, user_id: int | None, args: dict[str, Any]
) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no practice history available."}
    days = max(1, min(int(args.get("days") or 30), 90))
    # PracticeSession columns vary by deployment; we reach defensively.
    rows = (
        (
            await db.execute(
                select(PracticeSession)
                .where(PracticeSession.user_id == user_id)
                .order_by(desc(PracticeSession.id))
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    sessions = []
    by_subject: dict[str, dict[str, int]] = {}
    for s in rows:
        subj = getattr(s, "subject", None) or "unknown"
        correct = int(getattr(s, "correct_count", 0) or 0)
        total = int(getattr(s, "total_count", None) or getattr(s, "question_count", 0) or 0)
        bucket = by_subject.setdefault(subj, {"correct": 0, "total": 0, "sessions": 0})
        bucket["correct"] += correct
        bucket["total"] += total
        bucket["sessions"] += 1
        sessions.append({"subject": subj, "correct": correct, "total": total})
    weakest = sorted(
        [
            {
                "subject": subj,
                "accuracy_pct": round(100.0 * b["correct"] / b["total"], 1) if b["total"] else None,
                "sessions": b["sessions"],
                "answered": b["total"],
            }
            for subj, b in by_subject.items()
            if b["total"] >= 5
        ],
        key=lambda r: r["accuracy_pct"] or 100.0,
    )[:5]
    return {
        "window_days": days,
        "session_count": len(sessions),
        "by_subject": by_subject,
        "weakest_subjects": weakest,
    }


async def _exec_get_dream_university_progress(
    db: AsyncSession, user_id: int | None, args: dict[str, Any]
) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no profile available."}

    quota_type = (args.get("quota_type") or "GENERAL").upper()
    score_override = args.get("score_override")

    # Pull the profile to learn target unis + majors.
    profile = (
        await db.execute(select(StudentProfile).where(StudentProfile.user_id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        return {"error": "No profile rows for this user — cannot resolve dream uni."}
    target_uni_ids = list(profile.target_universities or [])
    target_majors = list(profile.target_majors or [])
    if not target_uni_ids and not target_majors:
        return {
            "error": (
                "Profile has no target_universities or target_majors set yet. "
                "Ask the student to fill in their dream universities first."
            ),
            "current_score": None,
            "rows": [],
        }

    # Determine which score we're comparing against.
    current_score: int | None
    if score_override is not None:
        try:
            current_score = int(score_override)
        except (TypeError, ValueError):
            current_score = None
    else:
        attempt_row = (
            await db.execute(
                select(ExamAttempt)
                .where(ExamAttempt.user_id == user_id)
                .order_by(desc(ExamAttempt.score))
                .limit(1)
            )
        ).scalar_one_or_none()
        current_score = attempt_row.score if attempt_row else None

    # Resolve target uni names from UniversityData (IDs in the array column
    # are UniversityData.id; uni_name is the string the threshold table uses).
    uni_names: list[str] = []
    if target_uni_ids:
        ud_rows = (
            await db.execute(
                select(UniversityData.uni_name)
                .where(UniversityData.id.in_(target_uni_ids))
                .distinct()
            )
        ).all()
        uni_names = sorted({r[0] for r in ud_rows if r[0]})

    rows: list[dict[str, Any]] = []
    if uni_names or target_majors:
        # For each (uni, major) pair, take the most recent threshold row
        # matching the requested quota_type. We do one ORM query per uni
        # to keep the SQL simple and bounded (target lists are tiny).
        seen: set[tuple[str, str]] = set()
        for uni in uni_names or [None]:
            stmt = select(HistoricalGrantThreshold).where(
                HistoricalGrantThreshold.quota_type == quota_type
            )
            if uni:
                stmt = stmt.where(HistoricalGrantThreshold.uni_name.ilike(f"%{uni}%"))
            if target_majors:
                stmt = stmt.where(
                    or_(
                        *[
                            HistoricalGrantThreshold.major_code.ilike(f"%{m}%")
                            for m in target_majors
                        ]
                    )
                )
            stmt = stmt.order_by(desc(HistoricalGrantThreshold.data_year)).limit(20)
            for t in (await db.execute(stmt)).scalars().all():
                key = (t.uni_name or "", t.major_code or "")
                if key in seen:
                    continue
                seen.add(key)
                threshold = t.min_score
                rows.append(
                    {
                        "uni_name": t.uni_name,
                        "major_code": t.major_code,
                        "year": t.data_year,
                        "quota_type": t.quota_type,
                        "threshold": threshold,
                        "your_score": current_score,
                        "gap": (
                            current_score - threshold
                            if (current_score is not None and threshold is not None)
                            else None
                        ),
                    }
                )

    rows.sort(
        key=lambda r: ((r["gap"] if r["gap"] is not None else -10_000), r["uni_name"] or ""),
        reverse=True,
    )
    return {
        "quota_type": quota_type,
        "current_score": current_score,
        "target_majors": target_majors,
        "target_universities": uni_names,
        "row_count": len(rows),
        "rows": rows[:25],
    }


async def _exec_get_chat_summary(
    db: AsyncSession, user_id: int | None, args: dict[str, Any]
) -> dict[str, Any]:
    if not user_id:
        return {"error": "Not authenticated — no chat history available."}
    limit = max(1, min(int(args.get("limit") or 5), 15))

    threads = (
        (
            await db.execute(
                select(ChatThread)
                .where(ChatThread.user_id == user_id)
                .order_by(desc(ChatThread.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    out: list[dict[str, Any]] = []
    for t in threads:
        last_user = (
            await db.execute(
                select(ChatMessageModel)
                .where(
                    ChatMessageModel.thread_id == t.id,
                    ChatMessageModel.user_id == user_id,
                    ChatMessageModel.role == "user",
                )
                .order_by(desc(ChatMessageModel.created_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        preview = ((last_user.content if last_user else "") or "").strip()
        if len(preview) > 140:
            preview = preview[:137] + "…"
        out.append(
            {
                "thread_id": t.id,
                "title": t.title,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "last_user_preview": preview,
            }
        )
    return {"count": len(out), "threads": out}


# === Public dispatcher ===================================================


MEMORY_TOOL_NAMES = {t["function"]["name"] for t in MEMORY_TOOLS}


async def execute_memory_tool(
    function_name: str,
    function_args: dict,
    db: AsyncSession,
    user_id: int | None,
) -> str:
    """Run a memory tool, return JSON string. Never raises."""
    try:
        if function_name == "get_user_profile":
            payload = await _exec_get_user_profile(db, user_id)
        elif function_name == "get_recent_mistakes":
            payload = await _exec_get_recent_mistakes(db, user_id, function_args or {})
        elif function_name == "get_recent_test_attempts":
            payload = await _exec_get_recent_test_attempts(db, user_id, function_args or {})
        elif function_name == "get_practice_summary":
            payload = await _exec_get_practice_summary(db, user_id, function_args or {})
        elif function_name == "get_dream_university_progress":
            payload = await _exec_get_dream_university_progress(db, user_id, function_args or {})
        elif function_name == "get_chat_summary":
            payload = await _exec_get_chat_summary(db, user_id, function_args or {})
        else:
            payload = {"error": f"Unknown memory tool: {function_name}"}
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("memory tool %s failed", function_name)
        payload = {"error": f"{type(exc).__name__}: {exc}"}
    return json.dumps(payload, ensure_ascii=False, default=str)


__all__ = ["MEMORY_TOOLS", "MEMORY_TOOL_NAMES", "execute_memory_tool"]
