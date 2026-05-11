import json
import os
import sys
import time

from openai import OpenAI

# 1. SETUP
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    print("❌ Error: OPENAI_API_KEY not found in environment variables.")
    sys.exit(1)

client = OpenAI(api_key=api_key)
MODEL = "gpt-4o-mini"

# 2. CONFIGURATION
# Path to Chemistry library
BASE_PATH = r"C:\UNT_DEBUGGING\dataset\converted_library\Chemistry"
TARGET_FOLDERS = ["7", "8", "9", "10", "11"]

# Output file
OUTPUT_FILE = os.path.join(os.getcwd(), "data", "chemistry_knowledge_graph.json")

CHUNK_SIZE_CHARS = 15000

# 3. PROMPT (Chemistry Context)
SYSTEM_PROMPT = """
You are an expert Chemistry Curriculum Developer for the Kazakhstan National Testing Center (UNT).
Your task is to analyze an educational Markdown file (in KAZAKH) and extract a Knowledge Graph.

RULES:
1. Identify KEY CONCEPTS (Chemical Elements, Reactions, Formulas, Definitions).
2. Identify PREREQUISITES: If concept A is needed for concept B, list A as a prerequisite.
3. OUTPUT IN STRICT JSON FORMAT.
4. Keep 'name_kz' and 'definition_kz' in KAZAKH.
5. Use 'id' in English Snake Case (e.g., "covalent_bond") for linking.

JSON FORMAT:
{
  "concepts": [
    {
      "id": "english_id_snake_case",
      "name_kz": "Concept Name in Kazakh",
      "definition_kz": "Short definition in Kazakh",
      "prerequisites": ["english_id_dependency"]
    }
  ]
}
"""


def clean_markdown_chatter(text):
    lines = text.split("\n")
    if (
        len(lines) > 0
        and len(lines[0]) < 100
        and ("markdown" in lines[0].lower() or "sure" in lines[0].lower())
    ):
        return "\n".join(lines[1:])
    return text


def extract_from_chunk_with_retry(text_chunk, chunk_index, filename, retries=3):
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": f"ANALYZE THIS TEXT SEGMENT (Part {chunk_index} of {filename}):\n\n{text_chunk}",
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            print(f"     ⚠️ Error on chunk {chunk_index} (Attempt {attempt + 1}/{retries}): {e}")
            if attempt < retries - 1:
                print("     🔄 Retrying...")
                time.sleep(1)
            else:
                print("     ❌ Failed after 3 attempts. Skipping chunk.")
                return {"concepts": []}


def read_and_chunk_markdown(file_path, size):
    try:
        with open(file_path, encoding="utf-8") as f:
            text = f.read()
    except UnicodeDecodeError:
        with open(file_path, encoding="latin-1") as f:
            text = f.read()

    text = clean_markdown_chatter(text)

    chunks = []
    current_chunk = ""
    paragraphs = text.split("\n\n")

    for para in paragraphs:
        if len(current_chunk) + len(para) < size:
            current_chunk += para + "\n\n"
        else:
            chunks.append(current_chunk)
            current_chunk = para + "\n\n"
    if current_chunk:
        chunks.append(current_chunk)
    return chunks


def main():
    if not os.path.exists(BASE_PATH):
        print(f"❌ Base path not found: {BASE_PATH}")
        return

    all_data = []
    total_files_processed = 0

    print("🚀 Starting CHEMISTRY Extraction...")
    print(f"📂 Reading from: {BASE_PATH}")
    print(f"💾 Saving to: {OUTPUT_FILE}\n")

    for folder in TARGET_FOLDERS:
        folder_path = os.path.join(BASE_PATH, folder)
        if not os.path.exists(folder_path):
            print(f"⚠️ Folder not found: {folder} (Skipping)")
            continue

        print(f"🔹 Scanning Grade {folder}...")

        files = [f for f in os.listdir(folder_path) if f.endswith(".md")]

        if not files:
            print(f"   (No .md files found in Grade {folder})")

        for file in files:
            file_path = os.path.join(folder_path, file)
            print(f"  📖 Processing Book: {file}")

            chunks = read_and_chunk_markdown(file_path, CHUNK_SIZE_CHARS)
            print(f"     -> {len(chunks)} chunks detected.")

            for i, chunk in enumerate(chunks):
                data = extract_from_chunk_with_retry(chunk, i + 1, file)

                if "concepts" in data:
                    for concept in data["concepts"]:
                        concept["source_grade"] = folder
                        concept["source_file"] = file

                    count = len(data["concepts"])
                    all_data.extend(data["concepts"])
                    print(f"     ✅ Chunk {i + 1}/{len(chunks)}: Found {count} concepts")
                else:
                    print(f"     ⚠️ Chunk {i + 1}/{len(chunks)}: No data found.")

            total_files_processed += 1
            print("")

    print(f"\n💾 Saving {len(all_data)} CHEMISTRY concepts...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    print(f"🎉 COMPLETED! Processed {total_files_processed} books.")
    print(f"👉 FILE SAVED AT: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
