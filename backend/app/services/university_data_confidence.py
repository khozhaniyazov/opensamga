from __future__ import annotations

from typing import Any, Literal

ConfidenceStatus = Literal["verified", "unknown", "placeholder"]


def _base_payload(
    *,
    status: ConfidenceStatus,
    reason: str,
    value: int | None,
    source: str | None,
    source_url: str | None,
    last_verified_year: int | None,
) -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "value": value,
        "source": source,
        "source_url": source_url,
        "last_verified_year": last_verified_year,
    }


def classify_admission_score(
    value: int | None,
    *,
    source: str | None = None,
    source_url: str | None = None,
    last_verified_year: int | None = None,
) -> dict[str, Any]:
    """Classify a UNT score-like field without treating sentinels as real.

    Scores are on the 0-140 UNT scale. A literal zero has appeared in legacy
    data as a placeholder, so the product must not treat it as a verified
    threshold.
    """

    if value is None:
        return _base_payload(
            status="unknown",
            reason="missing",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    if value == 0:
        return _base_payload(
            status="placeholder",
            reason="zero_placeholder",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    if value < 0 or value > 140:
        return _base_payload(
            status="placeholder",
            reason="out_of_range",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    return _base_payload(
        status="verified",
        reason="positive_score",
        value=value,
        source=source,
        source_url=source_url,
        last_verified_year=last_verified_year,
    )


def classify_money_amount(
    value: int | None,
    *,
    source: str | None = None,
    source_url: str | None = None,
    last_verified_year: int | None = None,
) -> dict[str, Any]:
    if value is None:
        return _base_payload(
            status="unknown",
            reason="missing",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    if value == 0:
        return _base_payload(
            status="placeholder",
            reason="zero_placeholder",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    if value < 0:
        return _base_payload(
            status="placeholder",
            reason="negative_value",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=last_verified_year,
        )

    return _base_payload(
        status="verified",
        reason="positive_amount",
        value=value,
        source=source,
        source_url=source_url,
        last_verified_year=last_verified_year,
    )


def classify_aggregate_threshold(
    value: int | None,
    raw_values: list[int | None],
    *,
    source: str | None,
    source_url: str | None = None,
) -> dict[str, Any]:
    if value is not None:
        return classify_admission_score(
            value,
            source=source,
            source_url=source_url,
        )

    if any(raw_value == 0 for raw_value in raw_values):
        return _base_payload(
            status="placeholder",
            reason="zero_placeholder_in_source_rows",
            value=None,
            source=source,
            source_url=source_url,
            last_verified_year=None,
        )

    return classify_admission_score(
        None,
        source=source,
        source_url=source_url,
    )


def build_summary_confidence(
    *,
    median_grant_threshold: int | None,
    max_grant_threshold: int | None,
    raw_general_thresholds: list[int | None],
    source_url: str | None,
) -> dict[str, Any]:
    source = "university_data.grant_threshold_general"
    return {
        "median_grant_threshold": classify_aggregate_threshold(
            median_grant_threshold,
            raw_general_thresholds,
            source=source,
            source_url=source_url,
        ),
        "max_grant_threshold": classify_aggregate_threshold(
            max_grant_threshold,
            raw_general_thresholds,
            source=source,
            source_url=source_url,
        ),
    }
