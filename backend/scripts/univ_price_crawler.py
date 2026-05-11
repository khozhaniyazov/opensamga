"""Crawl https://univision.kz/univ/price.html -> per-uni detail page ->
extract tuition prices.

Writes tmp_scripts/session_2026-04-18/univision_prices.json with:
  {
      "<university_slug>": {
          "uni_name": "...",
          "url": "...",
          "prices_by_year": { "2025": [...], "2024": [...] },
          "programs": [
              {"code": "B001", "name": "...", "tuition_min": n, "tuition_max": n, "year": 2025},
              ...
          ]
      }
  }

ASCII-only.
"""

import os
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(os.environ.get("UNT_PLATFORM_ROOT", "."))
OUT = ROOT / "tmp_scripts" / "session_2026-04-18" / "univision_prices.json"
PROGRESS = ROOT / "tmp_scripts" / "session_2026-04-18" / "univision_prices_progress.txt"
INDEX = "https://univision.kz/univ/price.html"

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru,en;q=0.9",
}


def text(elem):
    return re.sub(r"\s+", " ", elem.get_text(" ", strip=True)).strip()


def parse_price_int(s):
    if not s:
        return None
    # Try space/nbsp-separated first (Russian format: "2 900 000")
    m = re.search(r"\b(\d{1,3}(?:[\s\xa0]\d{3}){1,3})\b", s)
    if m:
        return int(re.sub(r"[\s\xa0]", "", m.group(1)))
    # Plain integer 150k-10M
    m = re.search(r"\b([1-9]\d{5,7})\b", s)
    if m:
        return int(m.group(1))
    return None


def gather_index(sess):
    r = sess.get(INDEX, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    links = {}
    # Pattern: /univ/<slug>/price  (no .html)
    for a in soup.find_all("a", href=True):
        h = a["href"]
        if re.match(r"^/univ/[^/]+/price/?$", h):
            full = urljoin("https://univision.kz", h)
            links[full] = text(a)
    return links


def parse_price_page(html, url):
    soup = BeautifulSoup(html, "html.parser")
    out = {"url": url, "uni_name": "", "prices_by_year": {}, "programs": []}

    # Title
    h1 = soup.find("h1")
    if h1:
        out["uni_name"] = text(h1)

    # Find every table and interpret
    for tbl in soup.find_all("table"):
        rows = [[text(c) for c in tr.find_all(["th", "td"])] for tr in tbl.find_all("tr")]
        if not rows:
            continue
        rows[0]
        body = rows[1:]
        for r in body:
            if len(r) < 2:
                continue
            row_joined = " ".join(r)
            # Program codes are either:
            #   B001 / M001 / D001 / R001 / BM086 (group codes)
            #   6B02103 / 7M05101 (detailed OP codes) -> we normalise to group
            code_m = re.search(
                r"\b([67][BMDR][A-Z]?\d{5}|[BMDR][A-Z]?\d{3})\b",
                row_joined,
            )
            code = None
            if code_m:
                raw = code_m.group(1)
                # If detailed (starts with 6/7), keep first 4 digits + B/M/D/R
                # e.g. "6B02103" -> group code "B021" ? actually mapping is not
                # trivial. We store the raw detailed code; later importer maps
                # via major_groups if desired.
                code = raw

            prices = []
            for cell in r:
                p = parse_price_int(cell)
                if p and 100_000 <= p <= 10_000_000:
                    prices.append(p)
            if not prices:
                continue
            out["programs"].append(
                {
                    "code": code,
                    "row_text": " | ".join(r),
                    "tuition_min": min(prices),
                    "tuition_max": max(prices),
                }
            )
    return out


def main():
    sess = requests.Session()
    sess.headers.update(UA)

    links = gather_index(sess)
    print(f"index links: {len(links)}")

    results = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    t0 = time.time()
    for i, url in enumerate(sorted(links)):
        slug = url.rsplit("/univ/", 1)[1].replace("/price", "").strip("/")
        if slug in results and results[slug].get("programs"):
            continue
        try:
            r = sess.get(url, timeout=30)
            if r.status_code != 200:
                results[slug] = {"url": url, "error": f"status_{r.status_code}"}
            else:
                parsed = parse_price_page(r.text, url)
                results[slug] = parsed
        except Exception as exc:
            results[slug] = {"url": url, "error": str(exc)[:120]}

        if (i + 1) % 10 == 0 or i == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / max(elapsed, 0.01)
            eta = (len(links) - i - 1) / max(rate, 0.01)
            non_empty = sum(1 for v in results.values() if v and v.get("programs"))
            tot_progs = sum(len(v.get("programs", [])) for v in results.values() if v)
            msg = (
                f"progress {i + 1}/{len(links)}  with_programs={non_empty}  "
                f"total_program_rows={tot_progs}  elapsed={elapsed:.0f}s  "
                f"eta={eta:.0f}s"
            )
            print(msg, flush=True)
            PROGRESS.write_text(msg + "\n", encoding="utf-8")
            OUT.write_text(json.dumps(results, indent=2, ensure_ascii=True), encoding="utf-8")
        time.sleep(0.3)

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=True), encoding="utf-8")
    non_empty = sum(1 for v in results.values() if v and v.get("programs"))
    tot = sum(len(v.get("programs", [])) for v in results.values() if v)
    print(f"\nDONE: unis={len(results)} with_programs={non_empty} total_program_rows={tot}")


main()
