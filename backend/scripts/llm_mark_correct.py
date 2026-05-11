"""Use qwen-plus to mark correct answers on ymnik.kz rows that lack them.

For the 8 subjects where ymnik.kz did not reveal `good[]`
(math literacy, reading literacy, maths, physics, German, French,
chemistry, human-society-right), the scraper still captured:

  * question_text
  * full options dict (A..E or A..H)
  * optional passage (reading comprehension)

We ask qwen-plus (DashScope) to pick the correct letter(s) by pure
domain reasoning. For questions where it lacks confidence (e.g.
ambiguous grammar drills), we let it return 'UNSURE' and we skip
that row (drop-reason = 'llm_unsure'). This keeps the bank high
quality — better to miss a question than poison it.

Invocation::

    python backend/scripts/llm_mark_correct.py \
        --dump-dir backend/scripts/ymnik_dump \
        --model qwen-plus

Write path: each unmarked row is updated *in place* in its JSONL file,
gaining `correct_letters` + `marked_by: "qwen-plus"`. Resume-safe.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from openai import OpenAI  # noqa: E402

DASH_KEY = os.environ.get("DASHSCOPE_API_KEY")
if not DASH_KEY:
    raise RuntimeError("DASHSCOPE_API_KEY environment variable is required")
DASH_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"

_PROMPT_TEMPLATE = (
    "You are a Kazakhstani UNT exam answer-key expert.\n\n"
    "Given the following multiple-choice question, pick the correct letter.\n\n"
    "Return ONLY a JSON object of exactly one of these forms:\n"
    '  {{"correct": "A"}}            (single-correct)\n'
    '  {{"correct": "A,C"}}          (multi-correct, comma-separated)\n'
    '  {{"correct": "UNSURE"}}       (if you cannot be highly confident)\n\n'
    "Do not include any other text. Prefer UNSURE over guessing.\n\n"
    "Subject: {subject}\n"
    "Language: {language}\n\n"
    "{passage_block}"
    "Question: {question}\n\n"
    "Options:\n{options}\n"
)


def build_prompt(row: dict[str, Any]) -> str:
    opts_txt = "\n".join(f"  {k}. {v}" for k, v in row["options"].items())
    passage = row.get("passage") or ""
    passage_block = f"Passage:\n{passage}\n\n" if passage else ""
    return _PROMPT_TEMPLATE.format(
        subject=row.get("subject_slug", ""),
        language=row.get("lang", "ru"),
        passage_block=passage_block,
        question=row["question"],
        options=opts_txt,
    )


_LETTER_RE = re.compile(r'"correct"\s*:\s*"([^"]+)"')


def parse_answer(response_text: str) -> str | None:
    m = _LETTER_RE.search(response_text)
    if not m:
        return None
    val = m.group(1).strip().upper().replace(" ", "")
    if val == "UNSURE" or not val:
        return None
    # validate letters
    parts = [p.strip() for p in val.split(",") if p.strip()]
    if not all(len(p) == 1 and p in "ABCDEFGH" for p in parts):
        return None
    return ",".join(parts)


def call_llm(client: OpenAI, model: str, prompt: str, max_retries: int = 3) -> str | None:
    for attempt in range(max_retries):
        try:
            r = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=40,
            )
            return r.choices[0].message.content or ""
        except Exception as e:
            print(f"  [retry {attempt}] LLM err: {e}")
            time.sleep(2 * (attempt + 1))
    return None


def process_file(path: Path, client: OpenAI, model: str, limit: int | None) -> dict[str, int]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue

    pending_idx = [
        i for i, r in enumerate(rows) if not r.get("correct_letters") and not r.get("llm_tried")
    ]
    n_total = len(pending_idx)
    if limit:
        pending_idx = pending_idx[:limit]
    print(f"\n[{path.name}] rows={len(rows)} need_marking={n_total} processing={len(pending_idx)}")

    stats = {"marked": 0, "unsure": 0, "err": 0}
    for pos, i in enumerate(pending_idx):
        row = rows[i]
        prompt = build_prompt(row)
        out = call_llm(client, model, prompt)
        if out is None:
            stats["err"] += 1
            row["llm_tried"] = True
            continue
        pick = parse_answer(out)
        row["llm_tried"] = True
        row["marked_by"] = model
        if pick is None:
            stats["unsure"] += 1
        else:
            row["correct_letters"] = pick.split(",")
            stats["marked"] += 1
        if (pos + 1) % 25 == 0:
            # periodic flush so crashes don't lose work
            with path.open("w", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(
                f"  [{pos + 1}/{len(pending_idx)}] "
                f"marked={stats['marked']} unsure={stats['unsure']} "
                f"err={stats['err']}"
            )

    # final flush
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return stats


NO_GOOD_SLUGS = {
    "mathematical-literacy",
    "reading-literacy",
    "maths",
    "physics",
    "German",
    "French",
    "chemistry",
    "human-society-right",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-dir", default="backend/scripts/ymnik_dump")
    ap.add_argument("--model", default="qwen-plus")
    ap.add_argument(
        "--limit-per-file", type=int, default=None, help="Cap per-file rows to mark (smoke test)"
    )
    ap.add_argument(
        "--slugs", nargs="*", default=None, help="Only process these slugs (default: all no-good)"
    )
    args = ap.parse_args()

    client = OpenAI(api_key=DASH_KEY, base_url=DASH_BASE)

    dump = Path(args.dump_dir)
    files: list[Path] = sorted(dump.glob("*.jsonl"))
    slugs = set(args.slugs) if args.slugs else NO_GOOD_SLUGS

    total = {"marked": 0, "unsure": 0, "err": 0}
    for fp in files:
        # slug = filename_without_lang_suffix
        # e.g. "mathematical-literacy_ru.jsonl"
        stem = fp.stem
        slug = stem.rsplit("_", 1)[0]
        if slug not in slugs:
            continue
        stats = process_file(fp, client, args.model, args.limit_per_file)
        for k, v in stats.items():
            total[k] += v

    print("\n=== SUMMARY ===")
    for k, v in total.items():
        print(f"  {k:<10} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
