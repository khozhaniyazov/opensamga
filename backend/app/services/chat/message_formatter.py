"""Helpers for consistent chat response markdown formatting."""

import re

# Session 21 (2026-04-22): some OpenAI-compatible chat models
# (notably MiniMax/Qwen-style proxies) emit tool invocations as
# inline XML-ish text like `<minimax:tool_call>...<invoke name="...">
# <parameter name="...">...</parameter></invoke></minimax:tool_call>`
# on top of (or instead of) the structured `tool_calls` field.
# We execute tools via the structured field, so any such textual
# echo is garbage that MUST not leak to the end user.
_TOOL_CALL_LEAK_PATTERNS: tuple[re.Pattern[str], ...] = (
    # MiniMax-style block with optional namespace prefix
    re.compile(
        r"<\s*[a-zA-Z][\w-]*:?tool_call\s*>.*?<\s*/\s*[a-zA-Z][\w-]*:?tool_call\s*>",
        re.DOTALL | re.IGNORECASE,
    ),
    # Bare <invoke>...</invoke> blocks (Claude-style) without a wrapper
    re.compile(r"<\s*invoke\b[^>]*>.*?<\s*/\s*invoke\s*>", re.DOTALL | re.IGNORECASE),
    # Orphan <parameter> fragments left over after partial stripping
    re.compile(r"<\s*parameter\b[^>]*>.*?<\s*/\s*parameter\s*>", re.DOTALL | re.IGNORECASE),
    # A sentinel the model sometimes leaves behind
    re.compile(r"</?\s*[a-zA-Z][\w-]*:tool_call\s*>", re.IGNORECASE),
)


def strip_tool_call_leaks(content: str) -> str:
    """Remove model-emitted tool-call XML that leaked into user-visible prose."""
    if not content:
        return content
    cleaned = content
    for pat in _TOOL_CALL_LEAK_PATTERNS:
        cleaned = pat.sub("", cleaned)
    return cleaned


def normalize_markdown(content: str) -> str:
    """Normalize markdown while preserving content semantics.

    - Return empty string for falsy input
    - Normalize CRLF/CR to LF
    - Strip MiniMax/Qwen-style inline tool-call XML leaks
    - Collapse 3+ blank lines to two
    - Strip leading/trailing whitespace
    """
    if not content:
        return ""

    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    normalized = strip_tool_call_leaks(normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()
