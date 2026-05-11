"""
Visual regression diff triage using DashScope qwen-vl-max.

Walks an input directory recursively looking for triplets:
  <name>-expected.png, <name>-actual.png, <name>-diff.png

Naming convention used by this project (from diff_pairs.py):
  <screen>-expected.png  = baseline golden
  <screen>-actual.png    = regressed screenshot
  <screen>-diff.png      = pixel-diff visualization

Sends all three as base64 to qwen-vl-max and collects JSON verdicts.

Usage:
  python triage_diffs.py <input_dir> [--dry-run] [--out <path>]
"""

import base64
import json
import os
import sys
import argparse
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print("pip install openai first", file=sys.stderr)
    sys.exit(1)

_API_KEY = os.environ.get("DASHSCOPE_API_KEY")
if not _API_KEY:
    print("DASHSCOPE_API_KEY environment variable is required", file=sys.stderr)
    sys.exit(1)
client = OpenAI(
    api_key=_API_KEY,
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

SYSTEM_PROMPT = (
    "You are a visual regression triager for Samga.ai, a student exam-prep platform.\n"
    "I will show you three images from a Playwright snapshot test:\n"
    "1. BASELINE (expected): the committed golden reference.\n"
    "2. ACTUAL: the screenshot just captured.\n"
    "3. DIFF: pixel difference visualization (magenta/red on black where pixels differ).\n\n"
    "Classify the change as exactly one of:\n"
    "- REGRESSION - a real user-visible bug: missing element, broken layout, wrong copy, "
    "accessibility issue, text overflow, broken image, blank iframe.\n"
    "- INTENTIONAL - looks like a deliberate design or copy change that is visually coherent.\n"
    "- NOISE - sub-pixel font rendering, timestamp rotation, avatar randomness, "
    "today-highlight on a date picker.\n\n"
    "Respond with ONLY a JSON object, no markdown fences:\n"
    '{"verdict": "<REGRESSION|INTENTIONAL|NOISE>", "confidence": <0.0-1.0>, '
    '"severity": "<HIGH|MEDIUM|LOW|NONE>", "reason": "<one sentence>"}'
)


def encode(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("ascii")


def find_triplets(root: Path):
    """Yield (screen_name, expected, actual, diff) Path tuples."""
    expected_files = sorted(root.rglob("*-expected.png"))
    for exp in expected_files:
        stem = exp.name.replace("-expected.png", "")
        actual = exp.parent / f"{stem}-actual.png"
        diff = exp.parent / f"{stem}-diff.png"
        if actual.is_file() and diff.is_file():
            yield (stem, exp, actual, diff)


def triage_one(expected: Path, actual: Path, diff: Path, max_retries: int = 2):
    """Send triplet to qwen-vl-max, return parsed JSON dict."""
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model="qwen-vl-max",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "BASELINE:"},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{encode(expected)}"},
                            },
                            {"type": "text", "text": "ACTUAL:"},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{encode(actual)}"},
                            },
                            {"type": "text", "text": "DIFF:"},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{encode(diff)}"},
                            },
                            {"type": "text", "text": SYSTEM_PROMPT},
                        ],
                    }
                ],
                temperature=0.0,
                max_tokens=300,
            )
            text = resp.choices[0].message.content.strip()
            # Strip markdown fences if present
            if text.startswith("```"):
                text = "\n".join(text.split("\n")[1:-1])
            return json.loads(text)
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"  [RETRY] {type(e).__name__}: {e}")
            else:
                return {
                    "verdict": "ERROR",
                    "confidence": 0.0,
                    "severity": "NONE",
                    "reason": f"API error: {type(e).__name__}: {e}",
                }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", help="Directory containing triplet subfolders")
    parser.add_argument("--dry-run", action="store_true", help="List triplets without calling API")
    parser.add_argument("--out", default=None, help="Output JSON path (default: triage-<date>.json)")
    args = parser.parse_args()

    root = Path(args.input_dir)
    if not root.is_dir():
        print(f"ERROR: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    triplets = list(find_triplets(root))
    if not triplets:
        print("No triplets found. Expected files matching *-expected.png")
        sys.exit(0)

    print(f"Found {len(triplets)} triplet(s):\n")
    print(f"{'Screen':<45} {'Verdict':<12} {'Conf':>4} {'Sev':<8} {'Reason':<30}")
    print("-" * 140)

    results = []
    for screen_name, exp, act, diff in triplets:
        if args.dry_run:
            print(f"  DRY-RUN: {screen_name}")
            print(f"    expected: {exp}")
            print(f"    actual:   {act}")
            print(f"    diff:     {diff}")
            continue

        verdict = triage_one(exp, act, diff)
        reason_short = (verdict.get("reason", "") or "")[:30]
        print(
            f"{screen_name:<45} {verdict.get('verdict', '??'):<12} "
            f"{verdict.get('confidence', 0):>4.2f} {verdict.get('severity', '??'):<8} "
            f"{reason_short:<30}"
        )
        results.append(
            {
                "screen": screen_name,
                **verdict,
                "image_paths": {
                    "expected": str(exp),
                    "actual": str(act),
                    "diff": str(diff),
                },
            }
        )

    if not args.dry_run and results:
        out_path = Path(
            args.out
            if args.out
            else root.parent / "triage-2026-04-24.json"
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nResults written to {out_path}")


if __name__ == "__main__":
    main()
