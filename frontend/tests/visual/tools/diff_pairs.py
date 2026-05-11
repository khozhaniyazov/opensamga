"""
diff_pairs.py

Generate expected/actual/diff triplets for Qwen-VL triage.

Usage:
    python diff_pairs.py <reg_dir> <baseline_dir> <out_dir>

Example:
    python diff_pairs.py \
        ../snapshots.reg2.spec.ts-snapshots \
        ../snapshots.spec.ts-snapshots \
        ../triage-inputs/reg2

For each *-reg2*.png in reg_dir, finds the matching baseline by removing
"-reg2" from the filename stem, computes a diff image, and writes:
    out_dir/<screen>/<screen>-expected.png
    out_dir/<screen>/<screen>-actual.png
    out_dir/<screen>/<screen>-diff.png
"""

import sys
from pathlib import Path
from PIL import Image


def compute_diff(expected_path: Path, actual_path: Path, diff_path: Path):
    """Compute a magenta-on-black diff of two identically-sized PNGs."""
    exp = Image.open(expected_path).convert("RGB")
    act = Image.open(actual_path).convert("RGB")

    if exp.size != act.size:
        max_w = max(exp.width, act.width)
        max_h = max(exp.height, act.height)
        new_exp = Image.new("RGB", (max_w, max_h), (0, 0, 0))
        new_act = Image.new("RGB", (max_w, max_h), (0, 0, 0))
        new_exp.paste(exp, (0, 0))
        new_act.paste(act, (0, 0))
        exp = new_exp
        act = new_act

    diff = Image.new("RGB", exp.size, (0, 0, 0))
    diff_pixels = diff.load()
    exp_pixels = exp.load()
    act_pixels = act.load()

    for y in range(exp.height):
        for x in range(exp.width):
            if exp_pixels[x, y] != act_pixels[x, y]:
                diff_pixels[x, y] = (255, 0, 255)  # bright magenta

    diff.save(diff_path)


def main():
    if len(sys.argv) < 4:
        print("Usage: python diff_pairs.py <reg_dir> <baseline_dir> <out_dir>")
        sys.exit(1)

    reg_dir = Path(sys.argv[1])
    baseline_dir = Path(sys.argv[2])
    out_dir = Path(sys.argv[3])

    if not reg_dir.exists():
        print(f"ERROR: reg_dir does not exist: {reg_dir}")
        sys.exit(1)

    found = 0
    for reg_file in sorted(reg_dir.glob("*.png")):
        name = reg_file.stem  # e.g. library-grid-reg2-chromium-win32
        if "-reg2" not in name and "-reg3" not in name:
            continue

        screen = name
        if screen.endswith("-chromium-win32"):
            screen = screen[:-len("-chromium-win32")]
        elif screen.endswith("-win32"):
            screen = screen[:-len("-win32")]

        baseline_name = name.replace("-reg2", "").replace("-reg3", "")
        baseline_file = baseline_dir / f"{baseline_name}.png"

        if not baseline_file.exists():
            print(f"SKIP: no baseline for {name} (looked for {baseline_file})")
            continue

        screen_dir = out_dir / screen
        screen_dir.mkdir(parents=True, exist_ok=True)

        exp_out = screen_dir / f"{screen}-expected.png"
        act_out = screen_dir / f"{screen}-actual.png"
        diff_out = screen_dir / f"{screen}-diff.png"

        import shutil
        shutil.copy(baseline_file, exp_out)
        shutil.copy(reg_file, act_out)

        compute_diff(baseline_file, reg_file, diff_out)
        print(f"OK: {screen} -> {screen_dir}")
        found += 1

    print(f"\nTotal triplets written: {found}")


if __name__ == "__main__":
    main()
