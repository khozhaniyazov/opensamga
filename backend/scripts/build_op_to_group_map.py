"""Build a mapping from detailed OP code (e.g. '6B01101') to group code
(e.g. 'B001') by re-crawling all 505 univision group pages.

Output: tmp_scripts/session_2026-04-18/op_to_group_map.json
    { "6B01101": "B001", "6B01102": "B001", ..., "7M01101": "M001", ... }

Resumable: reads existing JSON if present, skips already-scraped groups.
ASCII-only stdout.
"""

import json
import os
import re
import time
from pathlib import Path

import requests

ROOT = Path(os.environ.get("UNT_PLATFORM_ROOT", "."))
INDEX = ROOT / "tmp_scripts" / "session_2026-04-18" / "univision_group_index.json"
OUT = ROOT / "tmp_scripts" / "session_2026-04-18" / "op_to_group_map.json"
PROGRESS = ROOT / "tmp_scripts" / "session_2026-04-18" / "op_to_group_progress.txt"

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru,en;q=0.9",
}

# Detailed OP code pattern: 6B01101, 7M05101, 8D01102, 1R0110N etc.
OP_RE = re.compile(r"\b([678][BMDRVE][A-Z]?\d{5})\b")


def main():
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    mapping = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    seen_groups = set()
    for _op, grp in mapping.items():
        seen_groups.add(grp)

    sess = requests.Session()
    sess.headers.update(UA)

    t0 = time.time()
    added_this_run = 0
    for i, item in enumerate(index):
        code = item["code"]
        if code in seen_groups:
            continue
        try:
            r = sess.get(item["url"], timeout=30)
        except Exception as exc:
            print(f"FAIL {code}: {exc}", flush=True)
            continue
        if r.status_code != 200:
            continue
        # Extract all detailed OP codes; map each to this group code
        for op in set(OP_RE.findall(r.text)):
            mapping[op] = code
            added_this_run += 1
        seen_groups.add(code)

        if (i + 1) % 25 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / max(elapsed, 0.01)
            eta = (len(index) - i - 1) / max(rate, 0.01)
            msg = (
                f"progress {i + 1}/{len(index)}  unique_ops={len(mapping)}  "
                f"added_this_run={added_this_run}  "
                f"elapsed={elapsed:.0f}s  eta={eta:.0f}s"
            )
            print(msg, flush=True)
            PROGRESS.write_text(msg + "\n", encoding="utf-8")
            OUT.write_text(json.dumps(mapping, indent=2, ensure_ascii=True), encoding="utf-8")
        time.sleep(0.2)

    OUT.write_text(json.dumps(mapping, indent=2, ensure_ascii=True), encoding="utf-8")

    # Summary
    from collections import Counter

    groups_seen = Counter(mapping.values())
    print(f"\nDONE: unique_OP_codes={len(mapping)}  group_codes_with_ops={len(groups_seen)}")
    # Prefix breakdown
    prefixes = Counter()
    for op in mapping:
        prefixes[op[0]] += 1
    print(f"by_op_prefix: {dict(prefixes)}")


main()
