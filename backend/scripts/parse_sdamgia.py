"""Parse SdamGIA ENT viewmany dumps into a JSONL feed ready for mock_questions.

Input:  tmp_scripts/session_2026-04-22/reshuent_viewmany/{subject}_viewmany.html
Output: backend/scripts/sdamgia_dump/{subject}.jsonl  (one row per problem)

Row schema (compatible, where sensible, with ymnik_dump rows so we can share
ingest plumbing — but we use `source_slug='sdamgia_ent'` to differentiate):

{
  "source":        "sdamgia_ent",
  "subject_slug":  "mathematical-literacy" | "reading-literacy" |
                   "maths" | "history-of-Kazakhstan",
  "lang":          "ru",
  "problem_id":    995,                              # int, SdamGIA problem?id
  "type_num":      1,                                # int, Тип N
  "question":      "…",                              # body text, soft-hyphens stripped
  "passage":       "…" | null,                       # rl-ent multi-part context
  "options":       {"A": "20", "B": "22", "C": "32", "D": "17"},
  "correct_letters": ["C"],                          # mapped 1→A, 2→B, 3→C, 4→D
  "solution_text": "…",                              # solution body, plain text
  "source_url":    "https://ml-ent.sdamgia.ru/problem?id=995",
  "source_exam":   ["https://…/test?id=72", …]       # one or more variants
}

Dedup strategy: source_url is the natural key. content_hash is recomputed at
ingest time from question+options.

We do NOT embed here. Embedding is the next step via ingest_sdamgia.py.
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from bs4 import BeautifulSoup, Tag
except Exception as e:
    print(f"ERR: bs4 required: {e!r}", file=sys.stderr)
    sys.exit(1)


REPO = Path(__file__).resolve().parents[2]
INPUT_DIR = REPO / "tmp_scripts" / "session_2026-04-22" / "reshuent_viewmany"
OUTPUT_DIR = REPO / "backend" / "scripts" / "sdamgia_dump"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# subject slug → (SdamGIA subdomain, canonical subject name, subject slug we
# use inside JSONL to match ymnik convention)
SUBJECTS = {
    "ml-ent": ("mathematical-literacy", "Mathematical Literacy"),
    "rl-ent": ("reading-literacy", "Reading Literacy"),
    "math-ent": ("maths", "Mathematics"),
    "kh-ent": ("history-of-Kazakhstan", "History of Kazakhstan"),
}


SOFT_HYPHEN = "\u00ad"
NBSP = "\u00a0"
NARROW_NBSP = "\u202f"  # appears in numeric separators on this site
THIN_SPACE = "\u2009"


def _clean_text(s: str) -> str:
    if not s:
        return ""
    # Unescape HTML entities (already done by bs4 get_text usually, but be safe)
    s = html.unescape(s)
    s = s.replace(SOFT_HYPHEN, "")
    # Collapse exotic whitespace varieties to a regular space
    s = s.replace(NBSP, " ").replace(NARROW_NBSP, " ").replace(THIN_SPACE, " ")
    # Normalize CRLF → LF then collapse 3+ newlines
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _extract_body_text(body_tag: Tag | None) -> str:
    if body_tag is None:
        return ""
    # Preserve <img alt=…> for math (the site uses alt text like
    # "a = 50 минус 23 плюс 5 = 32.") by injecting alt before dropping the <img>
    for img in body_tag.find_all("img"):
        alt = img.get("alt", "")
        if alt:
            img.insert_before(f" {alt} ")
    # Replace <br> with newline before get_text
    for br in body_tag.find_all("br"):
        br.replace_with("\n")
    # `<p>` tags start new paragraphs
    for p in body_tag.find_all("p"):
        p.insert_before("\n")
    txt = body_tag.get_text(" ", strip=False)
    return _clean_text(txt)


def _parse_options(answers_div: Tag | None) -> dict[str, str]:
    """Extract the 4 option texts.  SdamGIA emits
    <div class="answers"> <div>1) a</div><div>2) b</div>…</div>
    """
    if answers_div is None:
        return {}
    out: dict[str, str] = {}
    # Direct children divs only
    children = [c for c in answers_div.children if isinstance(c, Tag) and c.name == "div"]
    letter_map = {"1": "A", "2": "B", "3": "C", "4": "D", "5": "E"}
    for idx, child in enumerate(children, 1):
        # Include <img alt> for math answers
        for img in child.find_all("img"):
            alt = img.get("alt", "")
            if alt:
                img.insert_before(f" {alt} ")
        txt = _clean_text(child.get_text(" ", strip=False))
        # Strip leading "N) " prefix
        m = re.match(r"^\s*([1-5])\s*[\)\.]\s*(.*)$", txt, re.DOTALL)
        if m:
            letter = letter_map.get(m.group(1))
            body = m.group(2).strip()
        else:
            # Fall back to positional
            letter = letter_map.get(str(idx))
            body = txt
        if letter and body:
            out[letter] = body
    return out


_ANS_RE = re.compile(r"Ответ[:\s]*([1-5])", re.IGNORECASE)


def _find_solution_div(block: Tag) -> Tag | None:
    """The solution <div id="solNNN" class="solution" ... class="pbody">  has
    two class attributes in raw HTML; bs4 keeps only the last one ("pbody"),
    so look up by id pattern instead."""
    return block.find("div", id=re.compile(r"^sol\d+$"))


def _extract_correct_letter(block: Tag) -> str | None:
    """The hidden <div class="answer" style="display:none"><span>Ответ: N</span></div>
    is the authoritative answer. Fall back to the solution's "Ответ: N" text.
    """
    letter_map = {"1": "A", "2": "B", "3": "C", "4": "D", "5": "E"}
    # Primary: div.answer
    ans_div = block.find("div", class_="answer")
    if ans_div is not None:
        m = _ANS_RE.search(ans_div.get_text(" ", strip=True))
        if m:
            return letter_map.get(m.group(1))
    # Fallback: within solution block
    sol = _find_solution_div(block)
    if sol is not None:
        m = _ANS_RE.search(sol.get_text(" ", strip=True))
        if m:
            return letter_map.get(m.group(1))
    return None


def _extract_solution_text(block: Tag) -> str:
    sol = _find_solution_div(block)
    if sol is None:
        return ""
    # Clone so we don't mutate parent
    for img in sol.find_all("img"):
        alt = img.get("alt", "")
        if alt:
            img.insert_before(f" {alt} ")
    for br in sol.find_all("br"):
        br.replace_with("\n")
    return _clean_text(sol.get_text(" ", strip=False))


def _extract_source_exams(block: Tag) -> list[str]:
    """SdamGIA exam-variant links: <a href="/test?id=NN">…</a>."""
    urls: list[str] = []
    seen = set()
    for a in block.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/test?id="):
            if href not in seen:
                seen.add(href)
                urls.append(href)
    return urls


_ID_RE = re.compile(r"/problem\?id=(\d+)")
_TYPE_RE = re.compile(r"Тип\s*(\d+)")


def _parse_block(block: Tag, subject_host: str) -> dict[str, Any] | None:
    # problem_id
    head = block.find("span", class_="prob_nums")
    if head is None:
        return None
    a = head.find("a", href=True)
    if a is None:
        return None
    m = _ID_RE.search(a["href"])
    if not m:
        return None
    problem_id = int(m.group(1))
    # type_num
    tm = _TYPE_RE.search(head.get_text(" ", strip=True))
    type_num = int(tm.group(1)) if tm else None

    # body text: <div id="body{maindiv_id}" class="pbody">
    body_tag = block.find("div", id=re.compile(r"^body\d+$"))
    question = _extract_body_text(body_tag)

    # passage: rl-ent only — <div id="text…" class="probtext">
    passage_tag = block.find("div", id=re.compile(r"^text\d+$"), class_="probtext")
    passage = _extract_body_text(passage_tag) if passage_tag else None

    # options: first .answers (not within solution)
    ans_div = None
    for div in block.find_all("div", class_="answers"):
        # Make sure it's not inside a solution block
        if div.find_parent("div", class_="solution") is None:
            ans_div = div
            break
    options = _parse_options(ans_div)

    # correct answer
    correct = _extract_correct_letter(block)

    # solution
    solution_text = _extract_solution_text(block)

    source_exams = [f"https://{subject_host}.sdamgia.ru{u}" for u in _extract_source_exams(block)]
    source_url = f"https://{subject_host}.sdamgia.ru/problem?id={problem_id}"

    return {
        "problem_id": problem_id,
        "type_num": type_num,
        "question": question,
        "passage": passage,
        "options": options,
        "correct": correct,
        "solution": solution_text,
        "source_url": source_url,
        "source_exam": source_exams,
    }


def parse_subject(subdomain: str, subject_slug: str, subject_name: str) -> dict[str, Any]:
    html_path = INPUT_DIR / f"{subdomain}_viewmany.html"
    if not html_path.exists():
        return {"subject": subdomain, "error": "input_missing", "path": str(html_path)}

    raw = html_path.read_text(encoding="utf-8")
    soup = BeautifulSoup(raw, "html.parser")

    blocks = soup.find_all("div", class_="prob_maindiv")
    out_rows: list[dict[str, Any]] = []
    stats = {
        "blocks_seen": len(blocks),
        "kept": 0,
        "no_problem_id": 0,
        "no_options": 0,
        "wrong_options": 0,
        "no_correct": 0,
        "with_passage": 0,
    }

    for block in blocks:
        parsed = _parse_block(block, subdomain)
        if not parsed:
            stats["no_problem_id"] += 1
            continue
        if not parsed["options"]:
            stats["no_options"] += 1
            continue
        if len(parsed["options"]) < 3:
            stats["wrong_options"] += 1
            continue
        if not parsed["correct"]:
            stats["no_correct"] += 1
            continue

        # Final JSONL row in ymnik-compatible shape
        correct_letter = parsed["correct"]
        # Validate the correct option exists in the option map; else drop
        if correct_letter not in parsed["options"]:
            stats["no_correct"] += 1
            continue

        row = {
            "source": "sdamgia_ent",
            "subject_slug": subject_slug,
            "subject": subject_name,  # pre-resolved canonical
            "lang": "ru",
            "problem_id": parsed["problem_id"],
            "type_num": parsed["type_num"],
            "question": parsed["question"],
            "passage": parsed["passage"],
            "options": parsed["options"],
            "correct_letters": [correct_letter],
            "format": "single",
            "solution_text": parsed["solution"],
            "source_url": parsed["source_url"],
            "source_exam": parsed["source_exam"],
        }
        out_rows.append(row)
        stats["kept"] += 1
        if parsed["passage"]:
            stats["with_passage"] += 1

    # dedupe within subject by problem_id (should already be unique)
    by_id: dict[int, dict[str, Any]] = {}
    for r in out_rows:
        by_id[r["problem_id"]] = r
    stats["unique_problem_ids"] = len(by_id)

    # Write JSONL
    out_path = OUTPUT_DIR / f"{subdomain}.jsonl"
    with out_path.open("w", encoding="utf-8") as f:
        for pid in sorted(by_id):
            f.write(json.dumps(by_id[pid], ensure_ascii=False) + "\n")

    stats["output_path"] = str(out_path)
    return {"subject": subdomain, "subject_name": subject_name, "stats": stats}


def main() -> int:
    summary = {}
    for subdomain, (slug, name) in SUBJECTS.items():
        print(f"parsing {subdomain} → {name} …")
        summary[subdomain] = parse_subject(subdomain, slug, name)

    # Persist a summary.json for audit (avoid printing Cyrillic through cmd)
    (OUTPUT_DIR / "parse_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ASCII-only console summary
    for subdomain, info in summary.items():
        st = info.get("stats", {})
        print(
            f"  {subdomain:<9} "
            f"blocks={st.get('blocks_seen', '?'):<6} "
            f"kept={st.get('kept', '?'):<6} "
            f"unique={st.get('unique_problem_ids', '?'):<6} "
            f"no_opt={st.get('no_options', '?'):<4} "
            f"bad_opt={st.get('wrong_options', '?'):<4} "
            f"no_ans={st.get('no_correct', '?'):<4} "
            f"w_passage={st.get('with_passage', '?')}"
        )

    grand = sum(info.get("stats", {}).get("kept", 0) for info in summary.values())
    print(f"TOTAL kept: {grand}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
