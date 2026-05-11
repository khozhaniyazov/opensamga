import json
import os

# CONFIGURATION
INPUT_FILE = os.path.join(os.getcwd(), "data", "math_knowledge_graph.json")
OUTPUT_FILE = os.path.join(os.getcwd(), "data", "math_master_graph.json")


def merge_graph():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ Input file not found: {INPUT_FILE}")
        return

    print(f"📂 Reading {INPUT_FILE}...")
    with open(INPUT_FILE, encoding="utf-8") as f:
        raw_data = json.load(f)

    print(f"   -> Loaded {len(raw_data)} raw concepts.")

    master_graph = {}

    for item in raw_data:
        # 1. Normalize ID (lowercase, strip spaces)
        concept_id = item["id"].lower().strip().replace(" ", "_")

        # 2. Create entry if new
        if concept_id not in master_graph:
            master_graph[concept_id] = {
                "id": concept_id,
                "name_kz": item["name_kz"],  # Keep the first name found
                "definition_kz": item["definition_kz"],  # Keep the first def found
                "prerequisites": set(),
                "found_in": [],  # Track which grades/books contain this
            }

        # 3. Merge Prerequisites (Union)
        if "prerequisites" in item:
            for req in item["prerequisites"]:
                req_clean = req.lower().strip().replace(" ", "_")
                master_graph[concept_id]["prerequisites"].add(req_clean)

        # 4. Track Metadata (Where is this concept?)
        source_info = {
            "grade": item.get("source_grade", "Unknown"),
            "file": item.get("source_file", "Unknown"),
        }
        # Avoid duplicate source entries
        if source_info not in master_graph[concept_id]["found_in"]:
            master_graph[concept_id]["found_in"].append(source_info)

    # 5. Convert Sets to Lists for JSON
    final_output = []
    for _cid, data in master_graph.items():
        data["prerequisites"] = list(data["prerequisites"])
        final_output.append(data)

    # 6. Save
    print(f"✨ Merged into {len(final_output)} unique Master Concepts.")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)

    print(f"💾 Saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    merge_graph()
