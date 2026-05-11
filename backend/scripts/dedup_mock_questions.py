"""Near-duplicate purge for mock_questions (session 23 / phase B).

Why
---
After session-23 bulk ingest (3 -> 12182 rows), `content_hash` catches
only *exact* duplicates of the normalized question+options text. But
ymnik.kz often serves the same item with:
  * options shuffled (different letter map),
  * a single-correct variant and a multi-correct variant,
  * trivial whitespace / punctuation variants below the normalizer's radar.

These slip past the SHA256 gate. Once `question_embedding` is populated
(1024-d DashScope text-embedding-v4), we can detect them as
cosine-similar pairs and purge.

Approach
--------
Partition by `(subject, language)` (never dedup across languages or
across subjects — identical stems like "5 + 3 = ?" are fine in separate
banks). Inside each partition compute pairwise cosine similarity using
pgvector's `<=>` operator (cosine distance, so sim = 1 - distance) with
`a.id < b.id` to keep the upper triangle. Any pair with `sim >=
--threshold` (default 0.95) forms a connected component via union-find;
within each component we keep the lowest id and drop the rest.

Safety
------
- Default mode is `--dry-run`. `--apply` is required to mutate.
- Writes a pair report to
  `tmp_scripts/session_2026-04-22/dedup_report.jsonl` in either mode.
- Refuses to run if ANY row in the target scope is missing an
  embedding (would under-count dupes). Pass `--allow-partial` to
  override for a quick preview on partially-embedded data.
- Never touches rows where `source = 'curated'` (we keep the 3
  hand-seeded rows authoritative even if a scraped twin shows up).

Output
------
Prints a per-subject drop table + totals. Report JSONL is one line per
similar pair with `{a, b, sim, subject, language, kept, dropped}` so it
is auditable.

Usage
-----
  python -X utf8 backend/scripts/dedup_mock_questions.py                    # dry run, threshold 0.95
  python -X utf8 backend/scripts/dedup_mock_questions.py --threshold 0.93
  python -X utf8 backend/scripts/dedup_mock_questions.py --apply            # actually DELETEs
  python -X utf8 backend/scripts/dedup_mock_questions.py --subject "Biology"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

import asyncpg  # noqa: E402

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/unt_platform",
)

REPORT_DIR = REPO_ROOT / "tmp_scripts" / "session_2026-04-22"
REPORT_PATH = REPORT_DIR / "dedup_report.jsonl"


# -------------------- union-find --------------------


class UF:
    def __init__(self) -> None:
        self.p: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Keep the lower id as the canonical root (so "kept" ids are stable).
            if ra < rb:
                self.p[rb] = ra
            else:
                self.p[ra] = rb


# -------------------- SQL --------------------

COVERAGE_SQL = """
SELECT
    COUNT(*)                                 AS total,
    COUNT(question_embedding)                AS with_emb,
    COUNT(*) FILTER (WHERE question_embedding IS NULL) AS missing_emb
FROM mock_questions
WHERE ($1::text IS NULL OR subject = $1)
"""

PARTITIONS_SQL = """
SELECT subject, language, COUNT(*) AS n
FROM mock_questions
WHERE question_embedding IS NOT NULL
  AND ($1::text IS NULL OR subject = $1)
GROUP BY subject, language
ORDER BY subject, language
"""

# Self-join within a (subject, language) partition on the upper triangle.
# `<=>` is cosine distance in pgvector; similarity = 1 - distance.
PAIRS_SQL = """
SELECT
    a.id            AS id_a,
    b.id            AS id_b,
    a.source        AS source_a,
    b.source        AS source_b,
    1 - (a.question_embedding <=> b.question_embedding) AS sim
FROM mock_questions a
JOIN mock_questions b
  ON a.id < b.id
 AND a.subject  = b.subject
 AND a.language = b.language
WHERE a.subject  = $1
  AND a.language = $2
  AND a.question_embedding IS NOT NULL
  AND b.question_embedding IS NOT NULL
  AND 1 - (a.question_embedding <=> b.question_embedding) >= $3
"""

DELETE_SQL = """
DELETE FROM mock_questions WHERE id = ANY($1::int[])
"""


# -------------------- core --------------------


async def run(
    threshold: float,
    apply: bool,
    subject_filter: str | None,
    allow_partial: bool,
) -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    conn = await asyncpg.connect(DSN)
    try:
        cov = await conn.fetchrow(COVERAGE_SQL, subject_filter)
        print(
            f"[cov] total={cov['total']}  with_emb={cov['with_emb']}  "
            f"missing_emb={cov['missing_emb']}"
        )
        if cov["missing_emb"] and not allow_partial:
            print(
                "[abort] refusing to dedup: some rows have NULL embeddings. "
                "Re-run after embed_all.py finishes, or pass --allow-partial."
            )
            return 2

        parts = await conn.fetch(PARTITIONS_SQL, subject_filter)
        print(f"[parts] {len(parts)} (subject, language) partitions with embeddings")

        pairs_total = 0
        kept_total = 0
        drops_total = 0
        per_subject_drops: dict[str, int] = defaultdict(int)
        per_subject_kept: dict[str, int] = defaultdict(int)

        with REPORT_PATH.open("w", encoding="utf-8") as rep:
            for row in parts:
                subj = row["subject"]
                lang = row["language"]
                n = row["n"]
                pairs = await conn.fetch(PAIRS_SQL, subj, lang, threshold)
                if not pairs:
                    continue
                uf = UF()
                pair_rows: list[dict] = []
                for p in pairs:
                    ia, ib = int(p["id_a"]), int(p["id_b"])
                    # Do NOT cluster with curated — always keep curated side.
                    if p["source_a"] == "curated" and p["source_b"] != "curated":
                        # treat as (kept=ia, dropped=ib)
                        uf.union(ia, ib)
                    elif p["source_b"] == "curated" and p["source_a"] != "curated":
                        uf.union(ia, ib)
                    else:
                        uf.union(ia, ib)
                    pair_rows.append({"a": ia, "b": ib, "sim": float(p["sim"])})

                # Build components.
                comp: dict[int, set[int]] = defaultdict(set)
                all_ids: set[int] = set()
                for pr in pair_rows:
                    all_ids.add(pr["a"])
                    all_ids.add(pr["b"])
                for i in all_ids:
                    comp[uf.find(i)].add(i)

                # Within each component pick min id as kept, rest are drops.
                kept_ids: set[int] = set()
                drop_ids: set[int] = set()
                for members in comp.values():
                    keep = min(members)
                    kept_ids.add(keep)
                    drop_ids.update(members - {keep})

                pairs_total += len(pair_rows)
                kept_total += len(kept_ids)
                drops_total += len(drop_ids)
                per_subject_kept[subj] += len(kept_ids)
                per_subject_drops[subj] += len(drop_ids)

                for pr in pair_rows:
                    rep.write(
                        json.dumps(
                            {
                                "subject": subj,
                                "language": lang,
                                "a": pr["a"],
                                "b": pr["b"],
                                "sim": round(pr["sim"], 6),
                                "kept": min(pr["a"], pr["b"]),
                                "dropped": max(pr["a"], pr["b"]),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )

                print(
                    f"  [{subj:<26} {lang}] rows={n:<5} pairs>=t={len(pair_rows):<4} "
                    f"components={len(comp):<4} kept={len(kept_ids):<4} drop={len(drop_ids)}"
                )

                if apply and drop_ids:
                    await conn.execute(DELETE_SQL, list(drop_ids))

        print("")
        print(f"[total] pairs>=t={pairs_total}  kept_roots={kept_total}  drops={drops_total}")
        if per_subject_drops:
            print("[per-subject drops]")
            for subj in sorted(per_subject_drops):
                print(
                    f"  {subj:<26} drops={per_subject_drops[subj]:<4} kept_roots={per_subject_kept[subj]}"
                )
        print(f"[report] {REPORT_PATH}")
        if not apply:
            print("[mode] DRY RUN — no rows deleted. Pass --apply to execute.")
        else:
            print("[mode] APPLIED — rows deleted.")
        return 0
    finally:
        await conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--threshold", type=float, default=0.95, help="Cosine similarity threshold (default 0.95)."
    )
    ap.add_argument("--apply", action="store_true", help="Actually DELETE drops (default dry-run).")
    ap.add_argument(
        "--subject", type=str, default=None, help="Limit to one canonical subject (e.g. 'Biology')."
    )
    ap.add_argument(
        "--allow-partial", action="store_true", help="Run even if some rows are missing embeddings."
    )
    args = ap.parse_args()

    if args.threshold < 0.80 or args.threshold > 1.0:
        print("[abort] --threshold must be in [0.80, 1.0]")
        return 2
    return asyncio.run(
        run(
            threshold=args.threshold,
            apply=args.apply,
            subject_filter=args.subject,
            allow_partial=args.allow_partial,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
