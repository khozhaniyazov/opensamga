"""Scrape the ymnik.kz UNT practice-question bank.

How ymnik.kz works (reverse-engineered in session 23 from
``/shablon/2/a.js`` and live probes against ``/js/reque.php``):

  1. ``GET /tests/<slug>/`` returns HTML with a ``<form class="votes">``
     carrying two critical attributes:

       * ``ind="<N>"``     — the subject id (1..14, see SUBJECTS below)
       * ``name="<token>"`` — the PHP-session-scoped question token

     Setting a PHPSESSID + guest cookie pair is sufficient; no login.

  2. ``POST /js/reque.php`` with multipart form fields::

        category=[<ind>]      (JSON-encoded, e.g. "[3]")
        lang=1|2              (1=Russian, 2=Kazakh)
        action=new

     returns JSON of the form::

        {"sucess":
          {"unical":  "<next token>",
           "v":       "<p>Question html...</p>",
           "f":       "1",                    # 1=single radio, 2=multi
           "t":       null | "<html>",        # optional reading passage
           "a":       {"rows": {"1":"opt1", "2":"opt2", ...},
                       "n":  5}               # number of options
          },
         "message":  "Вы ответили на N вопросов из M"
        }

  3. ``POST /js/reque.php`` with::

        vote=<unical>
        <unical>=<pick>             (one of "1".."5")

     returns JSON containing the correct answer key(s)::

        {"sucess":
          {"vote": {"1":545, "2":459, ...},       # popularity histogram
           "good": ["3"],                         # <-- correct answer keys
           "decis": "..."                          # optional explanation
          },
         "message": "Ваш ответ принят. Вы набрали 1 балл"
        }

  4. To advance to the next question, POST ``action=new`` again — the
     server advances the progression inside the PHPSESSID.

Throttle: the JS enforces a 5-second cooldown cookie (``ajax``) between
posts. Server-side the cooldown seems softer — empirically 0.8s is
safe.  We stay polite and use ~1.2s per question-pair (2 posts).

Output: one JSONL file per (subject_slug, lang) under
``backend/scripts/ymnik_dump/``. Each line::

   {"unical": "...",
    "subject_slug": "...",
    "ind": N,
    "lang": "ru"|"kz",
    "question": "...",
    "options": {"A":"...", "B":"...", ...},
    "correct_letters": ["A", "C"],
    "num_options": 5,
    "format": "single" | "multi",
    "passage": "..." | null,
    "decision": "..." | null,
    "fetched_at": "ISO8601",
    "source_url": "https://ymnik.kz/tests/<slug>/"
   }

Workers scrape independently — the bank is randomized per session, so
N parallel workers N× throughput (with diminishing returns as dedupe
saturation climbs).

Run from repo root::

    python backend/scripts/scrape_ymnik.py --subject history-of-Kazakhstan \\
        --lang ru --target 3400 --workers 4

Or scrape everything::

    python backend/scripts/scrape_ymnik.py --all --workers 4

Polite to testent/ymnik — the raw HTML is cheap to serve so the load we
create is ~1 req/sec/worker. No blocks or throttles observed during
session-23 dev.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

# Index of ymnik.kz test categories. Collected via probe 2026-04-23.
# ``has_good`` marks subjects for which /js/reque.php reveals the
# correct-answer key via ``sucess.good``. Confirmed via live probe on
# 2026-04-23 (see tmp_scripts/session_2026-04-22/debug_all_subjects.py).
# Subjects without ``has_good`` still yield question+options+passage;
# we hand them to qwen-plus afterwards to mark the correct letter.
SUBJECTS: dict[str, dict[str, Any]] = {
    "mathematical-literacy": {
        "ind": 1,
        "name": "Mathematical Literacy",
        "bank_size_ru": 118,
        "has_good": False,
    },
    "reading-literacy": {
        "ind": 2,
        "name": "Reading Literacy",
        "bank_size_ru": 129,
        "has_good": False,
    },
    "history-of-Kazakhstan": {
        "ind": 3,
        "name": "History of Kazakhstan",
        "bank_size_ru": 3390,
        "has_good": True,
    },
    "biology": {"ind": 4, "name": "Biology", "bank_size_ru": 2700, "has_good": True},
    "geography": {"ind": 5, "name": "Geography", "bank_size_ru": 4671, "has_good": True},
    "maths": {"ind": 6, "name": "Mathematics", "bank_size_ru": 260, "has_good": False},
    "native-language": {
        "ind": 7,
        "name": "Native Language & Lit",
        "bank_size_ru": 3259,
        "has_good": True,
    },
    "physics": {"ind": 8, "name": "Physics", "bank_size_ru": 258, "has_good": False},
    "world-history": {"ind": 9, "name": "World History", "bank_size_ru": 2867, "has_good": True},
    "english": {"ind": 10, "name": "English", "bank_size_ru": 2039, "has_good": True},
    "German": {"ind": 11, "name": "German", "bank_size_ru": 207, "has_good": False},
    "French": {"ind": 12, "name": "French", "bank_size_ru": 193, "has_good": False},
    "chemistry": {"ind": 13, "name": "Chemistry", "bank_size_ru": 245, "has_good": False},
    "human-society-right": {
        "ind": 14,
        "name": "Human Society Law",
        "bank_size_ru": 129,
        "has_good": False,
    },
}


BASE = "https://ymnik.kz"
REQUE = f"{BASE}/js/reque.php"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Safari/537.36"
)
AJAX_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "ru,kk;q=0.9,en;q=0.5",
    "X-Requested-With": "XMLHttpRequest",
}

# polite delay between POSTs by the same worker
POLITE_SLEEP = 1.1


# ---------- HTML helpers ----------

_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(html: str | None) -> str:
    if not html:
        return ""
    txt = _TAG_RE.sub(" ", html)
    # collapse whitespace
    return re.sub(r"\s+", " ", txt).strip()


# ---------- data ----------


@dataclass
class Question:
    unical: str
    subject_slug: str
    ind: int
    lang: str  # 'ru' or 'kz'
    question: str
    options: dict[str, str]  # {"A": "...", "B": "...", ...}
    correct_letters: list[str]
    num_options: int
    format: str  # 'single' or 'multi'
    passage: str | None
    decision: str | None
    fetched_at: str
    source_url: str


# ---------- scraper ----------


class YmnikWorker:
    """One independent scraping session (own cookies = own random walk)."""

    def __init__(self, subject_slug: str, lang_code: str, worker_id: int):
        self.subject_slug = subject_slug
        self.lang_code = lang_code  # "1" or "2"
        self.lang_label = "ru" if lang_code == "1" else "kz"
        self.worker_id = worker_id

        cfg = SUBJECTS[subject_slug]
        self.ind = cfg["ind"]
        self.subject_url = f"{BASE}/tests/{subject_slug}/"

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept-Language": "ru,kk",
            }
        )

        # Bootstrap: visit landing page to collect PHPSESSID + guest cookies
        self.session.get(self.subject_url, timeout=30)

    def fetch_next(self) -> dict[str, Any] | None:
        """POST action=new → the next question payload."""
        data = {
            "category": json.dumps([str(self.ind)]),
            "lang": self.lang_code,
            "action": "new",
        }
        headers = dict(AJAX_HEADERS)
        headers["Referer"] = self.subject_url
        r = self.session.post(REQUE, data=data, headers=headers, timeout=30)
        if r.status_code != 200:
            return None
        try:
            j = r.json()
        except Exception:
            return None
        succ = j.get("sucess") or {}
        if not succ.get("unical"):
            return None
        return succ

    def submit_vote(self, unical: str, pick: str) -> dict[str, Any] | None:
        """POST the vote, get correct-answer revelation.

        ymnik.kz's JS builds FormData where the answer is an *array* —
        the browser serializes arrays via JSON.stringify when appended to
        FormData, so the server expects ``<unical>`` to be a JSON string
        like ``'["3"]'`` (not ``"3"``). Sending a raw string yields
        ``good: []``. Multipart encoding is required too.
        """
        headers = {
            "User-Agent": USER_AGENT,
            "Accept-Language": "ru,kk",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": BASE,
            "Referer": self.subject_url,
        }
        files = {
            "vote": (None, unical),
            unical: (None, json.dumps([pick])),
        }
        r = self.session.post(REQUE, files=files, headers=headers, timeout=30)
        if r.status_code != 200:
            return None
        try:
            j = r.json()
        except Exception:
            return None
        return j.get("sucess")

    def one_question(self) -> Question | None:
        q = self.fetch_next()
        if not q:
            return None
        unical = q["unical"]
        v_html = q.get("v") or ""
        fmt_raw = str(q.get("f") or "1")
        fmt = "single" if fmt_raw == "1" else "multi"
        t_html = q.get("t")
        a = q.get("a") or {}
        rows = a.get("rows") or {}
        num_options = int(a.get("n") or len(rows))

        # numeric keys "1".."5" -> letters A..E (preserve original ordering)
        # keys are str digits, sort numerically
        letter_map = ["A", "B", "C", "D", "E", "F", "G", "H"]
        sorted_keys = sorted(rows.keys(), key=lambda k: int(k))
        options_by_letter: dict[str, str] = {}
        key_to_letter: dict[str, str] = {}
        for idx, k in enumerate(sorted_keys):
            letter = letter_map[idx]
            options_by_letter[letter] = strip_html(rows[k])
            key_to_letter[k] = letter

        # The server enforces a 2-second cooldown between NEW and VOTE
        # (see the cookie named 'ajax' + pip.cok()/pip.coo() in
        # /shablon/2/a.js). Too fast = 'good: []' comes back.
        time.sleep(2.2)
        pick = sorted_keys[0] if sorted_keys else "1"
        sub = self.submit_vote(unical, pick)
        if not sub:
            return None
        good_keys = sub.get("good") or []
        correct_letters = [key_to_letter[k] for k in good_keys if k in key_to_letter]

        decision_html = sub.get("decis") or None

        return Question(
            unical=unical,
            subject_slug=self.subject_slug,
            ind=self.ind,
            lang=self.lang_label,
            question=strip_html(v_html),
            options=options_by_letter,
            correct_letters=correct_letters,
            num_options=num_options,
            format=fmt,
            passage=strip_html(t_html) if t_html else None,
            decision=strip_html(decision_html) if decision_html else None,
            fetched_at=datetime.now(UTC).isoformat(),
            source_url=self.subject_url,
        )


# ---------- scrape orchestrator ----------


class SubjectScraper:
    """Drive N workers for one (subject, lang); dedupe by unical."""

    def __init__(
        self,
        subject_slug: str,
        lang: str,
        target: int,
        workers: int,
        out_dir: Path,
        max_stale: int = 200,
    ):
        self.subject_slug = subject_slug
        self.lang = lang  # 'ru' or 'kz'
        self.lang_code = "1" if lang == "ru" else "2"
        self.target = target
        self.workers = workers
        self.out_dir = out_dir
        self.max_stale = max_stale

        self.seen: set[str] = set()
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        self.stale_since_new = 0

        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.out_path = out_dir / f"{subject_slug}_{lang}.jsonl"
        # Resume: load any existing unicals
        if self.out_path.exists():
            with self.out_path.open(encoding="utf-8") as f:
                for line in f:
                    try:
                        self.seen.add(json.loads(line)["unical"])
                    except Exception:
                        pass
        self.fh = self.out_path.open("a", encoding="utf-8")

    def _worker(self, worker_id: int) -> None:
        w = YmnikWorker(self.subject_slug, self.lang_code, worker_id)
        consec_errors = 0
        while not self.stop_flag.is_set():
            try:
                q = w.one_question()
            except Exception as e:
                consec_errors += 1
                if consec_errors > 5:
                    print(
                        f"[w{worker_id} {self.subject_slug}/{self.lang}] "
                        f"too many errors, bailing: {e!r}"
                    )
                    return
                time.sleep(5)
                continue
            consec_errors = 0

            if q is None:
                time.sleep(2)
                continue

            with self.lock:
                if q.unical in self.seen:
                    self.stale_since_new += 1
                    if self.stale_since_new >= self.max_stale:
                        print(
                            f"[{self.subject_slug}/{self.lang}] "
                            f"max_stale reached ({self.max_stale}), stopping"
                        )
                        self.stop_flag.set()
                    continue
                self.seen.add(q.unical)
                self.stale_since_new = 0
                self.fh.write(json.dumps(asdict(q), ensure_ascii=False) + "\n")
                self.fh.flush()
                n = len(self.seen)
                if n % 25 == 0:
                    print(f"[{self.subject_slug}/{self.lang}] {n}/{self.target} unique")
                if n >= self.target:
                    print(f"[{self.subject_slug}/{self.lang}] target {self.target} reached")
                    self.stop_flag.set()
                    return

            time.sleep(POLITE_SLEEP)

    def run(self) -> int:
        print(
            f"\n=== {self.subject_slug} / {self.lang} — target={self.target}, "
            f"workers={self.workers}, already_have={len(self.seen)} ==="
        )
        if len(self.seen) >= self.target:
            self.fh.close()
            return len(self.seen)

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            futs = [ex.submit(self._worker, i) for i in range(self.workers)]
            for f in as_completed(futs):
                try:
                    f.result()
                except Exception as e:
                    print(f"worker crashed: {e!r}")

        self.fh.close()
        return len(self.seen)


# ---------- CLI ----------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", help=f"One of: {','.join(SUBJECTS.keys())}")
    ap.add_argument("--all", action="store_true", help="Scrape all 14 subjects sequentially")
    ap.add_argument("--lang", choices=("ru", "kz", "both"), default="both")
    ap.add_argument(
        "--target", type=int, default=None, help="Per-subject target (default: bank_size_ru * 1.1)"
    )
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out-dir", default="backend/scripts/ymnik_dump")
    ap.add_argument("--max-stale", type=int, default=200, help="Stop after N consecutive dupes")
    args = ap.parse_args()

    if not args.subject and not args.all:
        print("pass --subject <slug> or --all")
        return 2

    out_dir = Path(args.out_dir)

    if args.all:
        slugs = list(SUBJECTS.keys())
    else:
        if args.subject not in SUBJECTS:
            print(f"unknown subject: {args.subject}")
            return 2
        slugs = [args.subject]

    langs = ["ru", "kz"] if args.lang == "both" else [args.lang]

    totals: dict[str, int] = {}
    for slug in slugs:
        cfg = SUBJECTS[slug]
        target = args.target or max(50, int(cfg["bank_size_ru"] * 1.05))
        for lang in langs:
            tag = f"{slug}/{lang}"
            n = SubjectScraper(
                subject_slug=slug,
                lang=lang,
                target=target,
                workers=args.workers,
                out_dir=out_dir,
                max_stale=args.max_stale,
            ).run()
            totals[tag] = n

    print("\n=== SUMMARY ===")
    grand = 0
    for tag, n in totals.items():
        print(f"  {tag:<40} {n}")
        grand += n
    print(f"  {'TOTAL':<40} {grand}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
