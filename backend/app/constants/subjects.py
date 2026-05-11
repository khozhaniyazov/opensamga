"""
UNT Subject Constants and Definitions
======================================

Canonical source of truth for all UNT 2026 subjects.
All backend code must use English canonical names from this file.
Frontend displays use i18n translations.
"""

from enum import Enum


class SubjectCategory(str, Enum):
    """UNT subject categories"""

    COMPULSORY = "Compulsory"
    PROFILE = "Profile"


class UNTSubject:
    """
    Canonical UNT subject definition.

    Attributes:
        code: Unique identifier (uppercase snake_case)
        name_en: Canonical English name (used in database)
        name_kz: Kazakh translation
        name_ru: Russian translation
        max_score: Maximum UNT points for this subject
        category: Compulsory or Profile
    """

    def __init__(
        self,
        code: str,
        name_en: str,
        name_kz: str,
        name_ru: str,
        max_score: int,
        category: SubjectCategory,
    ):
        self.code = code
        self.name_en = name_en
        self.name_kz = name_kz
        self.name_ru = name_ru
        self.max_score = max_score
        self.category = category

    def __repr__(self):
        return f"<UNTSubject {self.code}: {self.name_en}>"


# ============================================================================
# CANONICAL SUBJECT DEFINITIONS
# ============================================================================

SUBJECTS: dict[str, UNTSubject] = {
    # --- Compulsory Subjects (3) ---
    "HISTORY_KAZAKHSTAN": UNTSubject(
        code="HISTORY_KAZAKHSTAN",
        name_en="History of Kazakhstan",
        name_kz="Қазақстан тарихы",
        name_ru="История Казахстана",
        max_score=20,
        category=SubjectCategory.COMPULSORY,
    ),
    "MATH_LITERACY": UNTSubject(
        code="MATH_LITERACY",
        name_en="Mathematical Literacy",
        name_kz="Математикалық сауаттылық",
        name_ru="Математическая грамотность",
        max_score=10,
        category=SubjectCategory.COMPULSORY,
    ),
    "READING_LITERACY": UNTSubject(
        code="READING_LITERACY",
        name_en="Reading Literacy",
        name_kz="Оқу сауаттылығы",
        name_ru="Грамотность чтения",
        max_score=10,
        category=SubjectCategory.COMPULSORY,
    ),
    # --- Profile Subjects (13) ---
    "MATHEMATICS": UNTSubject(
        code="MATHEMATICS",
        name_en="Mathematics",
        name_kz="Математика",
        name_ru="Математика",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "PHYSICS": UNTSubject(
        code="PHYSICS",
        name_en="Physics",
        name_kz="Физика",
        name_ru="Физика",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "CHEMISTRY": UNTSubject(
        code="CHEMISTRY",
        name_en="Chemistry",
        name_kz="Химия",
        name_ru="Химия",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "BIOLOGY": UNTSubject(
        code="BIOLOGY",
        name_en="Biology",
        name_kz="Биология",
        name_ru="Биология",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "GEOGRAPHY": UNTSubject(
        code="GEOGRAPHY",
        name_en="Geography",
        name_kz="География",
        name_ru="География",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "WORLD_HISTORY": UNTSubject(
        code="WORLD_HISTORY",
        name_en="World History",
        name_kz="Дүниежүзі тарихы",
        name_ru="Всемирная история",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "KAZAKH_LANGUAGE": UNTSubject(
        code="KAZAKH_LANGUAGE",
        name_en="Kazakh Language",
        name_kz="Қазақ тілі",
        name_ru="Казахский язык",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "KAZAKH_LITERATURE": UNTSubject(
        code="KAZAKH_LITERATURE",
        name_en="Kazakh Literature",
        name_kz="Қазақ әдебиеті",
        name_ru="Казахская литература",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "RUSSIAN_LANGUAGE": UNTSubject(
        code="RUSSIAN_LANGUAGE",
        name_en="Russian Language",
        name_kz="Орыс тілі",
        name_ru="Русский язык",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "RUSSIAN_LITERATURE": UNTSubject(
        code="RUSSIAN_LITERATURE",
        name_en="Russian Literature",
        name_kz="Орыс әдебиеті",
        name_ru="Русская литература",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "FOREIGN_LANGUAGE": UNTSubject(
        code="FOREIGN_LANGUAGE",
        name_en="Foreign Language",
        name_kz="Шет тілі",
        name_ru="Иностранный язык",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "FUNDAMENTALS_OF_LAW": UNTSubject(
        code="FUNDAMENTALS_OF_LAW",
        name_en="Fundamentals of Law",
        name_kz="Құқық негіздері",
        name_ru="Основы права",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
    "INFORMATICS": UNTSubject(
        code="INFORMATICS",
        name_en="Informatics",
        name_kz="Информатика",
        name_ru="Информатика",
        max_score=50,
        category=SubjectCategory.PROFILE,
    ),
}


# ============================================================================
# REVERSE LOOKUPS AND HELPERS
# ============================================================================

# Build reverse lookup maps
_NAME_TO_SUBJECT: dict[str, UNTSubject] = {}
for subject in SUBJECTS.values():
    # Map all language variants to the same subject
    _NAME_TO_SUBJECT[subject.name_en.lower()] = subject
    _NAME_TO_SUBJECT[subject.name_kz.lower()] = subject
    _NAME_TO_SUBJECT[subject.name_ru.lower()] = subject


# Common variations/aliases for normalization
_SUBJECT_ALIASES = {
    # Mathematics variations
    "math": "Mathematics",
    "maths": "Mathematics",
    "математика": "Mathematics",
    # Computer Science / Informatics variations
    "computer science": "Informatics",
    "информатика": "Informatics",
    "cs": "Informatics",
    # English / Foreign Language
    "english": "Foreign Language",
    "английский язык": "Foreign Language",
    "ағылшын тілі": "Foreign Language",
    "english language": "Foreign Language",
    "foreign language": "Foreign Language",
    "иностранный язык": "Foreign Language",
    "шет тілі": "Foreign Language",
    # Law variations
    "law": "Fundamentals of Law",
    "fundamentals of law": "Fundamentals of Law",
    "основы права": "Fundamentals of Law",
    "құқық негіздері": "Fundamentals of Law",
    # Language and literature variations
    "kazakh language": "Kazakh Language",
    "казахский язык": "Kazakh Language",
    "қазақ тілі": "Kazakh Language",
    "kazakh": "Kazakh Language",
    "kazakh literature": "Kazakh Literature",
    "казахская литература": "Kazakh Literature",
    "қазақ әдебиеті": "Kazakh Literature",
    "russian language": "Russian Language",
    "русский язык": "Russian Language",
    "орыс тілі": "Russian Language",
    "russian": "Russian Language",
    "russian literature": "Russian Literature",
    "русская литература": "Russian Literature",
    "орыс әдебиеті": "Russian Literature",
    # History variations
    "history of kazakhstan": "History of Kazakhstan",
    "kazakhstan history": "History of Kazakhstan",
    "казахстан тарихы": "History of Kazakhstan",
    "қазақстан тарихы": "History of Kazakhstan",
    "история казахстана": "History of Kazakhstan",
    # Literacy variations
    "math literacy": "Mathematical Literacy",
    "mathematical literacy": "Mathematical Literacy",
    "математическая грамотность": "Mathematical Literacy",
    "математикалық сауаттылық": "Mathematical Literacy",
    "reading literacy": "Reading Literacy",
    "читательская грамотность": "Reading Literacy",
    "грамотность чтения": "Reading Literacy",
    "оқу сауаттылығы": "Reading Literacy",
}


def get_subject_by_code(code: str) -> UNTSubject | None:
    """
    Get subject by its code.

    Args:
        code: Subject code (e.g., "MATHEMATICS")

    Returns:
        UNTSubject or None if not found
    """
    return SUBJECTS.get(code)


def get_subject_by_name(name: str) -> UNTSubject | None:
    """
    Get subject by name in any language.

    Args:
        name: Subject name in English, Kazakh, or Russian

    Returns:
        UNTSubject or None if not found

    Examples:
        >>> get_subject_by_name("Mathematics")
        <UNTSubject MATHEMATICS: Mathematics>
        >>> get_subject_by_name("Математика")
        <UNTSubject MATHEMATICS: Mathematics>
        >>> get_subject_by_name("Информатика")
        <UNTSubject INFORMATICS: Informatics>
    """
    if not name:
        return None

    name_lower = name.lower().strip()

    # Direct lookup
    subject = _NAME_TO_SUBJECT.get(name_lower)
    if subject:
        return subject

    # Try aliases
    canonical = _SUBJECT_ALIASES.get(name_lower)
    if canonical:
        return _NAME_TO_SUBJECT.get(canonical.lower())

    # Partial match fallback (e.g., "History of Kazakhstan (Modern Era)")
    for stored_name, subject in _NAME_TO_SUBJECT.items():
        if stored_name in name_lower or name_lower in stored_name:
            return subject

    return None


def normalize_subject_name(name: str) -> str:
    """
    Convert any subject name to canonical English name.

    Args:
        name: Subject name in any language

    Returns:
        Canonical English name, or original name if not found

    Examples:
        >>> normalize_subject_name("Математика")
        "Mathematics"
        >>> normalize_subject_name("Информатика")
        "Informatics"
        >>> normalize_subject_name("Mathematics")
        "Mathematics"
    """
    subject = get_subject_by_name(name)
    return subject.name_en if subject else name


PROFILE_SUBJECT_COMBINATIONS: list[tuple[str, str]] = [
    ("Mathematics", "Physics"),
    ("Biology", "Chemistry"),
    ("Mathematics", "Informatics"),
    ("Kazakh Language", "Kazakh Literature"),
    ("Russian Language", "Russian Literature"),
    ("Foreign Language", "World History"),
    ("Biology", "Geography"),
    ("Mathematics", "Geography"),
    ("World History", "Fundamentals of Law"),
    ("World History", "Geography"),
    ("Geography", "Foreign Language"),
    ("Chemistry", "Physics"),
]

_PROFILE_SUBJECT_PAIR_KEYS: set[tuple[str, str]] = {
    tuple(sorted(pair)) for pair in PROFILE_SUBJECT_COMBINATIONS
}


def _profile_subject_pair_key(subjects: list[str]) -> tuple[str, str]:
    normalized = [normalize_subject_name(subject) for subject in subjects]
    return tuple(sorted(normalized))  # type: ignore[return-value]


def get_profile_subject_combinations() -> list[tuple[str, str]]:
    """Get valid non-creative UNT profile subject pairs."""
    return list(PROFILE_SUBJECT_COMBINATIONS)


def is_valid_profile_subject_pair(subjects: list[str]) -> bool:
    """Return True when exactly two subjects form a valid UNT profile pair."""
    if len(subjects) != 2:
        return False

    normalized = [normalize_subject_name(subject) for subject in subjects]
    profile_subjects = set(get_profile_subjects())
    if len(set(normalized)) != 2:
        return False
    if any(subject not in profile_subjects for subject in normalized):
        return False

    return _profile_subject_pair_key(normalized) in _PROFILE_SUBJECT_PAIR_KEYS


def get_max_score(subject_name: str) -> int:
    """
    Get maximum UNT score for a subject.

    Args:
        subject_name: Subject name in any language

    Returns:
        Maximum UNT score (20, 10, or 50)

    Examples:
        >>> get_max_score("History of Kazakhstan")
        20
        >>> get_max_score("Mathematics")
        50
        >>> get_max_score("Математика")
        50
    """
    subject = get_subject_by_name(subject_name)
    return subject.max_score if subject else 50  # Default to profile subject


def get_compulsory_subjects() -> list[str]:
    """
    Get list of all compulsory subject names (canonical English).

    Returns:
        List of 3 compulsory subject names
    """
    return [s.name_en for s in SUBJECTS.values() if s.category == SubjectCategory.COMPULSORY]


def get_profile_subjects() -> list[str]:
    """
    Get list of all profile subject names (canonical English).

    Returns:
        List of 13 profile subject names
    """
    return [s.name_en for s in SUBJECTS.values() if s.category == SubjectCategory.PROFILE]


def get_all_subjects() -> list[str]:
    """
    Get list of all subject names (canonical English).

    Returns:
        List of all 16 subject names
    """
    return [s.name_en for s in SUBJECTS.values()]


def is_valid_subject(name: str) -> bool:
    """
    Check if a name is a valid UNT subject.

    Args:
        name: Subject name in any language

    Returns:
        True if valid, False otherwise
    """
    return get_subject_by_name(name) is not None
