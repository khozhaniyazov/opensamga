from __future__ import annotations

from datetime import UTC, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import PracticeSession
from app.services.gap_analyzer import get_recent_practice_summary


def _scalars_all_result(values):
    result = MagicMock()
    scalars = MagicMock()
    scalars.all.return_value = values
    result.scalars.return_value = scalars
    return result


@pytest.mark.asyncio
async def test_get_recent_practice_summary_returns_latest_snapshot_and_trends():
    now = datetime.now(UTC)
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalars_all_result(
            [
                PracticeSession(
                    id=3,
                    user_id=1,
                    subject="Informatics",
                    target_questions=10,
                    generated_questions_count=1,
                    answered_questions_count=1,
                    correct_answers_count=0,
                    started_at=now,
                    updated_at=now,
                ),
                PracticeSession(
                    id=2,
                    user_id=1,
                    subject="Mathematics",
                    target_questions=10,
                    generated_questions_count=3,
                    answered_questions_count=3,
                    correct_answers_count=1,
                    started_at=now,
                    updated_at=now,
                ),
                PracticeSession(
                    id=1,
                    user_id=1,
                    subject="Mathematics",
                    target_questions=10,
                    generated_questions_count=2,
                    answered_questions_count=2,
                    correct_answers_count=2,
                    started_at=now,
                    updated_at=now,
                ),
            ]
        )
    )

    summary = await get_recent_practice_summary(1, db)

    assert summary["latest_practice"]["session_id"] == 3
    assert summary["latest_practice"]["subject"] == "Informatics"
    assert summary["latest_practice"]["score"] == 0
    assert summary["latest_practice"]["max_score"] == 1
    assert summary["trends"][0]["subject"] == "Mathematics"
    assert summary["trends"][0]["sessions"] == 2
    assert summary["trends"][0]["points_lost"] == 2
    assert summary["trends"][1]["subject"] == "Informatics"
    assert summary["trends"][1]["points_lost"] == 1


@pytest.mark.asyncio
async def test_get_recent_practice_summary_skips_empty_sessions():
    now = datetime.now(UTC)
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalars_all_result(
            [
                PracticeSession(
                    id=2,
                    user_id=1,
                    subject="Informatics",
                    target_questions=10,
                    generated_questions_count=0,
                    answered_questions_count=0,
                    correct_answers_count=0,
                    started_at=now,
                    updated_at=now,
                ),
                PracticeSession(
                    id=1,
                    user_id=1,
                    subject="Mathematics",
                    target_questions=10,
                    generated_questions_count=4,
                    answered_questions_count=4,
                    correct_answers_count=4,
                    started_at=now,
                    updated_at=now,
                ),
            ]
        )
    )

    summary = await get_recent_practice_summary(1, db)

    assert summary["latest_practice"]["session_id"] == 1
    assert summary["trends"] == []
