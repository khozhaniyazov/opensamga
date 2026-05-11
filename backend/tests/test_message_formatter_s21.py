"""Session 21 (2026-04-22): message_formatter MUST scrub inline
tool-call XML that leaks from OpenAI-compatible proxies like MiniMax /
Qwen-style routers. These tool calls are already executed via the
structured `tool_calls` field, so any textual echo is pure garbage
for the end user."""

from app.services.chat.message_formatter import (
    normalize_markdown,
    strip_tool_call_leaks,
)


class TestStripToolCallLeaks:
    def test_strips_minimax_wrapped_tool_call(self) -> None:
        raw = (
            "Here is the answer.\n\n"
            "<minimax:tool_call>\n"
            '<invoke name="consult_library">\n'
            '<parameter name="query">photosynthesis</parameter>\n'
            '<parameter name="grade">9</parameter>\n'
            "</invoke>\n"
            "</minimax:tool_call>\n"
        )
        cleaned = strip_tool_call_leaks(raw)
        assert "<minimax:tool_call>" not in cleaned
        assert "<invoke" not in cleaned
        assert "<parameter" not in cleaned
        assert "Here is the answer." in cleaned

    def test_strips_bare_invoke_block(self) -> None:
        raw = (
            'Answer text.\n<invoke name="get_stuff">\n<parameter name="x">1</parameter>\n</invoke>'
        )
        cleaned = strip_tool_call_leaks(raw)
        assert "<invoke" not in cleaned
        assert "<parameter" not in cleaned
        assert "Answer text." in cleaned

    def test_strips_orphan_parameter_fragment(self) -> None:
        raw = 'Prose.\n<parameter name="x">leftover</parameter>\nMore prose.'
        cleaned = strip_tool_call_leaks(raw)
        assert "<parameter" not in cleaned
        assert "leftover" not in cleaned
        assert "Prose." in cleaned
        assert "More prose." in cleaned

    def test_preserves_plain_prose_and_markdown(self) -> None:
        raw = (
            "**Bold** text with a `code span` and a [link](https://x).\n"
            "A list:\n- item 1\n- item 2\n"
        )
        assert strip_tool_call_leaks(raw) == raw

    def test_preserves_samga_citation_html_comment(self) -> None:
        raw = "<!-- samga-citation book_id=6 page=42 -->\nReal answer here."
        assert strip_tool_call_leaks(raw) == raw

    def test_handles_empty_and_none(self) -> None:
        assert strip_tool_call_leaks("") == ""
        assert strip_tool_call_leaks(None) is None  # type: ignore[arg-type]

    def test_normalize_markdown_integrates_leak_strip(self) -> None:
        raw = (
            'Real content.\n\n\n\n<minimax:tool_call><invoke name="t"></invoke></minimax:tool_call>'
        )
        cleaned = normalize_markdown(raw)
        assert "<minimax:tool_call>" not in cleaned
        assert "<invoke" not in cleaned
        # blank-line collapse still works
        assert "\n\n\n" not in cleaned
        assert cleaned.startswith("Real content.")
