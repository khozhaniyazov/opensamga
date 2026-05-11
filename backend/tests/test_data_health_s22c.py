"""Smoke test for scripts/data_health.py (session 22c, 2026-04-22).

The CLI is a key ops tool — it must run end-to-end, produce
parseable JSON, and its overall verdict must match the underlying DB
state. This test invokes the CLI as a subprocess so it also catches
import-path / entrypoint regressions.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND_DIR / "scripts" / "data_health.py"


def _run_json() -> dict:
    """Invoke the CLI and return the parsed JSON section of its stdout."""
    res = subprocess.run(
        [sys.executable, str(SCRIPT), "--json"],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert res.returncode in (0, 1, 2), (
        f"data_health.py crashed with rc={res.returncode}\nSTDERR:\n{res.stderr}"
    )
    # Stdout may contain a logger preamble line (JSON log). Extract the
    # final JSON blob by finding the last '{' with a matching '}' at EOF.
    out = res.stdout.strip()
    # Take from the first balanced top-level JSON object.
    start = out.rfind("\n{")  # final JSON object
    if start == -1 and out.startswith("{"):
        start = 0
    elif start == -1:
        # Fallback: parse line-by-line until we find valid JSON
        for i, line in enumerate(out.splitlines()):
            if line.startswith("{"):
                start = sum(len(l) + 1 for l in out.splitlines()[:i])
                break
    payload = out[start:].strip()
    return json.loads(payload)


def test_data_health_cli_runs_and_returns_json():
    data = _run_json()
    assert "sections" in data
    assert "overall" in data
    assert data["overall"] in {"PASS", "WARN", "FAIL"}
    # At minimum, these sections are produced by the default run.
    names = {s["name"] for s in data["sections"]}
    required = {
        "users",
        "exam_attempts",
        "chat",
        "textbooks",
        "textbook_chunks",
        "universities",
        "major_groups",
    }
    missing = required - names
    assert not missing, f"missing sections: {missing}"


def test_data_health_cli_universities_pass():
    """Post session-22c backfill, the universities section must PASS
    (orphan_2025_codes=0, freshness OK)."""
    data = _run_json()
    uni = next(s for s in data["sections"] if s["name"] == "universities")
    assert uni["worst"] == "PASS", f"universities section regressed: {uni['checks']}"


def test_data_health_cli_major_groups_pass():
    data = _run_json()
    mg = next(s for s in data["sections"] if s["name"] == "major_groups")
    assert mg["worst"] == "PASS", f"major_groups section regressed: {mg['checks']}"


def test_data_health_cli_textbook_chunks_pass():
    data = _run_json()
    tc = next(s for s in data["sections"] if s["name"] == "textbook_chunks")
    assert tc["worst"] == "PASS", f"textbook_chunks section regressed: {tc['checks']}"
