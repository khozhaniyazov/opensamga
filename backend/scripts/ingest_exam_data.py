import asyncio
import json
import sys
from pathlib import Path

# Add project root to path
current_dir = Path(__file__).resolve().parent
project_root = current_dir.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import delete

from app.constants.subjects import normalize_subject_name
from app.database import AsyncSessionLocal
from app.models import ExamQuestion


async def ingest_file(db, filepath: Path):
    print(f"Ingesting {filepath.name}...")
    with open(filepath, encoding="utf-8") as f:
        data = json.load(f)

    questions_added = 0

    for subject_data in data.get("subjects", []):
        raw_subject_name = subject_data.get("subject_name_ru") or subject_data.get(
            "subject_name_kz"
        )
        canonical_subject = normalize_subject_name(raw_subject_name)

        # Process regular questions
        for q in subject_data.get("questions", []):
            db.add(
                ExamQuestion(
                    subject=canonical_subject,
                    source_id=q["question_id"],
                    format=q["format"],
                    max_points=q["max_points"],
                    question_text_kz=q["question_text_kz"],
                    question_text_ru=q["question_text_ru"],
                    options_kz=q["options_kz"],
                    options_ru=q["options_ru"],
                    correct_answers_indices=q["correct_answers_indices"],
                )
            )
            questions_added += 1

        # Process context clusters
        for cluster in subject_data.get("context_clusters", []):
            stimulus_kz = cluster["stimulus_kz"]
            stimulus_ru = cluster["stimulus_ru"]
            cluster_id = cluster["cluster_id"]

            for q in cluster.get("child_questions", []):
                db.add(
                    ExamQuestion(
                        subject=canonical_subject,
                        source_id=q["question_id"],
                        format="context",
                        max_points=q["max_points"],
                        question_text_kz=q["question_text_kz"],
                        question_text_ru=q["question_text_ru"],
                        options_kz=q["options_kz"],
                        options_ru=q["options_ru"],
                        correct_answers_indices=q["correct_answers_indices"],
                        context_stimulus_kz=stimulus_kz,
                        context_stimulus_ru=stimulus_ru,
                        context_group_id=cluster_id,
                    )
                )
                questions_added += 1

    await db.commit()
    print(f" => Added {questions_added} questions from {filepath.name}")


async def main():
    data_dir = project_root.parent / "exam-database-sample"
    if not data_dir.exists():
        print(f"X Directory not found: {data_dir}")
        return

    json_files = list(data_dir.glob("*.json"))
    print(f"Found {len(json_files)} JSON files.")

    # Create tables if they don't exist
    from sqlalchemy import text

    from app.database import engine
    from app.models import Base

    async with engine.begin() as conn:
        print("Dropping old table structure...")
        await conn.execute(text("DROP TABLE IF EXISTS exam_questions CASCADE"))
        print("Creating new table structure...")
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        print("Wiping existing exam questions...")
        await db.execute(delete(ExamQuestion))
        await db.commit()

        for file_path in json_files:
            await ingest_file(db, file_path)

    print("Ingestion complete!")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
