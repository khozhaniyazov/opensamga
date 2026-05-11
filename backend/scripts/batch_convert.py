"""
scripts/batch_convert.py
------------------------
Batch processes the entire 'dataset/raw_library' folder.
Converts every PDF into a Markdown file in 'dataset/converted_library'.
Uses the logic from 'convert_scanned_book.py' via subprocess.
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from tqdm import tqdm

# --- CONFIGURATION ---
# Define where your raw PDFs are and where you want the Markdown files
INPUT_ROOT = Path("../dataset/raw_library")
OUTPUT_ROOT = Path("../dataset/converted_library")
CONVERTER_SCRIPT = Path("scripts/convert_scanned_book.py")


def get_all_pdfs(root_dir):
    """Recursively find all .pdf files."""
    return list(root_dir.rglob("*.pdf"))


def run_batch():
    # 1. Validation
    if not INPUT_ROOT.exists():
        print(f"❌ Error: Input directory '{INPUT_ROOT.resolve()}' does not exist.")
        print("Please create it and organize your PDFs inside like: Mathematics/10/algebra.pdf")
        return

    if not CONVERTER_SCRIPT.exists():
        print(f"❌ Error: Converter script '{CONVERTER_SCRIPT}' not found.")
        print("Make sure you are running this from the 'backend' folder.")
        return

    # 2. Discovery
    print(f"🔍 Scanning {INPUT_ROOT} for PDFs...")
    all_pdfs = get_all_pdfs(INPUT_ROOT)

    if not all_pdfs:
        print("⚠️  No PDFs found. Add some books to 'dataset/raw_library'!")
        return

    print(f"📚 Found {len(all_pdfs)} books in library.\n")

    # 3. Processing Loop
    success_count = 0
    skipped_count = 0
    error_count = 0

    for pdf_path in tqdm(all_pdfs, desc="Total Library Progress", unit="book"):
        # Calculate relative path to mirror structure
        # e.g., source: raw_library/Mathematics/10/algebra.pdf
        # rel_path: Mathematics/10/algebra.pdf
        try:
            rel_path = pdf_path.relative_to(INPUT_ROOT)
        except ValueError:
            # Fallback if paths get weird on Windows
            rel_path = Path(pdf_path.name)

        # Determine output path
        # e.g., converted_library/Mathematics/10/algebra.md
        output_md_path = OUTPUT_ROOT / rel_path.with_suffix(".md")

        # Check if already done
        if output_md_path.exists():
            # Optional: Check if file size is > 0 to ensure it wasn't a failed run
            if output_md_path.stat().st_size > 0:
                tqdm.write(f"⏭️  Skipping {pdf_path.name} (Already converted)")
                skipped_count += 1
                continue

        tqdm.write(f"\n🚀 Starting conversion: {pdf_path.name}")
        tqdm.write(f"   📂 Output: {output_md_path}")

        # Ensure output directory exists (e.g., creates Mathematics/10/)
        output_md_path.parent.mkdir(parents=True, exist_ok=True)

        # 4. Call the Single-Book Converter
        # We call it as a subprocess to ensure clean memory management between massive books
        cmd = [
            sys.executable,
            str(CONVERTER_SCRIPT),
            str(pdf_path),
            "--limit",
            "0",  # Process ALL pages
        ]

        try:
            # Run the script and capture output (so it doesn't mess up our progress bar)
            # We allow it to print to stdout so you can see the page progress
            subprocess.run(cmd, check=True)

            # The script saves to 'dataset/converted_books' by default.
            # We need to move that file to our structured 'converted_library' folder.
            default_output = Path("dataset/converted_books") / f"{pdf_path.stem}.md"

            if default_output.exists():
                # Move/Rename
                if output_md_path.exists():
                    os.remove(output_md_path)  # Clean up if partial exists
                default_output.rename(output_md_path)
                tqdm.write("✅ Success! Saved to correct folder.")
                success_count += 1
            else:
                tqdm.write(
                    "⚠️  Warning: Script finished but output file not found at expected location."
                )
                error_count += 1

        except subprocess.CalledProcessError as e:
            tqdm.write(f"❌ Failed to convert {pdf_path.name}. Error code: {e.returncode}")
            error_count += 1
        except Exception as e:
            tqdm.write(f"❌ Unexpected error on {pdf_path.name}: {e}")
            error_count += 1

    # 5. Final Report
    print("\n" + "=" * 40)
    print("🎉 BATCH PROCESSING COMPLETE")
    print(f"✅ Converted: {success_count}")
    print(f"⏭️  Skipped:   {skipped_count}")
    print(f"❌ Failed:    {error_count}")
    print("=" * 40)


if __name__ == "__main__":
    # Windows fix not needed here as we use subprocess, but good practice
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    run_batch()
