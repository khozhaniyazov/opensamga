"""
scripts/convert_scanned_book.py
-------------------------------
OCR Converter: Scanned PDF -> Markdown + LaTeX
Uses OpenAI GPT-4o-mini Vision to transcribe pages.
Optimized for KAZAKH Language and Math.
Includes Image Pre-processing to remove "Не для печати" watermarks.
"""

import argparse
import asyncio
import base64
import io
import os
import sys
from pathlib import Path

import fitz  # PyMuPDF
from openai import AsyncOpenAI
from PIL import Image  # Required for Image Processing
from tqdm.asyncio import tqdm

# --- CONFIGURATION ---
CONCURRENCY_LIMIT = 5
ZOOM_FACTOR = 2.0  # High resolution for math symbols
THRESHOLD_VALUE = 200  # Pixels brighter than this (0-255) become pure white

# OpenAI client is lazily initialised inside main() so imports don't fail on
# hosts that don't have the env var set (e.g. CI + test collection).
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"


def _build_client() -> AsyncOpenAI:
    api_key = os.environ.get(OPENAI_API_KEY_ENV)
    if not api_key:
        raise SystemExit(
            f"Missing {OPENAI_API_KEY_ENV}. Export it before running "
            "convert_scanned_book (this script talks to OpenAI Vision)."
        )
    return AsyncOpenAI(api_key=api_key)


def preprocess_image(pix):
    """
    Converts a PyMuPDF Pixmap to a PIL Image, applies binarization
    to remove watermarks, and returns a base64 encoded string.
    """
    # 1. Convert PyMuPDF Pixmap to PIL Image
    # Ensure RGB mode (PyMuPDF sometimes returns other formats)
    if pix.n < 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)

    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

    # 2. Binarize the Image (Thresholding)
    # Convert to Grayscale ('L' mode)
    gray_img = img.convert("L")

    # Logic: If pixel value > 200 (light gray/blue/white) -> Set to 255 (Pure White)
    #        If pixel value <= 200 (dark text) -> Set to 0 (Pure Black)
    # This effectively "erases" the light blue watermark.
    binary_img = gray_img.point(lambda p: 255 if p > THRESHOLD_VALUE else 0)

    # 3. Convert to Base64
    # We use PNG here because it handles sharp black/white edges better than JPEG
    buffered = io.BytesIO()
    binary_img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


async def transcribe_page(page_num, page, semaphore, client):
    """
    Renders a PDF page to an image, cleans it, and sends it to GPT-4o-mini.
    """
    async with semaphore:
        try:
            # 1. Render page to image (High Res)
            mat = fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR)
            pix = page.get_pixmap(matrix=mat)

            # 2. Pre-process (Clean watermark) and Encode
            base64_image = preprocess_image(pix)

            # 3. Call OpenAI Vision API
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an expert OCR transcription engine for educational textbooks in **Kazakhstan**.\n"
                            "Transcribe the text from this image into clean, structured Markdown.\n\n"
                            "**CRITICAL RULES:**\n"
                            "1. **Language:** The text is in **Kazakh** (Cyrillic). You MUST preserve specific Kazakh characters (Ә, І, Ң, Ғ, Ү, Ұ, Қ, Ө, Һ) exactly.\n"
                            "2. **Math:** Convert ALL mathematical formulas to **LaTeX** format (e.g., $x^2$ for inline, $$...$$ for block).\n"
                            "3. **Cleaning:** Ignore any watermarks, stamps, or background text like 'Не для печати'. Transcribe only the main educational content.\n"
                            "4. **Structure:** Preserve headings, lists, and bold text.\n"
                            "5. **Clean Output:** Do NOT describe the image. Output ONLY the markdown content.\n"
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}",
                                    "detail": "high",
                                },
                            }
                        ],
                    },
                ],
                max_tokens=2000,
                temperature=0.0,  # Deterministic output
            )

            markdown_content = response.choices[0].message.content
            return page_num, markdown_content

        except Exception as e:
            print(f"\n❌ Error processing Page {page_num}: {e}")
            return page_num, ""


async def main():
    parser = argparse.ArgumentParser(description="Convert Scanned PDF to Markdown with LaTeX")
    parser.add_argument("pdf_path", help="Path to the input PDF file")
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Number of pages to process (Default: 5). Set to 0 for all.",
    )
    args = parser.parse_args()

    input_path = Path(args.pdf_path)
    if not input_path.exists():
        print(f"Error: File not found at {input_path}")
        return

    # Setup Output Path
    output_dir = Path("dataset/converted_books")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"{input_path.stem}.md"

    print(f"📖 Opening {input_path.name}...")
    doc = fitz.open(input_path)
    total_pages = len(doc)

    # Determine page limit
    limit = args.limit if args.limit > 0 else total_pages
    process_count = min(limit, total_pages)

    print(f"🤖 Processing {process_count} pages using GPT-4o-mini (Vision)...")
    print(f"🧹 Image Processing: Watermark Removal Active (Threshold: {THRESHOLD_VALUE})")
    print("🌍 Mode: Kazakh Language (Cyrillic) + LaTeX Math")
    print(f"💾 Output will be saved to: {output_file}")

    # Create Semaphore to control concurrency
    sem = asyncio.Semaphore(CONCURRENCY_LIMIT)
    tasks = []

    # Initialise OpenAI client lazily (env-driven). Fails fast if the env var
    # is missing, instead of carrying a credential string in source.
    client = _build_client()

    # Create Tasks
    for i in range(process_count):
        tasks.append(transcribe_page(i + 1, doc[i], sem, client))

    # Run with Progress Bar
    results = []
    for f in tqdm.as_completed(tasks, total=len(tasks), desc="Transcribing"):
        res = await f
        results.append(res)

    # Sort results by page number
    results.sort(key=lambda x: x[0])

    # Write to File
    print("\n✍️  Writing to file...")
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"# {input_path.stem}\n\n")
        f.write("*Transcribed via Samga.ai Vision Engine (Cleaned)*\n")
        f.write(f"*Original Pages: {process_count}*\n\n---\n\n")

        for page_num, text in results:
            f.write(f"## Page {page_num}\n\n")
            f.write(text)
            f.write("\n\n---\n\n")

    print(f"✅ Done! Markdown saved to {output_file}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
