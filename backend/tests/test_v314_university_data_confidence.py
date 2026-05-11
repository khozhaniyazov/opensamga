from app.services.university_data_confidence import (
    build_summary_confidence,
    classify_admission_score,
    classify_money_amount,
)


def test_admission_score_confidence_distinguishes_missing_zero_and_verified():
    assert classify_admission_score(None)["status"] == "unknown"

    zero = classify_admission_score(0, source="university_data.grant_threshold_general")
    assert zero["status"] == "placeholder"
    assert zero["reason"] == "zero_placeholder"
    assert zero["value"] is None

    verified = classify_admission_score(86, source="historical_grant_thresholds")
    assert verified["status"] == "verified"
    assert verified["value"] == 86


def test_admission_score_confidence_rejects_out_of_range_scores():
    too_high = classify_admission_score(141)
    assert too_high["status"] == "placeholder"
    assert too_high["reason"] == "out_of_range"

    negative = classify_admission_score(-1)
    assert negative["status"] == "placeholder"
    assert negative["reason"] == "out_of_range"


def test_money_confidence_distinguishes_missing_zero_and_verified():
    assert classify_money_amount(None)["status"] == "unknown"

    zero = classify_money_amount(0, source="university_data.tuition_per_year")
    assert zero["status"] == "placeholder"
    assert zero["reason"] == "zero_placeholder"

    verified = classify_money_amount(900000, source="university_data.tuition_per_year")
    assert verified["status"] == "verified"
    assert verified["value"] == 900000


def test_summary_confidence_uses_raw_zero_rows_when_aggregate_is_missing():
    confidence = build_summary_confidence(
        median_grant_threshold=None,
        max_grant_threshold=None,
        raw_general_thresholds=[None, 0, None],
        source_url="https://example.edu/source",
    )

    median = confidence["median_grant_threshold"]
    max_value = confidence["max_grant_threshold"]

    assert median["status"] == "placeholder"
    assert median["reason"] == "zero_placeholder_in_source_rows"
    assert median["source_url"] == "https://example.edu/source"
    assert max_value["status"] == "placeholder"


def test_summary_confidence_marks_positive_aggregates_verified():
    confidence = build_summary_confidence(
        median_grant_threshold=88,
        max_grant_threshold=104,
        raw_general_thresholds=[88, 104],
        source_url=None,
    )

    assert confidence["median_grant_threshold"]["status"] == "verified"
    assert confidence["median_grant_threshold"]["value"] == 88
    assert confidence["max_grant_threshold"]["status"] == "verified"
    assert confidence["max_grant_threshold"]["value"] == 104
