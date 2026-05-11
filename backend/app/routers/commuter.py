"""
app/routers/commuter.py
-----------------------
Commuter Mode API Router

Audio playlist generation and playback tracking for passive learning.
TTS always in Kazakh. Mistakes auto-resolve after 5 complete listens.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import AudioPlaybackLog, MistakeReview, Textbook, TextbookChunk, User
from ..services.chunk_completer import process_chunk_for_commuter
from ..services.tts_service import generate_segment_audio, get_audio_path
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/commuter", tags=["commuter"])

# Subject filter for Commuter Mode (only History for now)
ALLOWED_SUBJECTS = [
    "History of Kazakhstan",
    "history of kazakhstan",
    "Қазақстан тарихы",
    "История Казахстана",
]


# --- PYDANTIC SCHEMAS ---


class SegmentInfo(BaseModel):
    """A single segment in the playlist."""

    mistake_id: int | None  # None for random topics
    chunk_id: int | None  # For random topics
    topic: str | None
    audio_url: str | None  # None if not yet generated
    fact: str
    question: str
    answer: str
    is_random: bool = False  # True if from random fallback


class PlaylistResponse(BaseModel):
    """Playlist containing multiple segments."""

    segments: list[SegmentInfo]
    total: int


class AudioGenerateResponse(BaseModel):
    """Response after generating audio."""

    audio_url: str
    mistake_id: int | None
    chunk_id: int | None


class PlaybackTrackRequest(BaseModel):
    """Request to track playback."""

    mistake_id: int
    segment_index: int
    completed: bool


class PlaybackTrackResponse(BaseModel):
    """Response with playback count and resolution status."""

    playback_count: int
    resolved: bool


class CommuterStatsResponse(BaseModel):
    """User's commuter mode statistics."""

    total_segments_listened: int
    total_completed: int
    mistakes_resolved_via_commuter: int


class NextSegmentResponse(BaseModel):
    """Response for on-demand single segment request."""

    segment: SegmentInfo | None
    has_more: bool
    message: str | None = None


# --- ENDPOINTS ---


@router.get("/next-segment", response_model=NextSegmentResponse)
async def get_next_segment(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get a single segment on-demand.
    Prioritizes random History chunks for variety, falls back to user mistakes.
    """
    import random as py_random

    # PRIORITY 1: Random History textbook chunks (better variety)
    history_books = await db.execute(
        select(Textbook.id).where(Textbook.subject.in_(ALLOWED_SUBJECTS))
    )
    history_book_ids = [b[0] for b in history_books.all()]

    if history_book_ids:
        random_chunks = await db.execute(
            select(TextbookChunk)
            .where(TextbookChunk.textbook_id.in_(history_book_ids))
            .where(func.length(TextbookChunk.content) > 150)
            .limit(100)  # Get a large pool
        )

        chunks = list(random_chunks.scalars().all())
        py_random.shuffle(chunks)  # True random shuffle

        for chunk in chunks[:30]:  # Check up to 30
            processed = await process_chunk_for_commuter(chunk.content)
            if processed:
                return NextSegmentResponse(
                    segment=SegmentInfo(
                        mistake_id=None,
                        chunk_id=chunk.id,
                        topic="Қазақстан тарихы",
                        audio_url=None,
                        fact=processed["fact"],
                        question=processed["question"],
                        answer=processed["answer"],
                        is_random=True,
                    ),
                    has_more=True,
                )

    # PRIORITY 2: User's unresolved mistakes (fallback)
    result = await db.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.is_resolved == False)
        .where(MistakeReview.topic_tag.in_(ALLOWED_SUBJECTS))
        .limit(20)
    )
    mistakes = list(result.scalars().all())
    py_random.shuffle(mistakes)

    for mistake in mistakes[:10]:
        if not mistake.textbook_chunk_id:
            continue

        chunk = await db.get(TextbookChunk, mistake.textbook_chunk_id)
        if not chunk or not chunk.content:
            continue

        processed = await process_chunk_for_commuter(chunk.content[:800])
        if processed:
            audio_url = await get_audio_path(mistake.id)

            return NextSegmentResponse(
                segment=SegmentInfo(
                    mistake_id=mistake.id,
                    chunk_id=mistake.textbook_chunk_id,
                    topic=mistake.topic_tag,
                    audio_url=audio_url,
                    fact=processed["fact"],
                    question=processed["question"],
                    answer=processed["answer"],
                    is_random=False,
                ),
                has_more=True,
            )

    return NextSegmentResponse(
        segment=None, has_more=False, message="No suitable content found. Try again later."
    )


@router.get("/playlist", response_model=PlaylistResponse)
async def get_playlist(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get user's audio playlist with segment metadata.

    Priority:
    1. User's unresolved History of Kazakhstan mistakes (up to 20)
    2. If no mistakes, fallback to random History textbook chunks

    Audio URLs are null until explicitly generated.
    """
    segments = []

    # Get user's unresolved History of Kazakhstan mistakes (filtered by topic_tag)
    result = await db.execute(
        select(MistakeReview)
        .where(MistakeReview.user_id == current_user.id)
        .where(MistakeReview.is_resolved == False)
        .where(MistakeReview.topic_tag.in_(ALLOWED_SUBJECTS))
        .order_by(MistakeReview.created_at.desc())
        .limit(20)
    )
    mistakes = result.scalars().all()

    # Build segments from mistakes (with AI validation)
    for mistake in mistakes:
        chunk_content = ""
        if mistake.textbook_chunk_id:
            chunk = await db.get(TextbookChunk, mistake.textbook_chunk_id)
            if chunk and chunk.content:
                # AI validates and completes content
                processed = await process_chunk_for_commuter(chunk.content[:800])
                if processed:
                    chunk_content = processed
                else:
                    # Skip this mistake if content is not suitable
                    continue

        audio_url = await get_audio_path(mistake.id)
        question_data = mistake.original_question_snapshot or {}

        segments.append(
            SegmentInfo(
                mistake_id=mistake.id,
                chunk_id=mistake.textbook_chunk_id,
                topic=mistake.topic_tag,
                audio_url=audio_url,
                fact=chunk_content,
                question=question_data.get("text", question_data.get("question", "")),
                answer=mistake.correct_answer or "",
                is_random=False,
            )
        )

    # If not enough mistakes, fill with random History textbook chunks
    if len(segments) < 10:
        needed = 10 - len(segments)

        # Get History textbook IDs
        history_books = await db.execute(
            select(Textbook.id).where(Textbook.subject.in_(ALLOWED_SUBJECTS))
        )
        history_book_ids = [b[0] for b in history_books.all()]

        if history_book_ids:
            # Fetch more chunks than needed to account for AI rejection
            random_chunks = await db.execute(
                select(TextbookChunk)
                .where(TextbookChunk.textbook_id.in_(history_book_ids))
                .where(func.length(TextbookChunk.content) > 150)
                .order_by(func.random())
                .limit(needed * 5)  # Fetch 5x since AI may reject many
            )

            added = 0
            for chunk in random_chunks.scalars():
                if added >= needed:
                    break

                # AI validates and completes content in one step
                processed_content = await process_chunk_for_commuter(chunk.content)

                if processed_content is None:
                    # AI rejected this chunk, try next
                    continue

                segments.append(
                    SegmentInfo(
                        mistake_id=None,
                        chunk_id=chunk.id,
                        topic="Қазақстан тарихы",
                        audio_url=None,
                        fact=processed_content,  # Already validated and completed
                        question="Осы мәтін туралы не білесіз?",
                        answer="Мәтінді мұқият тыңдаңыз.",
                        is_random=True,
                    )
                )
                added += 1

    return PlaylistResponse(segments=segments, total=len(segments))


@router.post("/segment/{mistake_id}/audio", response_model=AudioGenerateResponse)
async def generate_segment(
    mistake_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate TTS audio for a mistake segment on-demand.
    """
    # Verify ownership
    mistake = await db.get(MistakeReview, mistake_id)
    if not mistake or mistake.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mistake not found")

    # Get textbook chunk content
    chunk_content = ""
    if mistake.textbook_chunk_id:
        chunk = await db.get(TextbookChunk, mistake.textbook_chunk_id)
        chunk_content = chunk.content if chunk else ""

    # Generate TTS audio
    try:
        # AI validates, completes content, and generates Q&A
        if chunk_content:
            processed = await process_chunk_for_commuter(chunk_content)
            if processed:
                fact_text = processed["fact"]
                question_text = processed["question"]
                answer_text = processed["answer"]
            else:
                from ..services.chunk_completer import clean_text_for_audio

                fact_text = clean_text_for_audio(chunk_content[:800])
                question_text = "Осы мәтін туралы не білдіңіз?"
                answer_text = "Мәтінді мұқият тыңдаңыз."
        else:
            # No chunk content, use question data from mistake
            question_data = mistake.original_question_snapshot or {}
            fact_text = ""
            question_text = question_data.get(
                "text", question_data.get("question", "Белгісіз сұрақ")
            )
            answer_text = mistake.correct_answer or "Белгісіз жауап"

        audio_url = await generate_segment_audio(
            mistake_id=mistake.id,
            fact_text=fact_text,
            question_text=question_text,
            answer_text=answer_text,
        )
        return AudioGenerateResponse(
            audio_url=audio_url, mistake_id=mistake.id, chunk_id=mistake.textbook_chunk_id
        )
    except Exception as e:
        logger.exception(
            "commuter mistake audio failed user_id=%s mistake_id=%s",
            current_user.id,
            mistake.id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate audio",
        ) from e


@router.post("/chunk/{chunk_id}/audio", response_model=AudioGenerateResponse)
async def generate_chunk_audio(
    chunk_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate TTS audio for a random textbook chunk (fallback content).
    """
    chunk = await db.get(TextbookChunk, chunk_id)
    if not chunk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chunk not found")

    # Generate TTS audio using chunk_id as identifier (negative to avoid collision)
    try:
        # AI validates, completes content, and generates Q&A
        content = chunk.content[:800] if chunk.content else ""
        processed = await process_chunk_for_commuter(content) if content else None

        if processed:
            fact_text = processed["fact"]
            question_text = processed["question"]
            answer_text = processed["answer"]
        else:
            # Fallback if AI processing fails
            from ..services.chunk_completer import clean_text_for_audio

            fact_text = clean_text_for_audio(content)
            question_text = "Осы мәтін туралы не білдіңіз?"
            answer_text = "Мәтінді мұқият тыңдаңыз."

        audio_url = await generate_segment_audio(
            mistake_id=-chunk_id,  # Use negative ID for chunks
            fact_text=fact_text,
            question_text=question_text,
            answer_text=answer_text,
        )
        return AudioGenerateResponse(audio_url=audio_url, mistake_id=None, chunk_id=chunk_id)
    except Exception as e:
        logger.exception(
            "commuter chunk audio failed user_id=%s chunk_id=%s",
            current_user.id,
            chunk_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate audio",
        ) from e


@router.post("/track", response_model=PlaybackTrackResponse)
async def track_playback(
    data: PlaybackTrackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Log playback event and check for auto-resolution.

    After 5 complete listens, the mistake is automatically marked resolved.
    """
    # Verify ownership
    mistake = await db.get(MistakeReview, data.mistake_id)
    if not mistake or mistake.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mistake not found")

    # Create playback log entry
    log = AudioPlaybackLog(
        user_id=current_user.id,
        mistake_review_id=data.mistake_id,
        segment_index=data.segment_index,
        playback_completed=data.completed,
    )
    db.add(log)

    # Count completed playbacks for this mistake
    count_result = await db.execute(
        select(func.count())
        .select_from(AudioPlaybackLog)
        .where(AudioPlaybackLog.user_id == current_user.id)
        .where(AudioPlaybackLog.mistake_review_id == data.mistake_id)
        .where(AudioPlaybackLog.playback_completed == True)
    )
    playback_count = count_result.scalar() or 0

    # Add 1 if current is completed (not yet committed)
    if data.completed:
        playback_count += 1

    # Check for auto-resolution (5 complete listens)
    resolved = False
    if playback_count >= 5 and not mistake.is_resolved:
        mistake.is_resolved = True
        resolved = True
        # Auto-resolution is a meaningful business event (mistake
        # cleared without an explicit review pass) — keep at INFO so
        # operators can chart auto-resolve volume.
        logger.info(
            "Commuter auto-resolved mistake | mistake_id=%d listens=%d user_id=%d",
            data.mistake_id,
            playback_count,
            current_user.id,
        )

    await db.commit()

    return PlaybackTrackResponse(playback_count=playback_count, resolved=resolved)


@router.get("/stats", response_model=CommuterStatsResponse)
async def get_commuter_stats(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get user's commuter mode statistics.
    """
    # Total segments listened
    total_result = await db.execute(
        select(func.count())
        .select_from(AudioPlaybackLog)
        .where(AudioPlaybackLog.user_id == current_user.id)
    )
    total_listened = total_result.scalar() or 0

    # Total completed
    completed_result = await db.execute(
        select(func.count())
        .select_from(AudioPlaybackLog)
        .where(AudioPlaybackLog.user_id == current_user.id)
        .where(AudioPlaybackLog.playback_completed == True)
    )
    total_completed = completed_result.scalar() or 0

    # Mistakes resolved via commuter (those with 5+ completed playbacks)
    resolved_result = await db.execute(
        select(func.count(func.distinct(AudioPlaybackLog.mistake_review_id)))
        .where(AudioPlaybackLog.user_id == current_user.id)
        .where(AudioPlaybackLog.playback_completed == True)
        .group_by(AudioPlaybackLog.mistake_review_id)
        .having(func.count() >= 5)
    )
    resolved_count = len(resolved_result.all())

    return CommuterStatsResponse(
        total_segments_listened=total_listened,
        total_completed=total_completed,
        mistakes_resolved_via_commuter=resolved_count,
    )
