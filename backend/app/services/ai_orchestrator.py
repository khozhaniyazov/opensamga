import asyncio
import json
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..services.library_retrieval import search_library_chunks
from .openai_failover import AsyncOpenAIFailoverClient, OpenAIFailoverClient

logger = logging.getLogger(__name__)

# Initialize OpenAI client (synchronous for orchestrator)
client = OpenAIFailoverClient(api_key=settings.OPENAI_API_KEY.get_secret_value())
# ---------------------------------------------------------------------------
# TOOLS schema
#
# IMPORTANT (2026-04-18 audit): The previous inline schema advertised 7 tool
# names that the production chat endpoint did not implement; the canonical
# 11-tool schema now lives in app.services.chat.tools_registry. We re-export
# from there to keep ai_orchestrator.TOOLS working for existing callers.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# System prompts were moved to app.services.chat.prompts on 2026-04-18.
# The big monoliths here (get_system_prompt, get_platform_identity_prompt)
# fell out of sync with the real tool schema + chat router. The new module
# exposes a modular builder; thin BC shims are re-exported below.
# ---------------------------------------------------------------------------
from app.services.chat.prompts import (
    get_system_prompt,
)
from app.services.chat.tools_registry import TOOLS  # noqa: E402, F401


async def orchestrate_conversation(
    db: AsyncSession,
    user_message: str,
    conversation_history: list[dict] = None,
    test_failure_mode: str = None,
) -> dict:
    """
    THE AI ORCHESTRATOR

    This is the brain of the platform. It:
    1. Receives user message
    2. Decides if it needs to call a tool (function)
    3. Executes the tool against the database
    4. Formats the response with rich data for the frontend
    """
    if conversation_history is None:
        conversation_history = []

    # Get system prompt (default to Russian)
    system_prompt = get_system_prompt("ru")
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    # --- Call OpenAI API in a thread since SDK is synchronous ---
    try:
        # Test failure mode: Simulate OpenAI service outage
        if test_failure_mode == "APOCALYPSE":
            # Simulate an unexpected timeout or service error
            raise ConnectionError("Simulated OpenAI Service Outage")

        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.OPENAI_MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        assistant_message = response.choices[0].message

        tool_calls = getattr(assistant_message, "tool_calls", None)
        if tool_calls:
            # Execute tool calls
            tool_results = []
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                try:
                    arguments = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError as e:
                    result = {"error": f"Failed to parse arguments: {str(e)}"}
                    tool_results.append(
                        {
                            "tool_call_id": tool_call.id,
                            "function_name": function_name,
                            "result": result,
                        }
                    )
                    continue

                try:
                    # Delegate to the single production tool dispatcher used by
                    # the chat router. Keeps this orchestrator in sync with the
                    # 11-tool TOOLS schema above without duplicating handlers.
                    # Lazy import to avoid a circular import at module load
                    # (tool_executor already imports `consult_library` from us).
                    from app.services.chat.tool_executor import execute_tool

                    raw = await execute_tool(
                        function_name=function_name,
                        function_args=arguments,
                        db=db,
                        language="ru",
                    )
                    try:
                        result = json.loads(raw) if isinstance(raw, str) else raw
                    except (TypeError, ValueError):
                        result = {"message": raw}

                except Exception as e:
                    import traceback

                    traceback.format_exc()
                    result = {"error": f"Tool execution failed: {str(e)}"}

                tool_results.append(
                    {
                        "tool_call_id": tool_call.id,
                        "function_name": function_name,
                        "result": result,
                    }
                )

            # Let AI format the final response with tool results
            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content,
                    "tool_calls": tool_calls,
                }
            )

            for tr in tool_results:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tr["tool_call_id"],
                        "content": json.dumps(tr["result"]),
                    }
                )

            final_response = await asyncio.to_thread(
                client.chat.completions.create,
                model=settings.OPENAI_MODEL,
                messages=messages,
            )

            return {
                "message": final_response.choices[0].message.content,
                "tool_calls": tool_results,
                "requires_widget": True,
            }
        else:
            return {
                "message": assistant_message.content,
                "tool_calls": [],
                "requires_widget": False,
            }

    except ConnectionError as e:
        # Handle simulated or real OpenAI service outages gracefully
        if "Simulated OpenAI Service Outage" in str(e):
            return {
                "message": " OpenAI Service Unavailable. The AI service is temporarily down. Please try again later.",
                "tool_calls": [],
                "requires_widget": False,
            }
        else:
            return {
                "message": " OpenAI Service Unavailable. Connection error occurred. Please try again later.",
                "tool_calls": [],
                "requires_widget": False,
            }
    except Exception as e:
        return {
            "message": f"❌ Error calling OpenAI API: {str(e)}",
            "tool_calls": [],
            "requires_widget": False,
        }


def extract_high_value_keywords(query: str) -> list[str]:
    """
    Extract high-value keywords from query: proper nouns (capitalized) and numbers.

    This helps find specific historical facts like dates (1954, 1955) and names (Attila, Virgin Lands).

    Args:
        query: The query string to extract keywords from

    Returns:
        List of extracted keywords (proper nouns and numbers)
    """
    import re

    keywords = []

    # Extract numbers (including dates like 1954-1955, years, quantities)
    # First, find date ranges (1954-1955) and split them into individual years
    date_range_pattern = r"\b(\d{1,4})-(\d{1,4})\b"
    date_ranges = re.findall(date_range_pattern, query)
    for start, end in date_ranges:
        keywords.append(start)
        keywords.append(end)

    # Then find standalone numbers (not part of ranges)
    # Use negative lookahead/lookbehind to exclude numbers that are part of ranges
    standalone_number_pattern = r"(?<!-)\b\d{1,4}\b(?!-)"
    standalone_numbers = re.findall(standalone_number_pattern, query)
    keywords.extend(standalone_numbers)

    # Extract proper nouns (capitalized words)
    # Pattern matches: words that start with uppercase letter (English, Russian, Kazakh)
    # Handles both Cyrillic (А-Я, Ё) and Latin (A-Z) alphabets
    # Matches words with at least 2 characters after the capital letter
    words = re.findall(r"\b[А-ЯЁA-Z][а-яёa-z]{2,}\b", query)

    # Filter out common words that might be capitalized at sentence start
    # Keep only words that appear capitalized in the middle of the query
    # or are clearly proper nouns (longer than 2 chars, not common articles/prepositions)
    common_words = {
        "the",
        "this",
        "that",
        "these",
        "those",
        "and",
        "or",
        "but",
        "a",
        "an",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "это",
        "эти",
        "эта",
        "этот",
        "и",
        "или",
        "но",
        "в",
        "на",
        "к",
        "для",
        "с",
    }

    for word in words:
        word_lower = word.lower()
        # Keep if it's not a common word and has at least 3 characters
        if word_lower not in common_words and len(word) >= 3:
            keywords.append(word)

    # Remove duplicates while preserving order
    seen = set()
    unique_keywords = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique_keywords.append(kw)

    return unique_keywords


_THINK_BLOCK_RE = re.compile(r"<think>[\s\S]*?(?:</think>|$)", flags=re.IGNORECASE)


def _strip_reasoning_output(text: str) -> str:
    """Strip provider reasoning blocks from an LLM completion.

    Several of our failover providers (gpt-5.2, qwen3.5, minimax) emit a
    ``<think> … </think>`` block before the real answer. For chat we filter
    this in `routers/chat.strip_reasoning_blocks`; but `optimize_rag_query`
    was not filtering, so the "optimized" query string was actually *the
    model's chain-of-thought* with the real query buried at the end (or
    entirely missing when the output was truncated by ``max_tokens=200``).
    That silently destroyed RAG quality — the embedding was built from the
    model's musings about what textbooks might say, not from the user's
    question.
    """
    if not text:
        return text
    cleaned = _THINK_BLOCK_RE.sub("", text)
    return cleaned.strip()


async def optimize_rag_query(query: str, language: str = "ru") -> str:
    """
    Optimize RAG query by rewriting it to remove MCQ noise and convert to declarative statements.

    Uses OpenAI (gpt-4o-mini) to preprocess the query, stripping multiple-choice options
    and rewriting into a clear, keyword-rich search query that matches textbook content.

    Args:
        query: The original query (may contain MCQ options or problem statements)
        language: User's language preference ('ru' or 'kz')

    Returns:
        Optimized query string ready for embedding
    """
    # Import cache utility
    from app.utils.cache import cache, cache_key

    # Generate cache key including language. Namespace bumps:
    #   v2: scrub <think> chain-of-thought.
    #   v3: prevent RU→English drift.
    #   v4 (2026-04-18 — BUG-12 final fix): bilingual expansion. The
    #        textbook corpus is ~50/50 RU/KZ and all-MiniLM-L6-v2 is
    #        NOT multilingual, so RU queries never matched KZ chunks
    #        and vice-versa. Now we output BOTH languages concatenated
    #        so the embedding lands near BOTH clusters.
    key = f"rag_opt:v5:{language}:{cache_key(query)}"

    # Check cache first (24 hour TTL)
    cached_result = await cache.get(key)
    if cached_result is not None:
        return cached_result

    # Cache miss - call GPT-4o-mini
    try:
        # Build language-specific system prompt.
        #
        # IMPORTANT (BUG-9 fix, 2026-04-18): the textbook chunk store is
        # overwhelmingly Russian-language content. KZ query embeddings drift far
        # from the RU chunk embeddings, so KZ users see "not found in library"
        # even when the concept is covered. To bridge the gap we ask the
        # optimizer to translate KZ queries into Russian academic terminology
        # AND rewrite them into a declarative textbook-style phrase. The user's
        # answer stays in KZ — only the search string is translated. The KZ
        # citation label ("Дереккөз:") is rendered downstream in chat.py.
        # BUG-12 final fix (2026-04-18): the corpus is bilingual RU+KZ
        # and the embedding model (all-MiniLM-L6-v2, English-dominant,
        # NOT multilingual) cannot reliably cross-match RU queries
        # against KZ chunks. Ask the optimizer to produce BOTH an RU
        # declarative phrase AND a KZ paraphrase on the same line, so
        # the concatenated embedding has signal from both clusters.
        # The keyword-fallback path (ILIKE) then picks up any exact
        # surface matches for the core concept word regardless.
        bilingual_directive = (
            "Rewrite the question into a keyword-rich search query "
            "that a textbook chapter on this topic would match. "
            "Produce TWO parallel phrases on the same line separated "
            "by ' / ' — first in Russian, then in Kazakh (қазақ). "
            "Each phrase should read like a textbook subheading (5–12 "
            "words, rich with domain terms; NOT a question). "
            "Include the core technical term in its base noun form "
            "(e.g. 'дискриминант', 'моль', 'ханство'). Strip any "
            "multiple-choice options. Output ONLY the concatenated "
            "bilingual query — no explanations, no quotes, no English."
        )
        if language == "kz":
            system_prompt = "The user question arrives in Kazakh. " + bilingual_directive
        else:
            system_prompt = "The user question arrives in Russian. " + bilingual_directive

        # Use AsyncOpenAI for non-blocking calls
        async with AsyncOpenAIFailoverClient(
            api_key=settings.OPENAI_API_KEY.get_secret_value()
        ) as async_client:
            response = await async_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": query},
                ],
                temperature=0.3,  # Lower temperature for more consistent rewriting
                # 200 tokens is too tight once a reasoning model emits a
                # <think> block — the real answer can be truncated to
                # nothing. We strip <think> below, but also raise the
                # ceiling so the tail (the actual optimized query) lands
                # inside the window.
                max_tokens=400,
            )

            raw = (response.choices[0].message.content or "").strip()
            # Failover providers (gpt-5.2, qwen3.5, minimax) frequently prefix
            # the reply with a <think>…</think> chain-of-thought. Without this
            # scrub, the `optimized` string was "<think>The user asks… </think>
            # <truncated>" and the embedding was built from reasoning text,
            # not from the user's question. See _strip_reasoning_output above.
            optimized = _strip_reasoning_output(raw)
            # If the model returned only a think-block and nothing else,
            # fall back to the original query rather than embedding an
            # empty string.
            if not optimized:
                optimized = query

            # Language-drift safety net (BUG-12 follow-up):
            # when the INPUT is Russian/Kazakh but the optimizer drifted
            # into English (Latin-alphabet-dominated output), discard and
            # fall back to the original query + its translation
            # placeholder.
            def _cyrillic_ratio(s: str) -> float:
                letters = [c for c in s if c.isalpha()]
                if not letters:
                    return 0.0
                cyr = sum(1 for c in letters if "\u0400" <= c <= "\u04ff")
                return cyr / len(letters)

            input_cyr = _cyrillic_ratio(query)
            output_cyr = _cyrillic_ratio(optimized)
            if input_cyr >= 0.35 and output_cyr < 0.35:
                logger.info(
                    "RAG optimizer drifted to English "
                    "(input_cyr=%.2f, output_cyr=%.2f); falling back to original query",
                    input_cyr,
                    output_cyr,
                )
                optimized = query

            result = optimized if optimized else query

            # Store in cache for 24 hours
            await cache.set(key, result, ttl_seconds=24 * 3600)

            return result

    except Exception:
        # Fallback to original query if optimization fails
        logger.warning("Query optimization failed, using original query", exc_info=True)
        return query


async def consult_library(
    db: AsyncSession,
    query: str,
    subject: str = None,
    language: str = "ru",
    grade: int = None,
    preferred_grade: int = None,
    user_id: int | None = None,
) -> list[dict]:
    """
    RAG tool to search official UNT textbooks for academic concepts.

    Searches TextbookChunk table using vector similarity, joins with Textbook
    to get book metadata, and returns formatted citations.

    Args:
        query: The academic concept to search for
        subject: Optional subject filter (e.g., "Mathematics", "Physics")
        language: User's language preference ('ru' or 'kz') for query optimization
        grade: Optional exact textbook grade filter from an explicit user request
        preferred_grade: Optional student grade for soft ranking preference (10/11 for UNT)
        user_id: Authenticated user id, forwarded to rag_query_log for per-user
            telemetry. None for unauthenticated or internal calls.

    Returns:
        List of dictionaries with content and citation information.
        Returns empty list if no results found, or fallback to top 1 if filtering too strict.
    """
    try:
        optimized_query = await optimize_rag_query(query, language=language)
        if optimized_query != query:
            logger.debug("RAG optimization: %r -> %r", query, optimized_query)

        return await search_library_chunks(
            db,
            optimized_query,
            subject=subject,
            grade=grade,
            preferred_grade=preferred_grade,
            limit=3,
            snippet_limit=600,
            user_id=user_id,
        )
    except Exception:
        logger.exception("Error searching textbooks via consult_library")
        await db.rollback()
        return []
