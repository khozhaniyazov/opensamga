"""Session 22 (2026-04-22): unit tests for the Phase C parts_shaper
module that converts raw tool_executor JSON into the structured
`parts` envelope consumed by the Phase B frontend tool-result cards
(GrantChanceGauge / UniComparisonTable / HistoricalThresholdSparkline
/ RecommendationList).

These are pure-function tests — no DB fixtures required.
"""

from __future__ import annotations

import json

from app.services.chat.parts_shaper import shape_tool_part


class TestGrantChance:
    def test_happy_russian_payload(self) -> None:
        raw = json.dumps(
            {
                "статус": "безопасный",
                "вероятность": "высокая (>90%)",
                "сообщение": "Ваш балл (135) значительно выше порога (120). 🟢",
                "data_year": 2025,
            },
            ensure_ascii=False,
        )
        out = shape_tool_part(
            "check_grant_chance",
            {"uni_name": "KBTU", "score": 135, "quota_type": "GENERAL"},
            raw,
        )
        assert out is not None
        assert out["tool"] == "check_grant_chance"
        assert out["result"]["tool"] == "grant_chance"
        data = out["result"]["data"]
        assert data["score"] == 135
        assert data["university"] == "KBTU"
        assert data["threshold"] == 120
        assert data["probability"] is not None and 0.9 < data["probability"] < 1.0
        assert data["quota_type"] == "GENERAL"

    def test_missing_score_is_dropped(self) -> None:
        raw = '{"статус":"безопасный","сообщение":"порога (120)"}'
        assert shape_tool_part("check_grant_chance", {"uni_name": "X"}, raw) is None

    def test_non_json_response_is_dropped(self) -> None:
        assert (
            shape_tool_part(
                "check_grant_chance",
                {"uni_name": "X", "score": 100},
                "Университет не найден.",
            )
            is None
        )

    def test_risky_bucket_gets_medium_probability(self) -> None:
        raw = json.dumps(
            {
                "статус": "рискованный",
                "сообщение": "Ваш балл (118) близок к порогу (120).",
            },
            ensure_ascii=False,
        )
        out = shape_tool_part("check_grant_chance", {"uni_name": "KBTU", "score": 118}, raw)
        assert out is not None
        prob = out["result"]["data"]["probability"]
        assert prob is not None and 0.4 < prob < 0.7


class TestHistoricalThresholds:
    def test_happy_sorted_ascending(self) -> None:
        raw = json.dumps(
            [
                {"uni_name": "KBTU", "year": 2024, "min_score": 120},
                {"uni_name": "KBTU", "year": 2023, "min_score": 115},
                {"uni_name": "KBTU", "year": 2025, "min_score": 125},
            ]
        )
        out = shape_tool_part(
            "get_historical_data",
            {"uni_name": "KBTU", "major_code": "B057"},
            raw,
        )
        assert out is not None
        pts = out["result"]["data"]["points"]
        assert [p["year"] for p in pts] == [2023, 2024, 2025]
        assert [p["threshold"] for p in pts] == [115, 120, 125]

    def test_empty_list_is_dropped(self) -> None:
        assert shape_tool_part("get_historical_data", {}, "[]") is None

    def test_non_dict_rows_are_skipped(self) -> None:
        raw = json.dumps([1, None, {"year": 2024, "min_score": 120}])
        out = shape_tool_part("get_historical_data", {"uni_name": "X"}, raw)
        assert out is not None
        assert len(out["result"]["data"]["points"]) == 1


class TestRecommendations:
    def test_happy(self) -> None:
        raw = json.dumps(
            [
                {"uni_name": "KBTU", "major": "IT", "threshold": 120},
                {"uni_name": "NU", "major": "CS", "threshold": 130},
            ]
        )
        out = shape_tool_part(
            "recommend_universities",
            {"score": 135, "quota_type": "GENERAL"},
            raw,
        )
        assert out is not None
        assert out["result"]["tool"] == "recommend_universities"
        items = out["result"]["data"]["items"]
        assert len(items) == 2
        assert items[0]["university"] == "KBTU"
        assert items[0]["threshold"] == 120

    def test_missing_score_is_dropped(self) -> None:
        raw = '[{"uni_name":"X","threshold":100}]'
        assert shape_tool_part("recommend_universities", {}, raw) is None

    def test_invalid_quota_coerced_to_general(self) -> None:
        raw = '[{"uni_name":"X","threshold":100}]'
        out = shape_tool_part("recommend_universities", {"score": 110, "quota_type": "BOGUS"}, raw)
        assert out is not None
        assert out["result"]["data"]["quota_type"] == "GENERAL"


class TestCompareUniversities:
    def test_happy_caps_at_three(self) -> None:
        raw = json.dumps(
            [{"uni_name": f"U{i}", "founding_year": 2000 + i, "city": "Almaty"} for i in range(5)]
        )
        out = shape_tool_part("compare_universities", {}, raw)
        assert out is not None
        assert len(out["result"]["data"]["unis"]) == 3


class TestUnknownAndFallback:
    def test_unknown_tool_returns_none(self) -> None:
        assert shape_tool_part("some_unknown_tool", {}, "{}") is None

    def test_consult_library_returns_none(self) -> None:
        # consult_library is not card-worthy — it's handled by the
        # citation-chip metadata path instead.
        raw = '{"citations": [], "count": 0}'
        assert shape_tool_part("consult_library", {"query": "x"}, raw) is None

    def test_empty_raw_returns_none(self) -> None:
        assert shape_tool_part("check_grant_chance", {"uni_name": "x", "score": 1}, "") is None
