"""Unit tests for the golden-set methodology guards.

Kept dependency-light — everything can be run as::

    python -m pytest frontend/tests/rag_eval/test_guards.py -v

without needing a live Postgres or DashScope.  Both guards are exercised
with hand-rolled mock clients that return scripted JSON bodies.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# This test file is deliberately portable: it works whether pytest is
# invoked from the repo root (`python -m pytest frontend/tests/rag_eval`)
# or from the backend dir (`pytest -m integration` picks it up via path
# injection). We add the repo root to sys.path so
# `frontend.tests.rag_eval.guards.*` imports resolve regardless.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from frontend.tests.rag_eval.guards.numeric_guard import (  # noqa: E402
    is_numeric_mcq,
    run as run_numeric,
)
from frontend.tests.rag_eval.guards.anchor_cooccurrence import (  # noqa: E402
    _classify_lang,
    run as run_anchor,
)


# ---------------------------------------------------------------------------
# is_numeric_mcq classifier
# ---------------------------------------------------------------------------

def test_is_numeric_mcq_all_integer_options():
    assert is_numeric_mcq(
        "Қызылорда және Алматы облыстарында ... ұжымшарлар саны:",
        {"A": "57", "B": "55", "C": "50", "D": "47", "E": "60"},
    )


def test_is_numeric_mcq_formula_options_with_calc_stem():
    # id=3698-style: stem gives %C, %H, M=60 and asks for the acid.
    # Options are chemical names, not bare numbers — but the stem is
    # obviously a compute.
    assert is_numeric_mcq(
        "Құрамында 40% көміртек және 6,7% сутек болатын карбон қышқылы. М =60 г/ моль",
        {
            "A": "пентан қышқылы",
            "B": "бутан қышқылы",
            "C": "пропион қышқылы",
            "D": "метан қышқылы",
            "E": "этан қышқылы",
        },
    )


def test_is_numeric_mcq_plain_lookup_question_is_not_numeric():
    assert not is_numeric_mcq(
        "Ткань, образующая кости, хрящи, жиры, сухожилия:",
        {"A": "Эпителиальная", "B": "Соединительная", "C": "Нервная",
         "D": "Костная", "E": "Мышечная"},
    )


# ---------------------------------------------------------------------------
# numeric_guard.run — disagreement should flip triggered=True
# ---------------------------------------------------------------------------

def _fake_oai(json_body: dict) -> MagicMock:
    """Shape-compatible mock of openai.OpenAI used by both guards."""
    msg = MagicMock()
    msg.content = json.dumps(json_body, ensure_ascii=False)
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    client = MagicMock()
    client.chat.completions.create = MagicMock(return_value=resp)
    return client


def test_numeric_guard_triggers_when_solver_disagrees_with_gold():
    # id=3698 shape: computed answer should be C2H4O2 (B would be
    # "бутан қышқылы"? doesn't matter; we just need letter != C).
    row = {
        "id": 3698,
        "language": "kz",
        "subject": "Chemistry",
        "question": (
            "Құрамында 40% көміртек және 6,7% сутек болатын карбон "
            "қышқылы. М =60 г/ моль"
        ),
        "options": {
            "A": "пентан қышқылы",
            "B": "бутан қышқылы",
            "C": "пропион қышқылы",
            "D": "метан қышқылы",
            "E": "этан қышқылы",
        },
        "correct_letter": "C",
        "correct_text": "пропион қышқылы",
    }
    fake = _fake_oai({
        "computed_text": "C2H4O2 (acetic acid, M=60)",
        "computed_letter": "E",  # "этан қышқылы" = acetic = C2H4O2
        "reasoning": "40%C + 6.7%H + 53.3%O, ratio 1:2:1, M=60 -> CH3COOH.",
    })
    findings = run_numeric([row], openai_client=fake)
    assert len(findings) == 1
    f = findings[0]
    assert f["is_numeric"] is True
    assert f["triggered"] is True
    assert f["gold_letter"] == "C"
    assert f["computed_letter"] == "E"


def test_numeric_guard_passes_when_solver_agrees_with_gold():
    # id=22011 shape: p=m*v=5*3=15 => A ("15 кг*м/с")
    row = {
        "id": 22011,
        "language": "kz",
        "subject": "Physics",
        "question": (
            "Дене импульсінің формуласынан, массасы 5 кг болып, 3 м/с "
            "жылдамдықпен қозғалатын дененің импульсі неше кг×м/с-ге тең?"
        ),
        "options": {"A": "15 кг×м/с", "B": "8", "C": "2", "D": "1.5", "E": "10"},
        "correct_letter": "A",
        "correct_text": "15 кг×м/с",
    }
    fake = _fake_oai({
        "computed_text": "15",
        "computed_letter": "A",
        "reasoning": "p = mv = 5*3 = 15.",
    })
    findings = run_numeric([row], openai_client=fake)
    assert findings[0]["is_numeric"] is True
    assert findings[0]["triggered"] is False


def test_numeric_guard_skips_non_numeric_rows():
    row = {
        "id": 30,
        "language": "ru",
        "subject": "Biology",
        "question": "Ткань, образующая кости, хрящи, жиры:",
        "options": {"A": "Эпителиальная", "B": "Соединительная",
                    "C": "Нервная", "D": "Костная", "E": "Мышечная"},
        "correct_letter": "B",
        "correct_text": "Соединительная",
    }
    fake = _fake_oai({})  # should never be called
    findings = run_numeric([row], openai_client=fake)
    assert findings[0]["is_numeric"] is False
    assert findings[0]["triggered"] is False
    fake.chat.completions.create.assert_not_called()


# ---------------------------------------------------------------------------
# numeric_guard.run — DUAL-SOLVER path (Kimi second-solver)
# ---------------------------------------------------------------------------

def _row_3698() -> dict:
    return {
        "id": 3698,
        "language": "kz",
        "subject": "Chemistry",
        "question": (
            "Құрамында 40% көміртек және 6,7% сутек болатын карбон "
            "қышқылы. М =60 г/ моль"
        ),
        "options": {
            "A": "пентан қышқылы",
            "B": "бутан қышқылы",
            "C": "пропион қышқылы",
            "D": "метан қышқылы",
            "E": "этан қышқылы",
        },
        "correct_letter": "C",
        "correct_text": "пропион қышқылы",
    }


def test_dual_solver_both_agree_bad_gold_triggers_3698_shape():
    """Both qwen-max AND Kimi pick E (acetic, C2H4O2, M=60) against
    gold=C. This is the headline case the second-solver was added for."""
    row = _row_3698()
    qwen = _fake_oai({
        "computed_text": "C2H4O2",
        "computed_letter": "E",
        "reasoning": "40%C + 6.7%H + 53.3%O, M=60 → CH3COOH.",
    })
    kimi = _fake_oai({
        "computed_text": "этан қышқылы (acetic)",
        "computed_letter": "E",
        "reasoning": "M=60 forces 2 carbons; acetic acid.",
    })
    findings = run_numeric(
        [row], openai_client=qwen, second_openai_client=kimi,
    )
    f = findings[0]
    assert f["triggered"] is True
    assert f["reason"] == "both_solvers_disagree_with_gold"
    assert f["computed_letter"] == "E"
    assert f["computed_letter_kimi"] == "E"
    assert f["gold_letter"] == "C"


def test_dual_solver_both_agree_with_gold_not_triggered():
    row = _row_3698()
    # Pretend both solvers accept the (buggy) gold.
    qwen = _fake_oai({
        "computed_text": "пропион қышқылы",
        "computed_letter": "C",
        "reasoning": "matches gold",
    })
    kimi = _fake_oai({
        "computed_text": "propionic",
        "computed_letter": "C",
        "reasoning": "matches gold",
    })
    findings = run_numeric([row], openai_client=qwen, second_openai_client=kimi)
    assert findings[0]["triggered"] is False
    assert findings[0]["reason"] == "both_solvers_agree_with_gold"


def test_dual_solver_disagree_with_each_other_triggers_eval_unreliable():
    """Neither solver matches the gold AND they disagree with each other
    — the guard has no trustworthy signal either way → triggered."""
    row = _row_3698()
    qwen = _fake_oai({
        "computed_text": "C2H4O2", "computed_letter": "E",
        "reasoning": "M=60 -> acetic",
    })
    kimi = _fake_oai({
        "computed_text": "C5H10O2", "computed_letter": "A",
        "reasoning": "misread stem",
    })
    findings = run_numeric([row], openai_client=qwen, second_openai_client=kimi)
    f = findings[0]
    assert f["triggered"] is True
    assert f["reason"] == "solver_disagreement"
    assert f["computed_letter"] == "E"
    assert f["computed_letter_kimi"] == "A"


def test_dual_solver_solver_disagree_but_one_matches_gold_ties_to_gold():
    """Companion to the previous test — if the two solvers disagree with
    each other but one of them matches the gold, we trust the gold
    rather than flagging."""
    row = _row_3698()
    qwen = _fake_oai({
        "computed_text": "C2H4O2", "computed_letter": "E",
        "reasoning": "M=60 -> acetic",
    })
    kimi = _fake_oai({
        "computed_text": "propionic", "computed_letter": "C",
        "reasoning": "matches gold",
    })
    findings = run_numeric([row], openai_client=qwen, second_openai_client=kimi)
    f = findings[0]
    assert f["triggered"] is False
    assert f["reason"] == "solvers_partial_agreement_tie_to_gold"


def test_dual_solver_one_matches_gold_tie_goes_to_gold():
    """If qwen disagrees and Kimi agrees with gold, we side with the gold
    to avoid false positives from a misread stem — tracked by the
    `solvers_partial_agreement_tie_to_gold` reason so we can audit the
    split later."""
    row = _row_3698()
    qwen = _fake_oai({
        "computed_text": "wrong",
        "computed_letter": "A",
        "reasoning": "mistake",
    })
    kimi = _fake_oai({
        "computed_text": "propionic",
        "computed_letter": "C",
        "reasoning": "matches gold",
    })
    findings = run_numeric([row], openai_client=qwen, second_openai_client=kimi)
    f = findings[0]
    assert f["triggered"] is False
    assert f["reason"] == "solvers_partial_agreement_tie_to_gold"


def test_dual_solver_kimi_errors_falls_back_to_single_solver():
    """Kimi outage must not escalate — fall back to single-solver rule."""
    row = _row_3698()
    qwen = _fake_oai({
        "computed_text": "C2H4O2", "computed_letter": "E",
        "reasoning": "M=60 -> acetic",
    })
    kimi_broken = MagicMock()
    kimi_broken.chat.completions.create = MagicMock(
        side_effect=RuntimeError("kimi 502 bad gateway")
    )
    findings = run_numeric(
        [row], openai_client=qwen, second_openai_client=kimi_broken,
    )
    f = findings[0]
    # Primary alone disagrees with gold → trigger.
    assert f["triggered"] is True
    # Single-solver branch reason, NOT dual-solver reason.
    assert f["reason"] in (
        "single_solver_disagrees_with_gold",
        "gold_letter_disagrees_with_stem_computation",
    )
    assert "kimi_error" in f


def test_dual_solver_both_error_does_not_trigger():
    row = _row_3698()
    qwen_broken = MagicMock()
    qwen_broken.chat.completions.create = MagicMock(
        side_effect=RuntimeError("dashscope down")
    )
    kimi_broken = MagicMock()
    kimi_broken.chat.completions.create = MagicMock(
        side_effect=RuntimeError("kimi down")
    )
    findings = run_numeric(
        [row], openai_client=qwen_broken, second_openai_client=kimi_broken,
    )
    f = findings[0]
    assert f["triggered"] is False
    assert f["reason"].startswith("solver_error:")


# ---------------------------------------------------------------------------
# _classify_lang (Kazakh-diacritic density)
# ---------------------------------------------------------------------------

def test_classify_lang_kz_from_diacritics():
    assert _classify_lang("Қазақстанның солтүстігі — қар жамылғысы") == "kz"


def test_classify_lang_ru_from_cyrillic_only():
    assert _classify_lang("Соединительная ткань образует кости и хрящи") == "ru"


def test_classify_lang_other_when_no_cyrillic():
    assert _classify_lang("This is English only, no Cyrillic.") == "other"


def test_classify_lang_empty_for_empty_input():
    assert _classify_lang(None) == "empty"
    assert _classify_lang("") == "empty"


# ---------------------------------------------------------------------------
# anchor_cooccurrence.run — end-to-end with fake db + fake openai
# ---------------------------------------------------------------------------

class _FakeCursor:
    """Minimal psycopg2-ish cursor. Returns scripted rows in order per
    SQL-kind (detected by substring matching)."""
    def __init__(self, scripts: dict[str, list]):
        # {"subjects": [rows]} for the subject_lang_ids preload.
        # {"any": [n, n, ...]} for ANY-OR greps, popped per call.
        # {"all": [n, n, ...]} for ALL-AND greps, popped per call.
        self._scripts = {k: list(v) for k, v in scripts.items()}
        self._last: list = []

    def execute(self, sql: str, params: tuple | None = None) -> None:
        s = sql.lower()
        if "from textbooks t" in s and "sample" in s:
            self._last = self._scripts.get("subjects", [])
            return
        # Route by production-SQL shape:
        #   _grep_any wraps its ILIKE clause(s) in parens: "... and (content ilike"
        #   _grep_all does not:                           "... and content ilike"
        if "count(*)" in s and " and (content" in s:
            n = self._scripts["any"].pop(0) if self._scripts.get("any") else 0
            self._last = [{"n": n}]
            return
        if "count(*)" in s and " and content" in s:
            n = self._scripts["all"].pop(0) if self._scripts.get("all") else 0
            self._last = [{"n": n}]
            return
        raise AssertionError(f"Unrouted SQL in fake cursor: {sql!r}")

    def fetchall(self):
        return list(self._last)

    def fetchone(self):
        return self._last[0] if self._last else None


class _FakeConn:
    def __init__(self, scripts: dict[str, list]):
        self._scripts = scripts

    def cursor(self, cursor_factory=None):  # noqa: ARG002
        return _FakeCursor(self._scripts)


def test_anchor_guard_triggers_when_gold_absent_from_same_lang_corpus():
    """Trigger fires when the gold fact is nowhere in EITHER language's
    corpus — the signature of id=8250 (Late-Paleolithic harpoons)."""
    subjects = [
        {"id": 4, "subject": "Biology", "sample": "Қазақ биология оқулығы"},  # kz
        {"id": 9, "subject": "Biology", "sample": "Русская биология учебник"},  # ru
    ]
    # 2 anchors => _grep_any called: 1 same-agg + 1 other-agg + 2 per-anchor-same + 2 per-anchor-other = 6
    # _grep_all called: 1 same-all
    conn = _FakeConn({
        "subjects": subjects,
        "any": [0, 0, 0, 0, 0, 0],   # nothing anywhere
        "all": [0],
    })
    row = {
        "id": 8250,
        "language": "kz",
        "subject": "Biology",
        "question": "Кейінгі палеолитте сүңгілер:",
        "correct_letter": "A",
        "correct_text": "ыңғайлы ілмек",
        "options": {"A": "ыңғайлы ілмек", "B": "қола", "C": "темір",
                    "D": "тас", "E": "ағаш"},
    }
    fake_oai = _fake_oai({"anchors": ["сүңгі", "кейінгі палеолит"]})
    findings = run_anchor([row], openai_client=fake_oai, db_conn=conn)
    f = findings[0]
    assert f["triggered"] is True
    assert f["reason"] == "zero_corpus_coverage_for_gold"
    assert f["anchor_hits_same"] == 0
    assert f["anchor_hits_other"] == 0


def test_anchor_guard_passes_when_gold_present_in_same_lang_corpus():
    subjects = [
        {"id": 208, "subject": "Geography", "sample": "Қазақстан географиясы"},  # kz
    ]
    # Only kz books exist, so other-lang list is empty and _grep_any/
    # _grep_all short-circuit to 0 without executing SQL for those.
    # Actual DB calls in order: any_same_agg, all_same_agg,
    # per-anchor same x2.
    conn = _FakeConn({
        "subjects": subjects,
        "any": [5, 3, 2],
        "all": [2],
    })
    row = {
        "id": 6357,
        "language": "kz",
        "subject": "Geography",
        "question": "Ауаның жер бетіне және ондағы барлық заттарға түсіретін күші",
        "correct_letter": "D",
        "correct_text": "атмосфералық қысым",
        "options": {"A": "ауа", "B": "жел", "C": "бұлт", "D": "атмосфералық қысым", "E": "жауын"},
    }
    fake_oai = _fake_oai({"anchors": ["атмосфералық қысым", "ауа қабаты"]})
    findings = run_anchor([row], openai_client=fake_oai, db_conn=conn)
    f = findings[0]
    assert f["triggered"] is False
    assert f["any_same_matches"] == 5
    assert f["all_same_matches"] == 2
    assert f["anchor_hits_same"] == 2
    assert f["reason"] == "same_lang_corpus_covers_gold"


def test_anchor_guard_short_circuits_when_no_same_lang_corpus():
    """RU Biology has 0 RU books; guard must short-circuit to a
    non-triggered cross-lingual-reliance record without calling qwen-max
    or running any SQL greps."""
    subjects = [
        {"id": 4, "subject": "Biology", "sample": "Қазақ биология оқулығы"},  # kz only
    ]
    conn = _FakeConn({
        "subjects": subjects,
        # Scripts deliberately empty — if greps run, it's a bug.
        "any": [],
        "all": [],
    })
    row = {
        "id": 30,
        "language": "ru",
        "subject": "Biology",
        "question": "Ткань, образующая кости:",
        "correct_letter": "B",
        "correct_text": "Соединительная",
        "options": {"A": "Эпителиальная", "B": "Соединительная", "C": "Нервная",
                    "D": "Костная", "E": "Мышечная"},
    }
    fake_oai = _fake_oai({})  # must NOT be called
    findings = run_anchor([row], openai_client=fake_oai, db_conn=conn)
    f = findings[0]
    assert f["triggered"] is False
    assert f["cross_lang_only"] is True
    assert f["reason"] == "no_same_lang_corpus_available"
    assert f["same_lang_book_count"] == 0
    fake_oai.chat.completions.create.assert_not_called()


def test_anchor_guard_triggers_on_gold_wording_off_when_same_lang_corpus_exists():
    """Signature of id=9019: 4 RU History books exist, but gold
    phrasing never appears in them; it only appears in KZ books. This
    is the MCQ-author-paraphrase-vs-textbook-wording case."""
    subjects = [
        {"id": 11, "subject": "History of Kazakhstan", "sample": "Русская история"},
        {"id": 12, "subject": "History of Kazakhstan", "sample": "Русская история"},
        {"id": 13, "subject": "History of Kazakhstan", "sample": "Русская история"},
        {"id": 14, "subject": "History of Kazakhstan", "sample": "Русская история"},
        {"id": 20, "subject": "History of Kazakhstan", "sample": "Қазақстан тарихы"},
    ]
    # 3 anchors. Same-lang (RU) = 4 books, other (KZ) = 1.
    # any_same_agg=0, all_same_agg=0,
    # any_other_agg=2,
    # per-anchor-same x3 = 0,0,0
    # per-anchor-other x3 = 1,0,0  (only one anchor leaks into KZ books)
    conn = _FakeConn({
        "subjects": subjects,
        "any": [0, 2, 0, 0, 0, 1, 0, 0],
        "all": [0],
    })
    row = {
        "id": 9019,
        "language": "ru",
        "subject": "History of Kazakhstan",
        "question": "Клятвенный союз Хакназара с Бухарским ханом:",
        "correct_letter": "A",
        "correct_text": "клятвенный союз",
        "options": {"A": "клятвенный союз", "B": "военный союз",
                    "C": "торговый договор", "D": "брачный союз", "E": "данничество"},
    }
    fake_oai = _fake_oai({"anchors": ["клятвенный союз", "Хакназар", "Бухарский хан"]})
    findings = run_anchor([row], openai_client=fake_oai, db_conn=conn)
    f = findings[0]
    assert f["triggered"] is True
    assert f["reason"] == "gold_wording_absent_from_same_lang_corpus"
    assert f["anchor_hits_same"] == 0
    assert f["anchor_hits_other"] >= 1


def test_anchor_guard_skip_ids_short_circuits():
    subjects = [
        {"id": 1, "subject": "Chemistry", "sample": "орыс химия оқулығы"},
    ]
    conn = _FakeConn({"subjects": subjects, "any": [], "all": []})
    row = {
        "id": 3698,
        "language": "kz",
        "subject": "Chemistry",
        "question": "...",
        "options": {},
        "correct_letter": "C",
        "correct_text": "пропион қышқылы",
    }
    fake_oai = _fake_oai({})  # must NOT be called
    findings = run_anchor(
        [row], openai_client=fake_oai, db_conn=conn, skip_ids=[3698],
    )
    assert findings[0]["triggered"] is False
    assert findings[0]["reason"] == "skipped_already_flagged_by_numeric_guard"
    fake_oai.chat.completions.create.assert_not_called()
