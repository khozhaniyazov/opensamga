"""Anchor-phrase co-occurrence guard.

For each non-numeric lookup Q, ask qwen-max to produce 3-5 verbatim
anchor phrases that a textbook chunk supporting the gold answer would
contain. Then ILIKE-probe the same-language subject-scoped subset of
``textbook_chunks`` and confirm that the anchors co-occur in at least
one chunk.

If zero chunks contain even one anchor in the same language, the Q is
eval-unreliable: either the gold is wrong (id=9019 "одақтық шарт" vs
"клятвенный союз") or the gold is out-of-corpus (id=8250 Late-Paleolithic
harpoons).  In both cases the RAG stack cannot be fairly scored against
this Q.

Policy (per Q):

  * Extract anchors from ``{question, correct_text, options}``.
  * Detect per-book language from a sample chunk (Kazakh-diacritic
    density), cache in ``subject_lang_ids``.
  * Same-language strict grep: how many chunks match ANY anchor.
  * Same-language co-occurrence grep: at least one chunk matching ALL
    anchors simultaneously.
  * Trigger if BOTH strict AND co-occurrence return zero.
    (Strict zero alone is enough for short-anchor cases; co-occurrence
    zero is a weaker but complementary signal when anchors individually
    exist but never together.)

``run`` accepts a live ``db_conn`` from ``psycopg2`` OR a lightweight
mock object exposing ``.cursor(cursor_factory=...)``. For unit tests a
stub cursor is fine; see ``test_guards.py``.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable

import psycopg2.extras  # type: ignore


_KZ_LETTERS = set("әғқңөұүһі")


def _classify_lang(sample: str | None) -> str:
    if not sample:
        return "empty"
    t = sample.lower()
    kz_hits = sum(1 for c in t if c in _KZ_LETTERS)
    cyr_chars = len(re.findall(r"[а-яәғқңөұүһі]", t))
    if cyr_chars == 0:
        return "other"
    return "kz" if (kz_hits / max(1, cyr_chars)) > 0.01 else "ru"


_ANCHOR_PROMPT = """You are auditing a bilingual (ru/kz) UNT-exam RAG system.

Given a multiple-choice question plus its CORRECT answer, produce 3 to 5
SHORT anchor phrases that a textbook passage covering this answer
would contain.

STRICT RULES:
  1. Each anchor is ONE TO THREE words max. No full sentences.
  2. Same language as the question (ru or kz).
  3. Avoid generic single stop-words. Each anchor should either name
     the SUBJECT (the thing the question is about) or the ANSWER term.
  4. Do NOT concatenate the answer with the question into one long
     phrase. Keep each anchor focused on one concept.
  5. Prefer textbook-typical wording, not MCQ-author paraphrase.
  6. Return STRICT JSON: {"anchors": ["phrase1", "phrase2", ...]}.

Example (Q about "touring yeast fermentation -> CO2"):
  GOOD: ["ашытқы саңырауқұлағы", "көмірқышқыл газ", "ашыту"]
  BAD (too long): ["ашытқы саңырауқұлағы көмірқышқыл газ бөледі"]

Question: %QUESTION%
Correct letter: %GOLD_LETTER%
Correct answer text: %GOLD_TEXT%
All options: %OPTIONS%
Language: %LANG%
"""


def extract_anchors(
    row: dict,
    *,
    openai_client,
    model: str = "qwen-max",
) -> list[str]:
    prompt = (
        _ANCHOR_PROMPT
        .replace("%QUESTION%", row.get("question", ""))
        .replace("%GOLD_LETTER%", str(row.get("correct_letter", "")))
        .replace("%GOLD_TEXT%", str(row.get("correct_text", "")))
        .replace("%OPTIONS%", json.dumps(row.get("options", {}), ensure_ascii=False))
        .replace("%LANG%", row.get("language", "ru"))
    )
    resp = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Return only strict JSON."},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=300,
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
    anchors_raw = data.get("anchors", [])
    cleaned: list[str] = []
    for a in anchors_raw:
        if not isinstance(a, str):
            continue
        s = a.strip().strip('"').strip("'")
        if not s:
            continue
        # Reject overly long anchors — they won't ILIKE-match in practice.
        # 4 words is a conservative cap; textbook phrasing rarely needs more.
        if len(s.split()) > 4:
            continue
        cleaned.append(s)
    return cleaned


def _load_subject_lang_ids(db_conn) -> dict[tuple[str, str], list[int]]:
    """Returns {(subject, lang): [textbook_id, ...]}. Language is
    sampled from an offset chunk per book (to avoid title-page noise)."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT t.id, t.subject, "
        "(SELECT content FROM textbook_chunks c "
        "  WHERE c.textbook_id=t.id ORDER BY c.page_number "
        "  LIMIT 1 OFFSET 20) AS sample "
        "FROM textbooks t "
        "WHERE t.subject IN "
        "('Biology','Chemistry','Physics','Geography','History of Kazakhstan')"
    )
    out: dict[tuple[str, str], list[int]] = {}
    for r in cur.fetchall():
        lang = _classify_lang(r["sample"])
        out.setdefault((r["subject"], lang), []).append(r["id"])
    return out


def _grep_any(cur, book_ids: list[int], anchors: list[str]) -> int:
    if not book_ids or not anchors:
        return 0
    # Single SQL — OR'd ILIKE over anchors — returns a COUNT.
    where = " OR ".join(["content ILIKE %s"] * len(anchors))
    params = [book_ids] + [f"%{a}%" for a in anchors]
    cur.execute(
        f"SELECT COUNT(*)::int AS n FROM textbook_chunks "
        f"WHERE textbook_id = ANY(%s) AND ({where})",
        tuple(params),
    )
    return cur.fetchone()["n"]


def _grep_all(cur, book_ids: list[int], anchors: list[str]) -> int:
    """Co-occurrence: a single chunk containing ALL anchors."""
    if not book_ids or not anchors:
        return 0
    where = " AND ".join(["content ILIKE %s"] * len(anchors))
    params = [book_ids] + [f"%{a}%" for a in anchors]
    cur.execute(
        f"SELECT COUNT(*)::int AS n FROM textbook_chunks "
        f"WHERE textbook_id = ANY(%s) AND {where}",
        tuple(params),
    )
    return cur.fetchone()["n"]


# Characters to strip when probing the gold_text substring — textbook
# chunks have periodic punctuation noise after OCR.
_GOLD_NORMALIZE_RE = re.compile(r"[.,;:!?()\[\]\"'«»—\-–]+")


def _normalize_gold(text: str) -> str:
    if not text:
        return ""
    return _GOLD_NORMALIZE_RE.sub(" ", text).strip().lower()


def _gold_text_present(cur, book_ids: list[int], gold_text: str) -> int:
    """Count chunks whose content contains the literal gold answer text
    (normalized). Uses ILIKE, so case-insensitive."""
    normalized = _normalize_gold(gold_text)
    if not book_ids or not normalized or len(normalized) < 3:
        return 0
    cur.execute(
        "SELECT COUNT(*)::int AS n FROM textbook_chunks "
        "WHERE textbook_id = ANY(%s) AND content ILIKE %s",
        (book_ids, f"%{normalized}%"),
    )
    row = cur.fetchone()
    return row["n"] if row else 0


def run(
    golden_rows: list[dict],
    *,
    openai_client,
    db_conn,
    model: str = "qwen-max",
    skip_ids: Iterable[int] | None = None,
) -> list[dict]:
    """For each row, compute anchor co-occurrence in same-language corpus.

    ``skip_ids`` lets callers skip rows already flagged triggered by the
    numeric guard (no point spending another qwen-max call on them).
    """
    skip = set(skip_ids or ())
    subj_lang_ids = _load_subject_lang_ids(db_conn)
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    findings: list[dict] = []
    for row in golden_rows:
        qid = row.get("id")
        if qid in skip:
            findings.append({
                "id": qid,
                "guard": "anchor_cooccurrence",
                "triggered": False,
                "reason": "skipped_already_flagged_by_numeric_guard",
            })
            continue

        subject = row.get("subject")
        lang = row.get("language", "ru")
        same_ids = subj_lang_ids.get((subject, lang), [])
        other_lang = "ru" if lang == "kz" else "kz"
        other_ids = subj_lang_ids.get((subject, other_lang), [])

        # Short-circuit: if the library has ZERO books in this
        # language/subject bucket, the RAG stack is (by architectural
        # choice) relying on cross-lingual retrieval. We can't grade
        # "gold absent from same-lang corpus" as a Q-authoring error
        # in that case. Skip the guard for this row.
        if not same_ids:
            findings.append({
                "id": qid,
                "guard": "anchor_cooccurrence",
                "triggered": False,
                "cross_lang_only": True,
                "reason": "no_same_lang_corpus_available",
                "same_lang_book_count": 0,
                "other_lang_book_count": len(other_ids),
            })
            continue

        try:
            anchors = extract_anchors(row, openai_client=openai_client, model=model)
        except Exception as exc:  # noqa: BLE001
            findings.append({
                "id": qid,
                "guard": "anchor_cooccurrence",
                "triggered": False,
                "reason": f"anchor_extractor_error:{exc.__class__.__name__}",
                "error": str(exc)[:200],
            })
            continue

        if not anchors:
            findings.append({
                "id": qid,
                "guard": "anchor_cooccurrence",
                "triggered": False,
                "reason": "no_anchors_returned",
            })
            continue

        any_same = _grep_any(cur, same_ids, anchors)
        all_same = _grep_all(cur, same_ids, anchors)
        any_other = _grep_any(cur, other_ids, anchors)

        # Per-anchor probing: how many anchors individually hit somewhere.
        anchor_hits_same = sum(
            1 for a in anchors if _grep_any(cur, same_ids, [a]) > 0
        )
        anchor_hits_other = sum(
            1 for a in anchors if _grep_any(cur, other_ids, [a]) > 0
        )

        # Trigger logic (conservative). Two families of hard triggers:
        #   (1) Zero corpus coverage anywhere — gold fact is nowhere in
        #       the library (ids 8250/8342-style). Impossible to grade
        #       fairly.
        #   (2) "Meaningful same-lang corpus exists, gold-phrasing is
        #       absent from it" — i.e. same_lang_book_count >= 3 and
        #       anchor_hits_same == 0. Signature of id=9019 ("клятвенный
        #       союз" gold vs "одақтық шарт" textbook) and id=12241
        #       (optics projector terminology). Tiny same-lang corpora
        #       (< 3 books) do NOT trigger — they're the cross-lingual
        #       reliance case where a miss is architectural, not
        #       authoring (id=7283 shape).
        zero_anywhere = (anchor_hits_same == 0 and anchor_hits_other == 0)
        gold_wording_off = (
            anchor_hits_same == 0
            and anchor_hits_other > 0
            and len(same_ids) >= 3
        )
        triggered = zero_anywhere or gold_wording_off
        cross_lang_only = (
            not triggered
            and anchor_hits_same == 0
            and anchor_hits_other > 0
        )

        if zero_anywhere:
            reason = "zero_corpus_coverage_for_gold"
        elif gold_wording_off:
            reason = "gold_wording_absent_from_same_lang_corpus"
        elif cross_lang_only:
            reason = "gold_only_in_other_lang_corpus"
        else:
            reason = "same_lang_corpus_covers_gold"

        findings.append({
            "id": qid,
            "guard": "anchor_cooccurrence",
            "triggered": triggered,
            "cross_lang_only": cross_lang_only,
            "anchors": anchors,
            "same_lang_book_count": len(same_ids),
            "other_lang_book_count": len(other_ids),
            "any_same_matches": any_same,
            "all_same_matches": all_same,
            "any_other_matches": any_other,
            "anchor_hits_same": anchor_hits_same,
            "anchor_hits_other": anchor_hits_other,
            "reason": reason,
        })
    return findings
