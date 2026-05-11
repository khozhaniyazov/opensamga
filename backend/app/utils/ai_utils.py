def detect_failure(ai_response: str) -> bool:
    """
    Detect if the AI response indicates a failure to find information.
    Returns True if failure phrases are detected.
    """
    if not ai_response:
        return False

    # Normalize case and strip whitespace
    text = ai_response.strip().lower()

    # Common failure indicators in RU/KZ/EN
    failure_phrases = [
        "не могу найти",
        "информация недоступна",
        "я не знаю",
        "не нашел",
        "не найдено",
        "нет данных",
        "не могу ответить",
        "не располагаю информацией",
        "not found",
        "no information",
        "i don't know",
        "i cannot answer",
        "unavailable",
        "not available",
        "no data",
        "no source",
        "no citation",
        "no textbook match",
        "no chunk retrieved",
        "no relevant content",
        "no answer",
        "unable to locate",
        "no evidence",
        "no supporting text",
        "no grounding",
    ]

    return any(phrase in text for phrase in failure_phrases)
