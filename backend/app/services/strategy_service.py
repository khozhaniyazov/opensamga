"""
app/services/strategy_service.py
---------------------------------
University Strategist Service

Generates personalized roadmaps to help students reach their target
university's grant score threshold.
"""

import asyncio
import json
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.openai_failover import OpenAIFailoverClient as OpenAI

logger = logging.getLogger(__name__)

from ..config import settings
from ..models import (
    ActivityLog,
    ActivityType,
    StudentProfile,
    UniversityData,
    UniversityDetail,
    User,
)
from ..utils.unt_scoring import convert_to_unt_score

# Initialize OpenAI client
client = OpenAI(api_key=settings.OPENAI_API_KEY.get_secret_value())


def simplify_university_name(full_name: str) -> str:
    """
    Simplify a university name for database lookup by:
    1. Removing "имени..." (named after...) suffixes
    2. Using only the first 3-4 significant words
    3. Preserving important acronyms and keywords (IT, AI, etc.)

    Example:
        "Казахский национальный медицинский университет имени С.Д.Асфендиярова"
        -> "Казахский национальный медицинский университет"

        "Astana IT University"
        -> "Astana IT University" (preserves IT)
    """
    if not full_name:
        return ""

    # Remove "имени..." and similar suffixes (case-insensitive)
    # Pattern to match "имени [name]" or "named after [name]" patterns
    name = re.sub(
        r"\s+имени\s+[А-ЯЁA-Z][^\s]*\s*[А-ЯЁA-Z\.]*[^\s]*", "", full_name, flags=re.IGNORECASE
    )
    name = re.sub(r"\s+named\s+after\s+[A-Z][^\s]*\s*[A-Z\.]*[^\s]*", "", name, flags=re.IGNORECASE)

    # Split into words
    words = name.split()

    # Important keywords/acronyms to preserve (even if short)
    important_keywords = {"IT", "AI", "CS", "STEM", "KZ", "RU", "EN", "UK"}

    # Filter words: keep important keywords, or words longer than 2 characters
    significant_words = []
    for w in words:
        w_upper = w.upper()
        # Keep if it's an important keyword or if it's longer than 2 chars
        if w_upper in important_keywords or len(w) > 2:
            significant_words.append(w)

    # Take first 4 words (or all if less than 4) to preserve structure
    simplified = (
        " ".join(significant_words[:4])
        if len(significant_words) >= 4
        else " ".join(significant_words)
    )

    return simplified.strip()


async def generate_strategy(db: AsyncSession, user_id: int, language: str | None = None) -> dict:
    """
    Generate a personalized roadmap for the student to reach their target university.

    Steps:
    1. Fetch user's StudentProfile to get target_university_id
    2. Fetch UniversityData to get grant_threshold_general
    3. Calculate current score from ActivityLog (TEST_COMPLETED)
    4. Identify gap and weakest subject
    5. Generate AI roadmap

    Args:
        db: Database session
        user_id: User ID
        language: Optional language override ('ru' or 'kz'). If provided, overrides auto-detection.

    Returns:
        Dict with status, gap, weakest_subject, and roadmap
    """

    # Step 1: Fetch User Profile
    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalars().first()  # Use .first() to handle duplicates

    if not user:
        return {"status": "error", "message": "User not found"}

    # Get profile
    profile_query = select(StudentProfile).where(StudentProfile.user_id == user_id)
    profile_result = await db.execute(profile_query)
    profile = profile_result.scalars().first()  # Use .first() to handle duplicates

    # Step 2: Fetch Target University
    target_university_id = profile.target_university_id if profile else None
    grant_threshold = 100  # Default threshold

    # Step 2a: Get Display Name from UniversityDetail (canonical source)
    university_name = None
    if target_university_id:
        # Query UniversityDetail table first (this is what the frontend uses)
        detail_query = select(UniversityDetail).where(UniversityDetail.id == target_university_id)
        detail_result = await db.execute(detail_query)
        university_detail = detail_result.scalars().first()  # Use .first() to handle duplicates

        if university_detail:
            # Get the display name from UniversityDetail (this is what we'll return in the final JSON)
            university_name = university_detail.full_name

            # Simplify the name for UniversityData lookup (remove "имени..." suffixes, use first 3-4 words)
            simplified_search_name = simplify_university_name(university_name)

            # Step 2b: Get Grant Threshold from UniversityData using multiple search strategies
            # Try to find matching grant threshold data
            grant_threshold = 110  # Default threshold (increased from 100 for safety)

            if simplified_search_name:
                # Strategy 1: Try exact match with full name first
                data_query = (
                    select(UniversityData)
                    .where(UniversityData.uni_name.ilike(f"%{university_name}%"))
                    .limit(1)
                )
                data_result = await db.execute(data_query)
                university_data = data_result.scalars().first()  # Use .first() to handle duplicates

                # Strategy 2: If not found, try with simplified name
                if not university_data:
                    data_query = (
                        select(UniversityData)
                        .where(UniversityData.uni_name.ilike(f"%{simplified_search_name}%"))
                        .limit(1)
                    )
                    data_result = await db.execute(data_query)
                    university_data = (
                        data_result.scalars().first()
                    )  # Use .first() to handle duplicates

                # Strategy 3: If still not found, try with first 2-3 words (more aggressive simplification)
                if not university_data:
                    words = simplified_search_name.split()
                    if len(words) >= 2:
                        short_name = " ".join(words[:2])  # e.g., "Astana IT" or "Astana University"
                        data_query = (
                            select(UniversityData)
                            .where(UniversityData.uni_name.ilike(f"%{short_name}%"))
                            .limit(1)
                        )
                        data_result = await db.execute(data_query)
                        university_data = (
                            data_result.scalars().first()
                        )  # Use .first() to handle duplicates

                if university_data and university_data.grant_threshold_general:
                    grant_threshold = university_data.grant_threshold_general

    # Calculate Safety Target: Add 10 points for safety margin, but never exceed UNT maximum of 140
    target_score = min(grant_threshold + 10, 140)

    # If no university selected, we'll set a localized placeholder later after language detection

    # Step 3: Calculate Current Score from ActivityLog
    # Query all TEST_COMPLETED activities for this user
    activity_query = (
        select(ActivityLog)
        .where(
            ActivityLog.user_id == user_id, ActivityLog.activity_type == ActivityType.TEST_COMPLETED
        )
        .order_by(ActivityLog.created_at.desc())
    )
    activity_result = await db.execute(activity_query)
    activities = activity_result.scalars().all()

    # Language handling: Use explicit language if provided, otherwise auto-detect
    def detect_language(text):
        """Simple language detection: returns 'ru', 'kz', or 'en'"""
        if not text:
            return "ru"  # Default to Russian

        text_lower = text.lower()
        # Check for Kazakh-specific characters
        kazakh_chars = ["ә", "і", "ң", "ғ", "ү", "ұ", "қ", "ө", "һ"]
        if any(char in text_lower for char in kazakh_chars):
            return "kz"

        # Check for Russian characters
        russian_chars = [
            "а",
            "б",
            "в",
            "г",
            "д",
            "е",
            "ё",
            "ж",
            "з",
            "и",
            "й",
            "к",
            "л",
            "м",
            "н",
            "о",
            "п",
            "р",
            "с",
            "т",
            "у",
            "ф",
            "х",
            "ц",
            "ч",
            "ш",
            "щ",
            "ъ",
            "ы",
            "ь",
            "э",
            "ю",
            "я",
        ]
        if any(char in text_lower for char in russian_chars):
            return "ru"

        return "ru"  # Default to Russian

    # Use explicit language if provided, otherwise auto-detect
    if language and language.lower() in ["ru", "kz"]:
        # Explicit language override - ignore auto-detection
        detected_lang = language.lower()
    else:
        # Auto-detect language from profile's chosen subjects if available
        detected_lang = "ru"  # Default
        if profile and profile.chosen_subjects:
            # Check first subject for language
            for subject in profile.chosen_subjects:
                if subject:
                    detected_lang = detect_language(subject)
                    break

    # Set localized fallback for university name if not set
    if not university_name:
        if detected_lang == "kz":
            university_name = "Сіздің мақсатты ЖОО"
        else:  # Russian (default)
            university_name = "Ваш целевой ВУЗ"

    # If no activities, return early state
    if not activities:
        return {
            "status": "no_data",
            "message": "Start testing to get a personalized plan",
            "target_university": university_name,
            "target_score": grant_threshold,
            "current_score": 0,
            "gap": grant_threshold,
            "roadmap": [],
        }

    # Import canonical subjects at the top of the function
    from ..constants.subjects import get_compulsory_subjects, normalize_subject_name

    # Step 3a: Define Mandatory Subjects using canonical constants
    mandatory_subjects = get_compulsory_subjects()

    # Helper function to check if subject is mandatory (now uses canonical names)
    def is_mandatory_subject(subject_name):
        """Check if a subject is a mandatory/compulsory subject."""
        if not subject_name:
            return False
        # Normalize to canonical name and check if it's in compulsory list
        canonical = normalize_subject_name(subject_name)
        return canonical in mandatory_subjects

    # Helper function to check if a subject is one of the profile subjects (with cross-language matching)
    def is_profile_subject(subject_name, profile_subjects_list):
        """Check if a subject matches any of the profile subjects, considering normalization."""
        if not subject_name or not profile_subjects_list:
            return False
        normalized_input = normalize_subject_name(subject_name)
        for p_subj in profile_subjects_list:
            if normalized_input == normalize_subject_name(p_subj):
                return True
        return False

    # Helper function to normalize subject name to a mandatory subject if it matches
    def normalize_to_mandatory(subject_name):
        """Normalizes a subject name to its canonical mandatory form if it's a mandatory subject."""
        if not subject_name:
            return None
        canonical = normalize_subject_name(subject_name)
        if canonical in mandatory_subjects:
            return canonical
        return None

    # Step 3b: Get Profile Subjects (2 subjects from user's chosen_subjects)
    profile_subjects = []
    if profile and profile.chosen_subjects:
        # Take first 2 chosen subjects
        profile_subjects = list(profile.chosen_subjects)[:2]

    # Step 3c: If no profile subjects, find the 2 highest scoring non-mandatory subjects
    # First, aggregate ALL scores to find the best ones
    all_subject_scores = {}  # {subject_name: {"score": int, "max_score": int, "percentage": float}}
    all_subject_all_scores = {}  # Track all scores per subject for average calculation

    for activity in activities:
        if not activity.metadata_blob or not isinstance(activity.metadata_blob, dict):
            continue

        subject = activity.metadata_blob.get("subject")
        score = activity.metadata_blob.get("score")
        max_score = activity.metadata_blob.get("max_score")

        if not subject or score is None:
            continue

        # Skip if this is a mandatory subject (we'll handle those separately)
        if normalize_to_mandatory(subject):
            continue

        # Initialize subject tracking
        if subject not in all_subject_all_scores:
            all_subject_all_scores[subject] = []

        # Add this score to the list
        if max_score and max_score > 0:
            percentage = (score / max_score) * 100
            all_subject_all_scores[subject].append(
                {"score": score, "max_score": max_score, "percentage": percentage}
            )

            # Keep only the latest entry per subject (first one since we ordered desc)
            if subject not in all_subject_scores:
                all_subject_scores[subject] = {
                    "score": score,
                    "max_score": max_score,
                    "percentage": percentage,
                }

    # If no profile subjects, select the 2 highest scoring non-mandatory subjects
    if not profile_subjects and all_subject_scores:
        # Sort by score (descending) and take top 2
        sorted_subjects = sorted(
            all_subject_scores.items(), key=lambda x: x[1]["score"], reverse=True
        )
        profile_subjects = [subj for subj, _ in sorted_subjects[:2]]

    # Step 3d: Create whitelist of valid subjects (3 mandatory + 2 profile)
    valid_subjects = mandatory_subjects + profile_subjects

    # Step 3e: Aggregate scores ONLY for valid subjects
    subject_scores = {}  # {subject: {"score": int, "max_score": int, "percentage": float}}
    subject_all_scores = {}  # Track all scores per subject for average calculation

    for activity in activities:
        if not activity.metadata_blob or not isinstance(activity.metadata_blob, dict):
            continue

        subject = activity.metadata_blob.get("subject")
        score = activity.metadata_blob.get("score")
        max_score = activity.metadata_blob.get("max_score")

        if not subject or score is None:
            continue

        # Check if this subject is in our whitelist (with cross-language matching)
        is_mandatory = normalize_to_mandatory(subject)
        is_profile = is_profile_subject(
            subject, profile_subjects
        )  # Use new cross-language function

        if not (is_mandatory or is_profile):
            # Skip subjects not in the whitelist
            continue

        # Normalize mandatory subject name
        normalized_subject = is_mandatory if is_mandatory else subject

        # Initialize subject tracking
        if normalized_subject not in subject_all_scores:
            subject_all_scores[normalized_subject] = []

        # Add this score to the list
        if max_score and max_score > 0:
            percentage = (score / max_score) * 100
            subject_all_scores[normalized_subject].append(
                {"score": score, "max_score": max_score, "percentage": percentage}
            )

            # Keep only the latest entry per subject (first one since we ordered desc)
            if normalized_subject not in subject_scores:
                subject_scores[normalized_subject] = {
                    "score": score,
                    "max_score": max_score,
                    "percentage": percentage,
                }

    # Step 3f: Calculate current_total_score - ONLY sum valid subjects (5 subjects max)
    # Ensure all valid subjects are included (with 0 if no data)
    for mandatory_subj in mandatory_subjects:
        if mandatory_subj not in subject_scores:
            subject_scores[mandatory_subj] = {"score": 0, "max_score": 0, "percentage": 0}

    for profile_subj in profile_subjects:
        if profile_subj not in subject_scores:
            subject_scores[profile_subj] = {"score": 0, "max_score": 0, "percentage": 0}

    # Convert raw test scores to UNT scale using centralized utility
    current_total_score = 0.0
    for subj, data in subject_scores.items():
        if subj in valid_subjects:
            raw_score = data["score"]
            max_score = data["max_score"]

            # Use centralized conversion function
            unt_score = convert_to_unt_score(raw_score, max_score, subj)
            current_total_score += unt_score

    # Round to integer for display
    current_total_score = int(round(current_total_score))

    # Calculate average percentage per subject to find weakest (ONLY for valid subjects)
    subject_averages = {}
    for subject, scores_list in subject_all_scores.items():
        # Only include valid subjects in averages
        if subject in valid_subjects and scores_list:
            avg_percentage = sum(s["percentage"] for s in scores_list) / len(scores_list)
            subject_averages[subject] = avg_percentage

    # Step 4: Identify Gap and Weakest Subject
    # Gap = current_total_score - target_score (positive = surplus, negative = need improvement)
    gap = current_total_score - target_score

    weakest_subject = None
    weakest_percentage = 100.0

    # Find weakest subject from valid subjects only
    if subject_averages:
        for subject, avg_pct in subject_averages.items():
            if subject in valid_subjects and avg_pct < weakest_percentage:
                weakest_percentage = avg_pct
                weakest_subject = subject

    # If no subject found, use a default from valid subjects
    if not weakest_subject and subject_scores:
        # Try to find a valid subject with data
        for subj in valid_subjects:
            if subj in subject_scores:
                weakest_subject = subj
                weakest_percentage = subject_scores[subj].get("percentage", 0)
                break
        # If still not found, use first valid subject
        if not weakest_subject and valid_subjects:
            weakest_subject = valid_subjects[0]
    elif not weakest_subject:
        weakest_subject = "General"

    # Refine language detection from weakest subject if available
    if weakest_subject and weakest_subject != "General":
        subject_lang = detect_language(weakest_subject)
        if subject_lang:
            detected_lang = subject_lang

    # Step 5: AI Generation
    # Prepare context for AI - only include valid subjects in breakdown
    # Filter subject_breakdown to only include valid subjects (5 subjects max)
    filtered_subject_breakdown = {
        subj: {
            "latest_score": data["score"],
            "max_score": data["max_score"],
            "percentage": data["percentage"],
        }
        for subj, data in subject_scores.items()
        if subj in valid_subjects
    }

    context_data = {
        "target_university": university_name,
        "target_score": target_score,
        "current_score": current_total_score,
        "gap": gap,
        "weakest_subject": weakest_subject,
        "weakest_percentage": weakest_percentage if subject_averages else 0,
        "subject_breakdown": filtered_subject_breakdown,
    }

    # Determine status
    # Note: gap = current_total_score - target_score
    # Negative gap means need improvement, positive gap means surplus
    if gap >= 0:
        status = "On Track"
    elif gap >= -20:
        status = "At Risk"
    else:
        status = "Needs Improvement"

    # Generate roadmap using AI
    # Build system prompt with explicit language instruction if language was provided
    if language and language.lower() in ["ru", "kz"]:
        # Explicit language override - force the specified language
        lang_instruction = f"CRITICAL LANGUAGE RULE: OUTPUT THE ENTIRE ROADMAP STRICTLY IN {'KAZAKH' if language.lower() == 'kz' else 'RUSSIAN'}. NEVER use English for the topic, focus, or activities fields. All roadmap fields (topic, focus, activities) MUST be in {'Kazakh' if language.lower() == 'kz' else 'Russian'}."
    else:
        # Auto-detection mode (fallback)
        lang_instruction = """CRITICAL LANGUAGE RULE:
- You are a strategic advisor for a student in Kazakhstan.
- Analyze the input data (Subject names, University Name) to detect the language:
  * If the data contains Russian characters or Russian subject names (e.g., "Математика", "Физика"), output the ENTIRE roadmap strictly in Russian.
  * If the data contains Kazakh characters or Kazakh subject names, output the ENTIRE roadmap strictly in Kazakh.
  * NEVER use English for the topic, focus, or activities fields.
- Translate technical terms if necessary, but maintain language consistency throughout.
- All roadmap fields (topic, focus, activities) MUST be in the detected language."""

    # Define JSON structure as a separate plain string (not f-string) to avoid format specifier errors
    json_structure = """
{
    "roadmap": [
        {
            "week": 1,
            "topic": "Specific topic or subject area to focus on (in detected language: Russian or Kazakh)",
            "focus": "Detailed focus area (in detected language, e.g., 'Основы алгебры' for Russian or 'Алгебра негіздері' for Kazakh)",
            "target_improvement": "Expected score improvement (e.g., '+5 баллов' for Russian or '+5 балл' for Kazakh)",
            "activities": ["Activity 1 (in detected language)", "Activity 2 (in detected language)", "Activity 3 (in detected language)"]
        },
        {
            "week": 2,
            "topic": "... (in detected language)",
            "focus": "... (in detected language)",
            "target_improvement": "... (in detected language)",
            "activities": ["... (in detected language)", "... (in detected language)", "... (in detected language)"]
        },
        {
            "week": 3,
            "topic": "... (in detected language)",
            "focus": "... (in detected language)",
            "target_improvement": "... (in detected language)",
            "activities": ["... (in detected language)", "... (in detected language)", "... (in detected language)"]
        }
    ]
}
"""

    # Now use the JSON structure in the f-string
    system_prompt = f"""You are a strategic UNT (Unified National Testing) advisor specializing in helping students reach their target university grant scores.

{lang_instruction}

IMPORTANT: The Target Score includes a +10 point safety margin to ensure grant security. This means the student should aim for (official threshold + 10) points, capped at the UNT maximum of 140 points. This safety margin helps protect against score fluctuations and increases the likelihood of securing a grant.

Your task is to generate a personalized 3-step tactical roadmap to help the student close their score gap.

Output your response STRICTLY as a JSON object with the following structure:
{json_structure}

Ensure the roadmap:
- Is practical and actionable
- Focuses on the weakest subject but also addresses overall improvement
- Provides specific, measurable activities
- Is realistic for a 3-week timeline
- ALL content (topic, focus, activities) is in the detected language (Russian or Kazakh), NEVER English
"""

    # Build user prompt with explicit score context
    max_unt_score = 140  # UNT maximum score (3 mandatory + 2 profile subjects)

    # Determine the strategy context based on current vs target
    # Note: gap = current_total_score - target_score (positive = surplus, negative = need improvement)
    if gap >= 0:
        strategy_context = f"The student already has {current_total_score}/{max_unt_score} points, which meets or exceeds the safety target of {target_score} (official threshold: {grant_threshold} + 10 safety margin). The strategy should focus on MAINTAINING this strong performance or aiming for scholarships/stipends, not panic studying. Provide encouragement and maintenance tips."
    else:
        strategy_context = f"The student has {current_total_score}/{max_unt_score} points and needs to reach {target_score} points (official threshold: {grant_threshold} + 10 safety margin). Generate a tactical roadmap to close the gap of {abs(gap)} points."

    user_prompt = f"""
Target University: {university_name}
Official Grant Threshold: {grant_threshold} points
Target Score (with +10 safety margin): {target_score} points (out of {max_unt_score} maximum)
Current Score: {current_total_score} points (out of {max_unt_score} maximum)
Gap: {abs(gap)} points {"surplus" if gap >= 0 else "needed"}
Weakest Subject: {weakest_subject} (Average: {weakest_percentage:.1f}%)

Subject Breakdown (5 UNT Subjects):
{json.dumps(context_data["subject_breakdown"], indent=2, ensure_ascii=False)}

{strategy_context}
"""

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )

        ai_response_content = response.choices[0].message.content
        ai_parsed_response = json.loads(ai_response_content)

        roadmap = ai_parsed_response.get("roadmap", [])

        # Validate roadmap structure
        if not isinstance(roadmap, list) or len(roadmap) == 0:
            # Fallback roadmap (in detected language)
            if detected_lang == "kz":
                roadmap = [
                    {
                        "week": 1,
                        "topic": weakest_subject,
                        "focus": f"{weakest_subject} негіздерін жақсартуға назар аударыңыз",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} балл",
                        "activities": [
                            "Күн сайын 10 практикалық сұрақ орындаңыз",
                            "Оқулық тарауларын қайталаңыз",
                            "Тестілеу тестін тапсырыңыз",
                        ],
                    },
                    {
                        "week": 2,
                        "topic": weakest_subject,
                        "focus": f"{weakest_subject} күрделі тақырыптары",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} балл",
                        "activities": [
                            "Есептерді шешу стратегияларына назар аударыңыз",
                            "Алдыңғы тесттердегі қателіктерді қайталаңыз",
                            "Тағы бір тестілеу тестін тапсырыңыз",
                        ],
                    },
                    {
                        "week": 3,
                        "topic": "Барлық пәндер",
                        "focus": "Жан-жақты қайталау және тест тапсыру стратегиялары",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} балл",
                        "activities": [
                            "Толық практикалық емтихан",
                            "Барлық әлсіз аймақтарды қайталаңыз",
                            "Соңғы дайындық",
                        ],
                    },
                ]
            else:  # Russian (default)
                roadmap = [
                    {
                        "week": 1,
                        "topic": weakest_subject,
                        "focus": f"Сосредоточьтесь на улучшении основ {weakest_subject}",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} баллов",
                        "activities": [
                            "Выполняйте 10 практических вопросов ежедневно",
                            "Повторите главы учебника",
                            "Пройдите пробный тест",
                        ],
                    },
                    {
                        "week": 2,
                        "topic": weakest_subject,
                        "focus": f"Продвинутые темы {weakest_subject}",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} баллов",
                        "activities": [
                            "Сосредоточьтесь на стратегиях решения задач",
                            "Повторите ошибки из предыдущих тестов",
                            "Пройдите еще один пробный тест",
                        ],
                    },
                    {
                        "week": 3,
                        "topic": "Все предметы",
                        "focus": "Комплексный обзор и стратегии сдачи тестов",
                        "target_improvement": f"+{max(5, abs(gap) // 3)} баллов",
                        "activities": [
                            "Полный практический экзамен",
                            "Повторите все слабые области",
                            "Финальная подготовка",
                        ],
                    },
                ]

    except json.JSONDecodeError:
        logger.exception("JSON decode error in strategy generation")
        roadmap = []
    except Exception:
        logger.exception("Error during AI roadmap generation")
        roadmap = []

    # Return final strategy
    return {
        "status": status,
        "target_university": university_name,
        "target_score": target_score,
        "current_score": current_total_score,
        "gap": gap,
        "weakest_subject": weakest_subject,
        "weakest_percentage": weakest_percentage if subject_averages else 0,
        "subject_breakdown": context_data["subject_breakdown"],
        "roadmap": roadmap,
    }
