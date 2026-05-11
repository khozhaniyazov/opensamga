"""Numeric-MCQ gold-label sanity check.

Many of the "wrong" verdicts surfaced in the session-22 rag-eval pilot
were not RAG bugs but MCQ authoring errors: a stem that is arithmetic,
where the gold option is mathematically inconsistent with the stem
itself. Example: id=3698 provides M=60 g/mol + 40%C + 6.7%H and asks
for the carboxylic acid; those inputs unambiguously give C2H4O2 (acetic,
M=60), yet the gold is "пропион қышқылы" (C3H6O2, M=74). No retrieval
change can fix a question whose own gold violates its own stem.

This guard re-solves the stem with qwen-max (no retrieval, no RAG) and
flags Qs whose computed answer disagrees with the recorded gold. Those
Qs should be excluded from the reliable subset of the golden set until
an author fixes the gold (or confirms it with a citation).

Detector policy — a Q is numeric-MCQ when AT LEAST ONE of:
  (a) >= 3 of the options parse as bare numbers (optionally with a
      short unit suffix), OR
  (b) the question stem contains a calculation keyword (RU+KZ) AND at
      least one option parses as numeric.

The solver prompts qwen-max in strict-JSON mode and takes the returned
``computed_letter``; it is compared to the recorded ``correct_letter``.

Return value: list[dict] with keys::

    id, is_numeric, triggered, computed_letter, computed_text,
    reason, raw

``triggered`` is True iff ``is_numeric`` is True AND the computed letter
disagrees with the gold (or the solver is confident its computed value
differs from the gold text).

This module is deliberately import-light so it unit-tests cleanly with
a fake OpenAI client.
"""
from __future__ import annotations

import json
import re
from typing import Any

# Calc-intent keywords in Russian and Kazakh. These trigger the numeric
# classification even if the options don't all look numeric, because
# MCQ authors sometimes express the answer as a formula or a short
# chemical name that still hinges on a numeric computation (e.g. 3698:
# options are acid names, but the whole Q is %mass + M -> which acid).
_CALC_KEYWORDS = (
    # Russian
    "вычисл", "рассчит", "равна", "равно", "найдите", "чему равен",
    "определите массу", "определите объем", "определите количество",
    "масса", "объем", "количество", "формул",
    # Kazakh
    "есепте", "тең", "табыңыз", "неше", "анықта",
    "массасы", "көлемі",
)

_NUMERIC_OPT_RE = re.compile(
    r"""
    ^\s*
    [-+]?            # optional sign
    \d+              # integer part
    (?:[.,]\d+)?     # optional decimal, either '.' or ','
    \s*
    [A-Za-zА-Яа-яёЁәғқңөұүһі·°²³/\-]*   # optional unit tail
    \s*$
    """,
    re.VERBOSE,
)

# Chemical-formula-ish options (e.g. C2H4O2, CH3COOH). A question whose
# stem computes a molecular formula from %mass + M is still a numeric-
# calc Q even if the options aren't bare numbers.
_FORMULA_OPT_RE = re.compile(
    r"^[A-Z][A-Za-z0-9()\s=+\-]{2,}$"
)


def is_numeric_mcq(question: str, options: dict[str, str]) -> bool:
    """Heuristic classifier; see module docstring."""
    numeric_opts = sum(
        1 for v in options.values()
        if isinstance(v, str) and _NUMERIC_OPT_RE.match(v.strip())
    )
    if numeric_opts >= 3:
        return True

    q_lower = (question or "").lower()
    has_calc_kw = any(kw in q_lower for kw in _CALC_KEYWORDS)
    has_any_numeric = numeric_opts >= 1 or any(
        isinstance(v, str) and _FORMULA_OPT_RE.match(v.strip())
        for v in options.values()
    )
    if has_calc_kw and has_any_numeric:
        return True

    # Stem has explicit numbers with units AND the options enumerate
    # numeric or formula-looking values — catches stems like
    # "M=60, 40% C, 6.7% H — which carboxylic acid?".
    stem_has_numbers = bool(
        re.search(r"\d+\s*(?:%|г/?\s*моль|г|моль|кг|м/с|см|км|°C)",
                  question or "",
                  flags=re.IGNORECASE)
    )
    formula_opts = sum(
        1 for v in options.values()
        if isinstance(v, str) and _FORMULA_OPT_RE.match(v.strip())
    )
    if stem_has_numbers and (numeric_opts + formula_opts) >= 2:
        return True

    # Last-ditch: a stem with BOTH a percent-mass indicator AND a molar
    # mass / molar-quantity indicator is always a stoichiometry compute,
    # even when the options are chemical names (as in id=3698:
    # "40% көміртек ... М=60 г/моль ... карбон қышқылы").
    has_percent = bool(re.search(r"\d+[.,]?\d*\s*%", question or ""))
    has_molar = bool(
        re.search(
            r"(?:\bм\s*=\s*\d|\bm\s*=\s*\d|г\s*/\s*моль|моль|моляр)",
            question or "",
            flags=re.IGNORECASE,
        )
    )
    if has_percent and has_molar:
        return True

    return False


_SOLVER_PROMPT_RU = """Ты — независимый проверяющий численно-расчётных задач.

Реши задачу, ИСПОЛЬЗУЯ ТОЛЬКО условие. Не ищи ничего в учебниках.
Вычисли ответ от первого принципа (формулы, стехиометрия, алгебра).

После решения выбери единственную букву из опций, которая лучше всего
соответствует твоему вычислению. Если ни одна опция не соответствует,
верни "letter": null.

Верни СТРОГО JSON:
{{"computed_text": "<число или короткое значение>",
  "computed_letter": "A|B|C|D|E|null",
  "reasoning": "<1-2 предложения>"}}

ЗАДАЧА:
{question}

ВАРИАНТЫ:
{options_block}
"""

_SOLVER_PROMPT_KZ = """Сен — есептеу есептерін тәуелсіз тексеруші.

Есепті ТЕК шарт бойынша шеш. Оқулықтардан ешнәрсе іздеме. Бірінші
принциптерден есептеп шық (формулалар, стехиометрия, алгебра).

Содан кейін сенің есебіңе ЕҢ ЖАҚСЫ СӘЙКЕС КЕЛЕТІН бір әріпті нұсқалардан
таңда. Егер ешқайсысы сәйкес келмесе, "letter": null деп қайтар.

ТЕК JSON қайтар:
{{"computed_text": "<сан немесе қысқа мән>",
  "computed_letter": "A|B|C|D|E|null",
  "reasoning": "<1-2 сөйлем>"}}

ЕСЕП:
{question}

НҰСҚАЛАР:
{options_block}
"""


def _solve_one(row: dict, *, openai_client, model: str = "qwen-max") -> dict:
    """Single-solver pass. Works against any OpenAI-compatible client —
    qwen-max on DashScope and moonshot-v1-128k on Kimi are wire-compatible."""
    options_block = "\n".join(
        f"  {letter}) {text}" for letter, text in row["options"].items()
    )
    tpl = _SOLVER_PROMPT_KZ if row.get("language") == "kz" else _SOLVER_PROMPT_RU
    prompt = tpl.format(question=row["question"], options_block=options_block)
    resp = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Return only strict JSON."},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
        max_tokens=400,
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
    letter = data.get("computed_letter")
    if isinstance(letter, str):
        letter = letter.strip().upper() or None
    if letter == "NULL":
        letter = None
    return {
        "computed_text": (data.get("computed_text") or "")[:200],
        "computed_letter": letter,
        "reasoning": (data.get("reasoning") or "")[:400],
        "raw": raw[:1500],
    }


def _decide_trigger(
    gold_letter: str | None,
    primary: dict | None,
    secondary: dict | None,
) -> tuple[bool, str]:
    """Merge primary (qwen-max) + optional secondary (Kimi) solver votes
    into a (triggered, reason) tuple.

    Rules:
      * No secondary solver → fall back to the single-solver mismatch
        rule (backward-compatible with session-23 behavior).
      * Both solvers returned a letter:
          - both agree with gold               → not triggered
          - both agree with each other but NOT gold
                                               → triggered
                                                  (high-confidence bad gold —
                                                  the 3698-shape escape)
          - they disagree with each other      → triggered
                                                  (eval-unreliable — neither
                                                  vote is trustworthy)
          - one agrees with gold, one does not → not triggered
                                                  (tie-goes-to-gold; cheap
                                                  way to avoid false positives
                                                  when a solver misreads the
                                                  stem)
      * Only one solver returned a letter → use that alone against the
        gold (same as single-solver rule).
    """
    p_letter = (primary or {}).get("computed_letter")
    s_letter = (secondary or {}).get("computed_letter") if secondary else None

    def _disagrees(a: str | None) -> bool:
        return bool(a and gold_letter and a != gold_letter)

    if secondary is None:
        return (_disagrees(p_letter),
                "gold_letter_disagrees_with_stem_computation"
                if _disagrees(p_letter) else "solver_agrees_with_gold")

    # Dual-solver path
    if p_letter and s_letter:
        p_matches = p_letter == gold_letter
        s_matches = s_letter == gold_letter
        if p_matches and s_matches:
            return (False, "both_solvers_agree_with_gold")
        if p_letter == s_letter and not p_matches:
            # Both solvers independently picked the same wrong letter —
            # highest-confidence bad-gold signal we can get.
            return (True, "both_solvers_disagree_with_gold")
        if p_matches or s_matches:
            # At least one solver accepts the gold → tie goes to gold so
            # we don't falsely flag rows where one solver simply misread
            # the stem.
            return (False, "solvers_partial_agreement_tie_to_gold")
        # Neither matches the gold AND they don't match each other:
        # the guard has no trustworthy signal either way — flag eval-
        # unreliable so the Q gets excluded from the live eval.
        return (True, "solver_disagreement")

    # Only one solver gave a usable letter.
    lone = p_letter or s_letter
    return (_disagrees(lone),
            "single_solver_disagrees_with_gold"
            if _disagrees(lone) else "single_solver_agrees_with_gold")


def run(
    golden_rows: list[dict],
    *,
    openai_client,
    model: str = "qwen-max",
    second_openai_client=None,
    second_model: str = "moonshot-v1-128k",
) -> list[dict]:
    """Audit each row. Returns list of findings (one per row), even for
    rows that aren't numeric — so callers can zip by index.

    When `second_openai_client` is provided, the guard runs a dual-solver
    cross-check (see `_decide_trigger` for the decision rules). The
    second solver is expected to be a Kimi / Moonshot OpenAI-compatible
    client configured with base_url="https://api.moonshot.ai/v1"."""
    findings: list[dict] = []
    for row in golden_rows:
        qid = row.get("id")
        numeric = is_numeric_mcq(row.get("question", ""), row.get("options", {}) or {})
        if not numeric:
            findings.append({
                "id": qid,
                "guard": "numeric",
                "is_numeric": False,
                "triggered": False,
                "reason": "not_a_numeric_mcq",
            })
            continue

        primary = None
        primary_err: str | None = None
        try:
            primary = _solve_one(row, openai_client=openai_client, model=model)
        except Exception as exc:  # noqa: BLE001
            primary_err = f"{exc.__class__.__name__}: {str(exc)[:200]}"

        secondary = None
        secondary_err: str | None = None
        if second_openai_client is not None:
            try:
                secondary = _solve_one(
                    row, openai_client=second_openai_client, model=second_model
                )
            except Exception as exc:  # noqa: BLE001
                secondary_err = f"{exc.__class__.__name__}: {str(exc)[:200]}"

        # If BOTH solvers errored (or only one configured and it errored),
        # bail with solver_error — keep row eval-reliable (guard had no
        # signal). This matches the pre-dual-solver behavior.
        if primary is None and (secondary is None):
            findings.append({
                "id": qid,
                "guard": "numeric",
                "is_numeric": True,
                "triggered": False,
                "reason": f"solver_error:{primary_err or 'unknown'}",
                "error": primary_err,
            })
            continue

        gold_letter = (row.get("correct_letter") or "").split(",")[0].strip().upper()
        triggered, reason = _decide_trigger(gold_letter, primary, secondary)

        finding: dict[str, Any] = {
            "id": qid,
            "guard": "numeric",
            "is_numeric": True,
            "triggered": triggered,
            "gold_letter": gold_letter,
            "reason": reason,
        }
        if primary is not None:
            finding.update({
                "computed_letter": primary.get("computed_letter"),
                "computed_text": primary.get("computed_text"),
                "reasoning": primary.get("reasoning"),
            })
        if primary_err:
            finding["primary_error"] = primary_err
        if secondary is not None:
            finding.update({
                "computed_letter_kimi": secondary.get("computed_letter"),
                "computed_text_kimi": secondary.get("computed_text"),
                "reasoning_kimi": secondary.get("reasoning"),
            })
        if secondary_err:
            finding["kimi_error"] = secondary_err

        findings.append(finding)
    return findings
