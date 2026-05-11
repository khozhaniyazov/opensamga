"""Phase C (s22, 2026-04-22): shape raw tool-executor results into
frontend-ready `ToolResult` parts.

The frontend (see `frontend/src/app/components/dashboard/chat/tool_cards/types.ts`)
expects `parts` entries of the form:

    { "kind": "tool_call", "tool": "<name>", "args": {...}, "result": {"tool": "...", "data": {...}} }

where `tool` ∈ {grant_chance | compare_universities | historical_thresholds |
recommend_universities}. This module owns the mapping from our
internal `tool_executor.execute_tool` JSON outputs to that shape.

Design rules:
  * Always total — every shaper returns either a valid dict or None.
    Never raises (caller wraps in try/except as a belt-and-suspenders
    measure, but the shapers themselves must be defensive).
  * Zero DB access. Operates purely on the (args, raw_response_text)
    the caller already has in hand.
  * Unknown tool / non-JSON / wrong-shape → None (caller drops it).
  * Stable field names even if the backend JSON shape drifts — e.g.
    Russian-keyed `check_grant_chance` output is translated.
"""

from __future__ import annotations

import json
import re
from typing import Any

# ---- helpers --------------------------------------------------------


def _safe_json(raw: str) -> Any:
    """Parse JSON; return None on any failure."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s or not (s.startswith("{") or s.startswith("[")):
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, ValueError):
        return None


# Cyrillic-to-probability bucket mapping. The raw check_grant_chance
# response is Russian-keyed for the LLM; we translate it for the FE.
_RU_BUCKET_TO_PROB = {
    "безопасный": 0.92,
    "рискованный": 0.58,
    "опасный": 0.18,
}


def _extract_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---- shapers --------------------------------------------------------


def _shape_grant_chance(args: dict, raw: str) -> dict | None:
    """Map check_grant_chance output → GrantChanceData.

    The underlying payload is Russian-keyed + lacks `threshold` in the
    body (it's embedded in the Russian `сообщение` string like "Ваш
    балл (135) значительно выше порога (120)"). We parse both.
    """
    payload = _safe_json(raw)
    if not isinstance(payload, dict):
        return None
    score = _extract_int(args.get("score"))
    if score is None:
        return None
    uni = args.get("uni_name")
    if not isinstance(uni, str) or not uni.strip():
        return None

    bucket = str(payload.get("статус", "")).strip().lower()
    probability = _RU_BUCKET_TO_PROB.get(bucket)

    # Parse "порога (NNN)" / "порогу (NNN)" out of the сообщение to
    # recover the threshold. Both genitive and dative forms appear in
    # the upstream heuristic messages.
    message = str(payload.get("сообщение", ""))
    threshold: int | None = None
    m = re.search(r"порог[ауе]\s*\((\d+)\)", message)
    if m:
        try:
            threshold = int(m.group(1))
        except ValueError:
            threshold = None
    if threshold is None:
        return None  # card is useless without a threshold — drop the part

    quota = args.get("quota_type") or "GENERAL"
    if quota not in {"GENERAL", "RURAL", "ORPHAN"}:
        quota = None

    data = {
        "score": score,
        "university": uni.strip(),
        "major_code": args.get("major_code"),
        "major": None,
        "threshold": threshold,
        "probability": probability,
        "quota_type": quota,
    }
    return {"tool": "grant_chance", "data": data}


def _shape_historical(args: dict, raw: str) -> dict | None:
    """Map get_historical_data (list of rows) → HistoricalThresholdData."""
    payload = _safe_json(raw)
    if not isinstance(payload, list) or not payload:
        return None
    uni = args.get("uni_name") or ""
    points = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        yr = _extract_int(row.get("year"))
        thr = _extract_int(row.get("min_score"))
        if yr is None or thr is None:
            continue
        points.append({"year": yr, "threshold": thr})
    if not points:
        return None
    points.sort(key=lambda p: p["year"])
    data = {
        "university": str(uni).strip() or str(payload[0].get("uni_name", "")),
        "major_code": args.get("major_code"),
        "major": None,
        "points": points,
        "user_score": None,
    }
    return {"tool": "historical_thresholds", "data": data}


def _shape_recommend(args: dict, raw: str) -> dict | None:
    """Map recommend_universities (list) → RecommendationListData."""
    payload = _safe_json(raw)
    if not isinstance(payload, list) or not payload:
        return None
    score = _extract_int(args.get("score"))
    if score is None:
        return None
    quota = args.get("quota_type") or "GENERAL"
    if quota not in {"GENERAL", "RURAL", "ORPHAN"}:
        quota = "GENERAL"
    items = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        thr = _extract_int(row.get("threshold"))
        if thr is None:
            continue
        items.append(
            {
                "university": str(row.get("uni_name", "")).strip() or "—",
                "threshold": thr,
                "major_code": row.get("major_code"),
                "major": row.get("major"),
                "city": None,
                "probability": None,
            }
        )
    if not items:
        return None
    return {
        "tool": "recommend_universities",
        "data": {"score": score, "quota_type": quota, "items": items},
    }


def _shape_compare(args: dict, raw: str) -> dict | None:
    """Map compare_universities output → UniComparisonData."""
    payload = _safe_json(raw)
    if not isinstance(payload, list) or not payload:
        return None
    rows = []
    for row in payload[:3]:  # FE caps at 3 per design
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "name": str(row.get("uni_name") or row.get("name") or "").strip() or "—",
                "founding_year": _extract_int(row.get("founding_year")),
                "total_students": _extract_int(row.get("total_students")),
                "has_dorm": row.get("has_dorm"),
                "military_chair": row.get("military_chair") or row.get("has_military_chair"),
                "website": row.get("website"),
                "city": row.get("city"),
            }
        )
    rows = [r for r in rows if r["name"] != "—"]
    if not rows:
        return None
    return {"tool": "compare_universities", "data": {"unis": rows}}


# =====================================================================
# Memory-tool shapers (s24, agent harness)
# =====================================================================
# These shape the JSON returned by app/services/chat/memory_tools.py
# into FE-friendly cards. The FE renders them as tool_card variants
# (see ToolResultCard.tsx) — for now they go through as `kind:"tool_call"`
# with `result.tool` set to a memory-tool-specific discriminator the FE
# can switch on.


def _shape_user_profile(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    profile = payload.get("profile") or {}
    user = payload.get("user") or {}
    return {
        "tool": "user_profile",
        "data": {
            "name": user.get("name"),
            "current_grade": profile.get("current_grade"),
            "chosen_subjects": profile.get("chosen_subjects") or [],
            "target_majors": profile.get("target_majors") or [],
            "target_universities": profile.get("target_universities") or [],
            "subscription_tier": user.get("subscription_tier"),
        },
    }


def _shape_recent_mistakes(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    rows = payload.get("mistakes") or []
    if not rows:
        return None
    items = []
    for r in rows[:10]:
        items.append(
            {
                "id": r.get("id"),
                "subject": r.get("subject"),
                "topic_tag": r.get("topic_tag"),
                "user_answer": r.get("user_answer"),
                "correct_answer": r.get("correct_answer"),
                "diagnosis": (r.get("ai_diagnosis") or "")[:240],
                "is_resolved": bool(r.get("is_resolved")),
            }
        )
    return {
        "tool": "recent_mistakes",
        "data": {"count": payload.get("count") or len(items), "items": items},
    }


def _shape_recent_test_attempts(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    rows = payload.get("attempts") or []
    if not rows:
        return None
    return {
        "tool": "recent_test_attempts",
        "data": {
            "count": payload.get("count") or len(rows),
            "attempts": [
                {
                    "id": r.get("id"),
                    "subjects": r.get("subjects") or [],
                    "score": r.get("score"),
                    "max_score": r.get("max_score"),
                    "percent": r.get("percent"),
                    "submitted_at": r.get("submitted_at"),
                }
                for r in rows[:8]
            ],
        },
    }


def _shape_practice_summary(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    weakest = payload.get("weakest_subjects") or []
    by_subject = payload.get("by_subject") or {}
    if not weakest and not by_subject:
        return None
    return {
        "tool": "practice_summary",
        "data": {
            "window_days": payload.get("window_days"),
            "session_count": payload.get("session_count") or 0,
            "weakest": [
                {
                    "subject": w.get("subject"),
                    "accuracy_pct": w.get("accuracy_pct"),
                    "sessions": w.get("sessions"),
                    "answered": w.get("answered"),
                }
                for w in weakest[:5]
            ],
        },
    }


def _shape_dream_uni_progress(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    rows = payload.get("rows") or []
    if not rows and payload.get("current_score") is None:
        return None
    return {
        "tool": "dream_university_progress",
        "data": {
            "quota_type": payload.get("quota_type") or "GENERAL",
            "current_score": payload.get("current_score"),
            "target_majors": payload.get("target_majors") or [],
            "target_universities": payload.get("target_universities") or [],
            "rows": [
                {
                    "uni_name": r.get("uni_name"),
                    "major_code": r.get("major_code"),
                    "year": r.get("year"),
                    "threshold": r.get("threshold"),
                    "your_score": r.get("your_score"),
                    "gap": r.get("gap"),
                }
                for r in rows[:15]
            ],
        },
    }


def _shape_chat_summary(args: dict, raw: str) -> dict | None:
    payload = _safe_json(raw)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    threads = payload.get("threads") or []
    if not threads:
        return None
    return {
        "tool": "chat_summary",
        "data": {
            "count": payload.get("count") or len(threads),
            "threads": [
                {
                    "thread_id": t.get("thread_id"),
                    "title": t.get("title"),
                    "updated_at": t.get("updated_at"),
                    "last_user_preview": t.get("last_user_preview"),
                }
                for t in threads[:10]
            ],
        },
    }


_SHAPERS = {
    "check_grant_chance": _shape_grant_chance,
    "get_historical_data": _shape_historical,
    "recommend_universities": _shape_recommend,
    "compare_universities": _shape_compare,
    # s24 memory-tool shapers
    "get_user_profile": _shape_user_profile,
    "get_recent_mistakes": _shape_recent_mistakes,
    "get_recent_test_attempts": _shape_recent_test_attempts,
    "get_practice_summary": _shape_practice_summary,
    "get_dream_university_progress": _shape_dream_uni_progress,
    "get_chat_summary": _shape_chat_summary,
}


def shape_tool_part(
    function_name: str,
    function_args: dict,
    tool_response_content: str,
) -> dict | None:
    """Build a single `MessagePart` dict, or None if the tool isn't
    one of the four we know how to render — or the response JSON is
    the wrong shape / empty.

    Returned dict shape (on success):
        {
            "kind": "tool_call",
            "tool": <function_name>,                # raw tool name
            "args": <function_args>,                # echoed back to FE
            "result": {"tool": <fe_tool>, "data": {...}},  # FE contract
        }
    """
    shaper = _SHAPERS.get(function_name)
    if shaper is None:
        return None
    try:
        result = shaper(function_args or {}, tool_response_content or "")
    except Exception:
        return None
    if result is None:
        return None
    return {
        "kind": "tool_call",
        "tool": function_name,
        "args": function_args or {},
        "result": result,
    }
