"""Scrape egovreader.kz WP-Pro-Quiz posts into JSONL.

Context
-------
egovreader.kz hosts a handful of WordPress posts that embed the
wp-advanced-quiz plugin (slug `wpAdvQuizInitList`). Each post renders:
  1) a bit of intro text
  2) an <article> body containing all Q/options/explanations in-line, with
     headings of the form "Вопрос N из TOTAL" (Russian, even on Kazakh
     posts); options are labelled A-E (Latin) or А-Е (Cyrillic A/V/S/D/E).
  3) an inline script with a `json: {qid: {"correct":[0,0,1,0,0], ...}}`
     map that tells us the correct position for each question.

This script:
  - Takes a static POST_MAP (URL -> (subject, language, topic_tag)).
  - Fetches each page (simple urllib, no JS engine needed since all data is SSR).
  - Extracts (question_text, options[A..E], correct_letter, explanation?).
  - De-dupes within page by (Q, options) hash.
  - Writes one JSONL per (subject, language) under
    backend/scripts/egovreader_dump/.

Output rows (JSONL, one per line):
    {
      "source_url":      <post URL>,
      "post_slug":       <slug>,
      "ego_qid":         <plugin qid>,
      "idx_in_post":     <1..N>,
      "subject":         <canonical English subject>,
      "language":        "ru" | "kz",
      "topic_tag":       "<subject> > <topic>",
      "question":        <cleaned Q text>,
      "options":         {"A": "...", "B": "...", ...},
      "correct_letter":  "A" | ... | "E",
      "explanation":     <str|None>,
    }

ASCII-only stdout (Windows cmd mojibake rule).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parents[2]
DUMP_DIR = REPO / "backend" / "scripts" / "egovreader_dump"
DUMP_DIR.mkdir(parents=True, exist_ok=True)


UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


# Curated map of WP-Pro-Quiz ENT-aligned posts.
# Anything not in this map is ignored.
POST_MAP: list[dict[str, str]] = [
    {
        "url": "https://egovreader.kz/testy-ent-po-matematicheskoj-gramotnosti/",
        "subject": "Mathematical Literacy",
        "language": "ru",
        "topic": "ent_practice",
    },
    {
        "url": "https://egovreader.kz/kontekstnye-zadaniya-po-matematike/",
        "subject": "Mathematical Literacy",
        "language": "ru",
        "topic": "contextual_math",
    },
    {
        "url": "https://egovreader.kz/test-po-istorii-kazahstana-dlya-podgotovki-k-ent/",
        "subject": "History of Kazakhstan",
        "language": "ru",
        "topic": "ent_practice",
    },
    {
        "url": "https://egovreader.kz/2-nuska-kazakstan-tarihy-p-ninen-test-suratkary/",
        "subject": "History of Kazakhstan",
        "language": "kz",
        "topic": "nuska_2",
    },
    {
        "url": "https://egovreader.kz/3-nuska-kazakstan-tarihy-paninen-test-suratkary/",
        "subject": "History of Kazakhstan",
        "language": "kz",
        "topic": "nuska_3",
    },
    {
        "url": "https://egovreader.kz/azahstan-tarihy-p-ninen-test-s-ra-tary-1-n-s-a/",
        "subject": "History of Kazakhstan",
        "language": "kz",
        "topic": "nuska_1",
    },
    {
        "url": "https://egovreader.kz/test-po-anglijskomu-yazyku-nachalnyj-uroven/",
        "subject": "English",
        "language": "ru",
        "topic": "beginner",
    },
]


# Normalise common zero-width / narrow-space gunk. Matches the SdamGIA pipeline.
_SCRUB_CHARS = str.maketrans(
    {
        "\u00ad": "",  # soft hyphen
        "\u202f": " ",  # narrow NBSP
        "\u2009": " ",  # thin space
        "\u00a0": " ",  # NBSP
    }
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").translate(_SCRUB_CHARS)).strip()


def _hash(question: str, options: dict[str, str]) -> str:
    keys = sorted(options)
    opts_joined = "|".join(f"{k}:{_norm(options[k]).lower()}" for k in keys)
    h = hashlib.sha256()
    h.update(_norm(question).lower().encode("utf-8"))
    h.update(b"||")
    h.update(opts_joined.encode("utf-8"))
    return h.hexdigest()[:40]


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept-Language": "ru-RU,ru;q=0.9",
        },
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #


def _extract_correct_map(html: str) -> dict[int, int]:
    """Return {qid -> 0-based correct position} from wpAdvQuizInitList blob."""
    m = re.search(r"wpAdvQuizInitList.*?push\(\{([\s\S]*?)\}\);", html)
    if not m:
        return {}
    blob = m.group(1)
    jstart = blob.find("json:")
    if jstart < 0:
        return {}
    brace = blob.find("{", jstart)
    depth = 0
    i = brace
    end = -1
    while i < len(blob):
        c = blob[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
        i += 1
    if end < 0:
        return {}
    obj = blob[brace : end + 1]
    # Keys are sometimes unquoted ints; normalise to quoted.
    obj_n = re.sub(r'([{,])\s*"?(\d+)"?\s*:', r'\1"\2":', obj)
    try:
        data = json.loads(obj_n)
    except Exception:
        return {}
    out: dict[int, int] = {}
    # Preserve insertion order of the original blob to match on-page order.
    for qid_s, v in data.items():
        arr = v.get("correct", [])
        try:
            pos = arr.index(1)
        except ValueError:
            pos = -1
        out[int(qid_s)] = pos
    return out


# Option letters: Latin A-E plus Cyrillic А (U+0410) В (U+0412) С (U+0421)
# Е (U+0415). D is only Latin. Cyrillic range А-Е only covers А..Е (U+0410..
# U+0415) so it misses С (U+0421) — we have to spell the Cyrillic set out
# explicitly.
_OPT_LETTERS = r"ABCDEАВСЕabcdeавсе"  # no D-cyrillic; lowercase for safety
_OPT_RE = re.compile(
    rf"([{_OPT_LETTERS}])\s*[\)\.]\s*(.*?)"
    rf"\s*(?=[{_OPT_LETTERS}]\s*[\)\.]|Правильно|Неправильно|$)",
    re.DOTALL,
)


def _cyrillic_to_latin_letter(ch: str) -> str:
    """Normalise Cyrillic А/В/С/Е to Latin A/B/C/E. D only Latin."""
    return {
        "А": "A",
        "а": "A",
        "В": "B",
        "в": "B",
        "С": "C",
        "с": "C",
        "Е": "E",
        "е": "E",
    }.get(ch, ch.upper())


def _split_questions_from_article(text: str) -> list[dict[str, Any]]:
    """Break article plaintext by 'Вопрос N из M'.

    Returns a list of dicts {idx, question, options, explanation} where
    `options` is {A: ..., B: ..., ...}.
    """
    text = _norm(text)
    parts = re.split(r"Вопрос\s+\d+\s+из\s+\d+", text)
    out: list[dict[str, Any]] = []
    for idx, chunk in enumerate(parts[1:], start=1):
        # Strip the prefix "N . Вопрос N." (both variants N = position and the
        # quiz-internal number).
        c = re.sub(r"^\s*\d+\s*\.\s*Вопрос\s+\d+\s*[\.\:]\s*", "", chunk)
        # Find the first option letter to split Q text from option region.
        m_first = re.search(rf"[{_OPT_LETTERS}]\s*[\)\.]\s+", c)
        if not m_first:
            continue
        q_text = _norm(c[: m_first.start()]).rstrip(".?! ")
        # Tail: from first option letter
        tail = c[m_first.start() :]
        # Cut at "Правильно Неправильно" (plugin's answer-state label)
        stop = re.search(r"Правильно\s+Неправильно", tail)
        opts_region = tail[: stop.start()] if stop else tail
        after = tail[stop.end() :] if stop else ""

        options: dict[str, str] = {}
        for m in _OPT_RE.finditer(opts_region):
            letter = _cyrillic_to_latin_letter(m.group(1))
            val = _norm(m.group(2))
            if not val:
                continue
            if letter not in options:
                options[letter] = val
        # Explanation: anything after "Объяснение:"
        expl: str | None = None
        m_ex = re.search(r"Объяснение\s*:?\s*(.*?)$", after, re.DOTALL)
        if m_ex:
            expl = _norm(m_ex.group(1)) or None
        out.append(
            {
                "idx": idx,
                "question": q_text,
                "options": options,
                "explanation": expl,
            }
        )
    return out


# --------------------------------------------------------------------------- #
# per-post pipeline
# --------------------------------------------------------------------------- #


def process_post(entry: dict[str, str]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    url = entry["url"]
    subject = entry["subject"]
    language = entry["language"]
    topic = entry["topic"]

    slug = url.rstrip("/").split("/")[-1]
    stats = {
        "fetched": 0,
        "parsed": 0,
        "dropped_no_opts": 0,
        "dropped_bad_opts": 0,
        "dropped_no_correct": 0,
        "dropped_dupe_in_post": 0,
        "kept": 0,
    }
    raw = fetch(url)
    stats["fetched"] = 1
    html = raw.decode("utf-8", errors="replace")

    correct_map = _extract_correct_map(html)
    qids = list(correct_map.keys())  # insertion order

    soup = BeautifulSoup(html, "html.parser")
    article = soup.find("article") or soup
    art_text = article.get_text(" ", strip=True)
    questions = _split_questions_from_article(art_text)
    stats["parsed"] = len(questions)

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, q in enumerate(questions):
        opts = q["options"]
        if len(opts) < 3:
            stats["dropped_no_opts"] += 1
            continue
        # Validate option keys: must be subset of {A..E}
        if any(k not in "ABCDE" for k in opts):
            stats["dropped_bad_opts"] += 1
            continue

        qid = qids[i] if i < len(qids) else None
        pos = correct_map.get(qid) if qid else None
        if pos is None or pos < 0 or pos >= len(opts):
            # fall back: if only pos>=4 but len(opts)==4, drop; else mark bad.
            stats["dropped_no_correct"] += 1
            continue
        # Map position -> letter based on sorted option keys present
        # (the position is from the plugin's original 0..4 answer list; when
        # we see only 4 options the 5th simply isn't rendered. We keep the
        # mapping letter-wise because the plugin preserves slot ordering.)
        sorted_letters = sorted(opts)
        if pos >= len(sorted_letters):
            stats["dropped_no_correct"] += 1
            continue
        letter = sorted_letters[pos]
        # but sorted alphabetically matches 0->A, 1->B, ... which is exactly
        # what the plugin's correct[] array encodes.

        h = _hash(q["question"], opts)
        if h in seen:
            stats["dropped_dupe_in_post"] += 1
            continue
        seen.add(h)

        rows.append(
            {
                "source_url": url,
                "post_slug": slug,
                "ego_qid": qid,
                "idx_in_post": q["idx"],
                "subject": subject,
                "language": language,
                "topic_tag": f"{subject} > egovreader/{topic}",
                "question": q["question"],
                "options": opts,
                "correct_letter": letter,
                "explanation": q["explanation"],
            }
        )
        stats["kept"] += 1
    return rows, stats


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-dir", default=str(DUMP_DIR))
    ap.add_argument("--only", default=None, help="substring filter on URL to process subset")
    args = ap.parse_args()

    dump_dir = Path(args.dump_dir)
    dump_dir.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict[str, Any]] = []
    total_stats: dict[str, int] = {}
    print(f"posts to scrape: {len(POST_MAP)}")
    for entry in POST_MAP:
        if args.only and args.only not in entry["url"]:
            continue
        slug = entry["url"].rstrip("/").split("/")[-1]
        print(f"\n  -> {slug}  ({entry['subject']} / {entry['language']})")
        try:
            rows, stats = process_post(entry)
        except Exception as e:
            print(f"     ERROR: {e!r}")
            continue
        for k, v in stats.items():
            total_stats[k] = total_stats.get(k, 0) + v
        print(
            f"     parsed={stats['parsed']}  kept={stats['kept']}  "
            f"dropped_no_opts={stats['dropped_no_opts']} "
            f"dropped_no_correct={stats['dropped_no_correct']} "
            f"dropped_dupe={stats['dropped_dupe_in_post']}"
        )
        all_rows.extend(rows)

    # Group by (subject, language) and write
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in all_rows:
        buckets.setdefault((r["subject"], r["language"]), []).append(r)
    for (subj, lang), rs in sorted(buckets.items()):
        slug = subj.lower().replace(" ", "_")
        out = dump_dir / f"{slug}_{lang}.jsonl"
        out.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rs),
            encoding="utf-8",
        )
        print(f"  wrote {out.name}: {len(rs)} rows")

    print("\n=== TOTAL ===")
    for k, v in total_stats.items():
        print(f"  {k:<25} {v}")
    print(f"  rows_total:              {len(all_rows)}")

    # Summary JSON
    (dump_dir / "parse_summary.json").write_text(
        json.dumps(
            {
                "posts": len(POST_MAP),
                "stats": total_stats,
                "rows": len(all_rows),
                "by_bucket": {f"{s}|{l}": len(rs) for (s, l), rs in buckets.items()},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
