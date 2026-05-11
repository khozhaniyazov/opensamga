from __future__ import annotations

import re

PEDAGOGICAL_MAJOR_CODES = {f"B{idx:03d}" for idx in range(1, 21)}
HEALTH_MAJOR_CODES = {
    "B084",  # Nursing
    "B085",  # Pharmacy
    "B086",  # General medicine
    "B087",  # Dentistry
    "B088",  # Pediatrics
    "B089",  # Public health
    "B094",  # Sanitary and preventive measures
}
LAW_MAJOR_CODES = {"B049"}

# The Ministry's 2025 Russian admission notice keeps this national university
# at 50 points instead of the generic 65-point national university threshold.
NATIONAL_50_POINT_EXCEPTIONS = {
    "казахский национальный университет водного хозяйства и ирригации",
}

OFFICIAL_MIN_SCORE_SOURCE_URL = (
    "https://www.gov.kz/memleket/entities/education/press/news/details/1027546?lang=ru"
)


def _normalize(value: str | None) -> str:
    text = (value or "").lower().replace("ё", "е")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_national_university(uni_name: str | None) -> bool:
    normalized = _normalize(uni_name)
    return "национальн" in normalized or "national" in normalized


def official_paid_min_score(uni_name: str | None, major_code: str | None) -> int:
    """Return the official 2025 UNT floor for paid admission.

    This is only a fallback where a university-specific threshold is missing.
    Universities can publish higher paid-admission thresholds, so scraped or
    official university-level overrides should take precedence.
    """

    code = (major_code or "").strip().upper()
    normalized_name = _normalize(uni_name)

    if code in PEDAGOGICAL_MAJOR_CODES:
        return 75
    if code in LAW_MAJOR_CODES:
        return 75
    if code in HEALTH_MAJOR_CODES:
        return 70
    if normalized_name in NATIONAL_50_POINT_EXCEPTIONS:
        return 50
    if is_national_university(uni_name):
        return 65
    return 50
