"""
app/services/tts_service.py
---------------------------
Commuter Mode: Text-to-Speech Service

Generates Kazakh TTS audio using OpenAI's tts-1 model.
Audio is cached to avoid regeneration.
"""

import logging
from pathlib import Path

from app.config import settings
from app.services.openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

logger = logging.getLogger(__name__)

# Initialize async OpenAI client
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY.get_secret_value())

# Audio storage directory
AUDIO_DIR = Path(__file__).parent.parent.parent / "uploads" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


async def generate_segment_audio(
    mistake_id: int,
    fact_text: str,
    question_text: str,
    answer_text: str,
    force_regenerate: bool = False,
) -> str:
    """
    Generate TTS audio for a single mistake segment.

    Audio format (Kazakh):
    "Факт: [fact]. Сұрақ: [question]. Жауап: [answer]."

    Args:
        mistake_id: Unique ID for caching
        fact_text: Educational content from textbook
        question_text: The question the user got wrong
        answer_text: The correct answer
        force_regenerate: Skip cache and regenerate

    Returns:
        str: Relative URL path to audio file (e.g., "/static/audio/segment_123.ogg")
    """
    cache_path = AUDIO_DIR / f"segment_{mistake_id}.ogg"
    relative_url = f"/static/audio/segment_{mistake_id}.ogg"

    # Cache check - skip if already generated
    if cache_path.exists() and not force_regenerate:
        return relative_url

    # Clean and truncate text to avoid TTS limits (4096 chars)
    def clean_text(text: str, max_len: int = 500) -> str:
        if not text:
            return ""
        text = text.strip().replace("\n", " ").replace("  ", " ")
        return text[:max_len] + "..." if len(text) > max_len else text

    fact = clean_text(fact_text, 2500)  # Increased for longer content
    question = clean_text(question_text, 300)
    answer = clean_text(answer_text, 500)

    # Format text naturally WITHOUT labels (per user request)
    # Just read the fact, then pause, then question and answer
    tts_text = f"{fact}. {question}. {answer}."

    # Truncate total to 4000 chars (OpenAI limit is 4096)
    if len(tts_text) > 4000:
        tts_text = tts_text[:4000]

    try:
        # OpenAI TTS API call (async)
        response = await client.audio.speech.create(
            model="tts-1",
            voice="nova",  # Best for Kazakh
            input=tts_text,
            response_format="opus",  # OGG container
        )

        # Write to file
        with open(cache_path, "wb") as f:
            for chunk in response.iter_bytes():
                f.write(chunk)

        # Per-segment success at DEBUG (cron-loop pattern v3.55):
        # high-fanout, success is the common case, operators flip to
        # DEBUG when investigating a specific segment.
        logger.debug(
            "TTS generated audio for mistake %d at %s",
            mistake_id,
            cache_path,
        )
        return relative_url

    except Exception:
        # Re-raise: caller (commuter router) decides HTTP status. Stack
        # is attached so operators can distinguish OpenAI 5xx (transient)
        # from OS-side write failures (real bug).
        logger.exception("TTS failed to generate audio for mistake %d", mistake_id)
        raise


async def get_audio_path(mistake_id: int) -> str | None:
    """Check if audio exists for a mistake segment."""
    cache_path = AUDIO_DIR / f"segment_{mistake_id}.ogg"
    if cache_path.exists():
        return f"/static/audio/segment_{mistake_id}.ogg"
    return None


async def delete_audio(mistake_id: int) -> bool:
    """Delete cached audio for a mistake (cleanup on resolution)."""
    cache_path = AUDIO_DIR / f"segment_{mistake_id}.ogg"
    if cache_path.exists():
        cache_path.unlink()
        return True
    return False
