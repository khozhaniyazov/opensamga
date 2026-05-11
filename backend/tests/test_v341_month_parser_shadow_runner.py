"""v3.41 (2026-05-01) — pin the shadow-runner script for the v3.40
month-name parser. The script is read-only end-to-end; tests cover
the report shape, both formatters, the stdin path, the
``--require-dates`` exit code, and the missing-input error path.

We import the script as a module via importlib because it lives
under ``backend/scripts/`` which isn't a regular package. This
mirrors the v3.38 db_audit_recheck pattern.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

_SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "check_month_parser.py"


def _load_module():
    """Load the script as a module under the name ``check_month_parser``."""
    spec = importlib.util.spec_from_file_location("check_month_parser", _SCRIPT_PATH)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def cmp_module():
    """The shadow-runner script, loaded once per test module."""
    return _load_module()


# ---------- build_report shape ---------------------------------------


def test_build_report_empty_body(cmp_module) -> None:
    r = cmp_module.build_report("")
    assert r["body_chars"] == 0
    assert r["iso_dates"] == []
    assert r["iso_date_count"] == 0
    assert r["dominant_lang"] is None
    assert r["raw_match_count"] == 0
    assert r["context_windows"] == []


def test_build_report_ru_match(cmp_module) -> None:
    body = "Основной этап ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года."
    r = cmp_module.build_report(body)
    assert r["iso_date_count"] >= 2
    assert "2026-05-10" in r["iso_dates"]
    assert "2026-07-10" in r["iso_dates"]
    assert r["dominant_lang"] == "ru"
    assert isinstance(r["context_windows"], list)
    assert len(r["context_windows"]) >= 2


def test_context_windows_record_year_when_present(cmp_module) -> None:
    body = "Срок 10 мая 2026 года истекает скоро."
    r = cmp_module.build_report(body)
    windows = r["context_windows"]
    assert windows
    assert any(w["year"] == "2026" for w in windows)


def test_context_windows_record_year_none_when_missing(cmp_module) -> None:
    # No year in lookahead → parser drops, but the context window
    # still surfaces it as "(none in lookahead)" for debug.
    body = "Срок 10 мая истекает скоро."
    r = cmp_module.build_report(body)
    assert r["iso_date_count"] == 0
    windows = r["context_windows"]
    assert windows
    assert all("none" in w["year"] for w in windows)


# ---------- human formatter is ASCII-safe ----------------------------


def test_human_formatter_is_ascii_only(cmp_module) -> None:
    body = "Основной этап 10 мая 2026 года."
    r = cmp_module.build_report(body)
    text = cmp_module.format_report_human(r)
    # project convention (Windows mojibake rule): stdout must be ASCII-encodable.
    text.encode("ascii")
    assert "iso dates matched" in text
    assert "2026-05-10" in text


def test_human_formatter_handles_zero_matches(cmp_module) -> None:
    text = cmp_module.format_report_human(cmp_module.build_report(""))
    assert "No ISO dates matched." in text
    assert "No context windows" in text


# ---------- main_cli ------------------------------------------------


def test_main_cli_human_default(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text(
        "ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года.",
        encoding="utf-8",
    )
    rc = cmp_module.main_cli([str(body_file)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "iso dates matched" in out
    assert "2026-05-10" in out


def test_main_cli_json_mode(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text(
        "ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года.",
        encoding="utf-8",
    )
    rc = cmp_module.main_cli([str(body_file), "--json"])
    assert rc == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["iso_date_count"] >= 2
    assert "2026-05-10" in parsed["iso_dates"]
    assert parsed["dominant_lang"] == "ru"


def test_main_cli_stdin_path(cmp_module, monkeypatch, capsys) -> None:
    body = "ЕНТ-2026 пройдёт с 10 мая по 10 июля 2026 года."
    monkeypatch.setattr(sys, "stdin", io.StringIO(body))
    rc = cmp_module.main_cli(["-"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "2026-05-10" in out


def test_main_cli_missing_input_returns_1(cmp_module, tmp_path, capsys) -> None:
    rc = cmp_module.main_cli([str(tmp_path / "does_not_exist.html")])
    assert rc == 1
    err = capsys.readouterr().err
    assert "input file not found" in err


def test_main_cli_require_dates_exit_2_when_empty(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text("Just a paragraph with no dates.", encoding="utf-8")
    rc = cmp_module.main_cli([str(body_file), "--require-dates"])
    assert rc == 2


def test_main_cli_require_dates_exit_0_when_present(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text("10 мая 2026 года.", encoding="utf-8")
    rc = cmp_module.main_cli([str(body_file), "--require-dates"])
    assert rc == 0


# ---------- regression: KZ + EN paths --------------------------------


def test_main_cli_kz_body(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text(
        "ҰБТ-2026 негізгі кезеңі 10 мамырдан 10 шілдеге дейін 2026 жылы өткізіледі.",
        encoding="utf-8",
    )
    rc = cmp_module.main_cli([str(body_file), "--json"])
    assert rc == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["dominant_lang"] == "kz"
    assert "2026-05-10" in parsed["iso_dates"]
    assert "2026-07-10" in parsed["iso_dates"]


def test_main_cli_en_body(cmp_module, tmp_path, capsys) -> None:
    body_file = tmp_path / "body.txt"
    body_file.write_text(
        "ENT-2026 main stage runs from 10 May to 10 July 2026.",
        encoding="utf-8",
    )
    rc = cmp_module.main_cli([str(body_file), "--json"])
    assert rc == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["dominant_lang"] == "en"
    assert "2026-05-10" in parsed["iso_dates"]
