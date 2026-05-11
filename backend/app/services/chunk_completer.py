"""
app/services/chunk_completer.py
-------------------------------
AI-powered content processor for Commuter Mode.
Validates content suitability AND completes incomplete chunks.
"""

import logging
import os

from .openai_failover import AsyncOpenAIFailoverClient as AsyncOpenAI

logger = logging.getLogger(__name__)

# Full system prompts for content completion (user-approved)
# CRITICAL: AI must add ONLY 1-2 short sentences to complete the text
COMPLETION_PROMPTS = {
    "kk": """Бұл аяқталмаған тарихи мәтін. Тек 1-2 қысқа сөйлеммен аяқта. Нүктемен аяқтауы міндетті. Жаңа ақпарат қоспа, тек мәтінді логикалық аяқта.

Аяқталмаған мәтін:""",
    "ru": """Это незавершённый исторический текст. Добавь ТОЛЬКО 1-2 коротких предложения для завершения. Обязательно заканчивай точкой. Не добавляй новую информацию, просто логически заверши текст.

Незавершённый текст:""",
}

# Content validation prompt - AI decides if content is suitable for listening
VALIDATION_PROMPT = """You are a content filter for an audio learning app about Kazakh history.

APPROVE content that contains ANY of these (even if mixed with headers/formatting):
- Historical facts about khans, battles, treaties, or events
- Biographical information about historical figures
- Descriptions of historical periods or developments
- Cultural, social, or political history
- Any substantive educational narrative

ONLY REJECT if the content is ENTIRELY made of:
- Just lesson objectives ("Бүгінгі сабақта:" with only bullet points)
- Just keyword lists ("Кілт сөздер:" with only terms)
- Just questions or exercises (numbered questions like "1. Қандай...")
- Just answer options (А, Б, В choices)
- Just bibliography/references
- Just author names or page numbers

When in doubt, APPROVE. We want educational content even if it has some markdown formatting.

Respond with ONLY: APPROVE or REJECT"""

# Sentence-ending punctuation marks
SENTENCE_ENDINGS = [".", "!", "?", "。", "…"]


def clean_text_for_audio(text: str) -> str:
    """
    Clean text for TTS - remove markdown, special characters, and formatting.
    Returns clean, readable text suitable for audio playback.
    """
    import re

    if not text:
        return ""

    # Remove markdown headers
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^§\d+\.?\s*", "", text, flags=re.MULTILINE)

    # Remove bold/italic markdown
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)  # **bold** -> bold
    text = re.sub(r"\*([^*]+)\*", r"\1", text)  # *italic* -> italic
    text = re.sub(r"__([^_]+)__", r"\1", text)  # __bold__ -> bold
    text = re.sub(r"_([^_]+)_", r"\1", text)  # _italic_ -> italic

    # Remove code blocks and backticks
    text = re.sub(r"```[^`]*```", "", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)

    # Remove bullet points and list markers
    text = re.sub(r"^[-*•]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)

    # Remove links but keep text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

    # Remove special Unicode characters that are unpronounceable
    text = re.sub(r"[→←↑↓↔▶◀►◄■□●○◆◇★☆]", "", text)

    # Remove multiple newlines/spaces
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r" {2,}", " ", text)

    # Remove page markers
    text = re.sub(r"##\s*Page\s*\d+", "", text, flags=re.IGNORECASE)

    return text.strip()


def detect_language(text: str) -> str:
    """Detect if text is Kazakh or Russian based on character frequency."""
    kazakh_chars = set("ӘәІіҢңҒғҮүҰұҚқӨө")
    kz_count = sum(1 for char in text if char in kazakh_chars)

    # If significant Kazakh-specific characters, it's Kazakh
    if kz_count > 5:
        return "kk"
    return "ru"


def is_complete_text(text: str) -> bool:
    """Check if text ends with proper sentence-ending punctuation."""
    if not text:
        return False

    text = text.strip()
    if not text:
        return False

    last_char = text[-1]
    return last_char in SENTENCE_ENDINGS


async def validate_content(content: str) -> bool:
    """
    Use AI to determine if content is suitable for Commuter Mode.
    Returns True if content is valid narrative content, False otherwise.
    """
    if not content or len(content) < 100:
        logger.debug(
            "Rejected: too short (%d chars)",
            len(content) if content else 0,
        )
        return False

    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": VALIDATION_PROMPT},
                {"role": "user", "content": content[:1000]},  # First 1000 chars for validation
            ],
            max_tokens=10,
            temperature=0,
        )

        result = response.choices[0].message.content.strip().upper()
        is_approved = "APPROVE" in result

        # Debug logging
        preview = content[:100].replace("\n", " ")
        logger.debug("AI says %s for: %s...", result, preview)

        return is_approved

    except Exception:
        logger.exception("Validation error")
        return False  # Reject on error to be safe


async def complete_content(content: str) -> str:
    """
    Complete incomplete content with AI-generated story-style ending.
    """
    if is_complete_text(content):
        return content

    language = detect_language(content)
    system_prompt = COMPLETION_PROMPTS.get(language, COMPLETION_PROMPTS["kk"])

    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        # Prompt already ends with "Аяқталмаған мәтін:" or "Незавершённый текст:"
        # So we just send the content directly

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
            max_tokens=50,  # Short completion - just 1-2 sentences
            temperature=0.3,  # More deterministic
        )

        completion = response.choices[0].message.content.strip()

        # Combine and ensure ends with punctuation
        if content.endswith(" "):
            result = content + completion
        else:
            result = content + " " + completion

        # Ensure it ends with sentence-ending punctuation
        result = result.rstrip()
        if result and result[-1] not in ".!?":
            result += "."

        return result

    except Exception:
        logger.exception("Completion failed")
        # Graceful fallback - just add period
        return content.rstrip() + "."


QA_GENERATION_PROMPT = """Based on this Kazakh history text, generate ONE short question and ONE short answer.
Keep both under 100 characters. Question must end with "?" and answer must end with ".".

Respond in this EXACT format (in the same language as the text):
QUESTION: [short question ending with ?]
ANSWER: [short answer ending with .]"""


async def generate_qa_from_content(content: str) -> tuple[str, str]:
    """
    Generate a question and answer from the content.
    Returns (question, answer) tuple with proper punctuation.
    """
    language = detect_language(content)

    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": QA_GENERATION_PROMPT},
                {"role": "user", "content": content[:500]},  # Less context needed
            ],
            max_tokens=80,  # Keep it short
            temperature=0.3,  # More consistent
        )

        result = response.choices[0].message.content.strip()

        # Parse response
        question = ""
        answer = ""
        for line in result.split("\n"):
            line = line.strip()
            if line.upper().startswith("QUESTION:"):
                question = line[9:].strip()
            elif line.upper().startswith("ANSWER:"):
                answer = line[7:].strip()
            elif line.startswith("СҰРАҚ:") or line.startswith("Сұрақ:"):
                question = line.split(":", 1)[1].strip() if ":" in line else line
            elif line.startswith("ЖАУАП:") or line.startswith("Жауап:"):
                answer = line.split(":", 1)[1].strip() if ":" in line else line

        # Ensure proper punctuation
        if question and not question.endswith("?"):
            question = question.rstrip(".!") + "?"
        if answer and not answer.endswith("."):
            answer = answer.rstrip("?!") + "."

        if question and answer:
            return question, answer

    except Exception:
        logger.exception("Q&A generation failed")

    # Fallback to generic
    if language == "kk":
        return "Осы мәтіннен не білдіңіз?", "Мәтінді мұқият тыңдаңыз."
    else:
        return "Что вы узнали из этого текста?", "Внимательно слушайте текст."


async def process_chunk_for_commuter(content: str) -> dict | None:
    """
    Main entry point: Validate content, complete, clean, and generate Q&A.

    Returns:
        - Dict with {fact, question, answer} if suitable
        - None if content should be rejected (caller should get new chunk)
    """
    if not content or len(content) < 100:
        return None

    # Step 1: AI validates if content is suitable
    is_valid = await validate_content(content)

    if not is_valid:
        logger.debug("Content rejected (intro/outro/questions detected)")
        return None  # Caller should try another chunk

    # Step 2: Complete if needed (use more content for better context)
    processed = await complete_content(content[:1500])

    # Step 3: Clean for audio (remove markdown, special chars)
    cleaned = clean_text_for_audio(processed)

    # Step 4: Generate Q&A from content
    question, answer = await generate_qa_from_content(cleaned)

    return {"fact": cleaned, "question": question, "answer": answer}


# Legacy function for backward compatibility
async def complete_chunk_content(content: str, max_completion_tokens: int = 150) -> str:
    """
    Legacy wrapper - now uses full processing pipeline.
    """
    result = await process_chunk_for_commuter(content)
    return result["fact"] if result else content  # Fallback to original if rejected
