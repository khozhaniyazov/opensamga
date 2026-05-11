"""
Input sanitization utilities for security hardening.

Provides functions to strip malicious content from user inputs
while preserving legitimate data.
"""

import html
import re


def sanitize_text(text: str | None) -> str:
    """
    Sanitize text input by removing HTML/script tags and escaping special characters.

    Args:
        text: User-provided text input

    Returns:
        Sanitized text safe for storage and display
    """
    if text is None or text == "":
        return ""

    # Remove script and style tags completely (including content)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.IGNORECASE | re.DOTALL)

    # Escape HTML special characters
    text = html.escape(text)

    return text


def sanitize_filename(filename: str | None) -> str:
    """
    Sanitize filename to prevent path traversal and injection attacks.

    Args:
        filename: User-provided filename

    Returns:
        Sanitized filename safe for filesystem operations
    """
    if filename is None or filename == "":
        return ""

    # Remove path traversal attempts
    filename = filename.replace("../", "").replace("..\\", "")

    # Allow only alphanumeric, dash, underscore, dot
    filename = re.sub(r"[^a-zA-Z0-9._-]", "_", filename)

    # Limit length to 255 characters
    if len(filename) > 255:
        filename = filename[:255]

    return filename
