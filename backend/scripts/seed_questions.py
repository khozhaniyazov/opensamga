"""
OpenSamga question seeder
=========================
Seeds exam questions from JSON files in /database and mirrors eligible
single-answer rows into mock_questions for exact-answer practice-bank
lookups.
Run AFTER `alembic upgrade head`.

Usage:
    python scripts/seed_questions.py          # Dry run (prints counts)
    python scripts/seed_questions.py --commit # Actually writes to DB
"""

import asyncio
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

# Add parent dir to path so we can import app.*
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import AsyncSessionLocal
from app.models import ExamQuestion, MockQuestion

# ─── File → Subject mapping ────────────────────────────────────────────────

FILE_SUBJECT_MAP = {
    "Математика": "Mathematics",
    "Физика": "Physics",
    "Химия": "Chemistry",
    "Биология": "Biology",
    "География": "Geography",
    "Всемирная история": "World History",
    "История Казахстана": "History of Kazakhstan",
    "Информатика": "Informatics",
    "Английский язык": "Foreign Language",
    "Казахский язык и литература": "Kazakh Literature",
    "Русский язык и литература": "Russian Literature",
    "Основы права": "Fundamentals of Law",
    "Математическая грамотность": "Mathematical Literacy",
    "Грамотность чтения": "Reading Literacy",
    "Русский язык": "Russian Language",  # Legacy
}

DATABASE_DIR = Path(__file__).parent.parent.parent / "database"


def _choice_question(
    question_id: str,
    question_format: str,
    max_points: int,
    question_text_ru: str,
    question_text_kz: str,
    options_ru: list[str],
    correct_answers_indices: list[int],
    options_kz: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "question_id": question_id,
        "format": question_format,
        "max_points": max_points,
        "question_text_kz": question_text_kz,
        "question_text_ru": question_text_ru,
        "options_kz": options_kz or options_ru,
        "options_ru": options_ru,
        "correct_answers_indices": correct_answers_indices,
    }


def _context_question(
    question_id: str,
    group_id: str,
    stimulus_ru: str,
    stimulus_kz: str,
    question_text_ru: str,
    question_text_kz: str,
    options_ru: list[str],
    correct_answers_indices: list[int],
    options_kz: list[str] | None = None,
) -> dict[str, Any]:
    return {
        **_choice_question(
            question_id,
            "context",
            1,
            question_text_ru,
            question_text_kz,
            options_ru,
            correct_answers_indices,
            options_kz,
        ),
        "context_stimulus_kz": stimulus_kz,
        "context_stimulus_ru": stimulus_ru,
        "context_group_id": group_id,
    }


PHYSICS_MECHANICS_STIMULUS_RU = (
    "Тело массой 5 кг тянут по гладкой горизонтальной поверхности постоянной "
    "силой 20 Н. Начальная скорость равна 0, время движения 4 с."
)
PHYSICS_MECHANICS_STIMULUS_KZ = (
    "Массасы 5 кг дене тегіс горизонталь бетпен 20 Н тұрақты күшпен тартылады. "
    "Бастапқы жылдамдық 0, қозғалыс уақыты 4 с."
)
PHYSICS_CIRCUIT_STIMULUS_RU = (
    "Резисторы 6 Ом и 3 Ом соединены параллельно и подключены к источнику "
    "напряжением 12 В. Сопротивлением проводов пренебречь."
)
PHYSICS_CIRCUIT_STIMULUS_KZ = (
    "6 Ом және 3 Ом резисторлар параллель қосылып, 12 В кернеу көзіне жалғанған. "
    "Сымдардың кедергісі ескерілмейді."
)
ENGLISH_STUDY_STIMULUS_RU = (
    "Aruzhan is preparing for an exchange semester in Canada. She studies English "
    "for two hours every evening, keeps a vocabulary notebook, and practices "
    "speaking with classmates twice a week."
)
ENGLISH_STUDY_STIMULUS_KZ = (
    "Аружан Канададағы алмасу семестріне дайындалып жүр. Ол әр кеш сайын ағылшын "
    "тілін екі сағат оқиды, сөздік дәптер жүргізеді және аптасына екі рет "
    "сыныптастарымен сөйлеуді жаттықтырады."
)
ENGLISH_ENERGY_STIMULUS_RU = (
    "Renewable energy comes from sources that can be naturally replaced, such as "
    "sunlight, wind, and water. Many countries invest in these sources to reduce "
    "air pollution and dependence on fossil fuels."
)
ENGLISH_ENERGY_STIMULUS_KZ = (
    "Жаңартылатын энергия күн сәулесі, жел және су сияқты табиғи түрде қайта "
    "толығатын көздерден алынады. Көптеген елдер ауаның ластануын және қазба "
    "отындарға тәуелділікті азайту үшін осы көздерге инвестиция салады."
)


BACKFILL_QUESTIONS: dict[str, list[dict[str, Any]]] = {
    "Physics": [
        _choice_question(
            "phys_backfill_multi_005",
            "multiple_choice",
            2,
            "Выберите основные единицы СИ.",
            "SI жүйесінің негізгі бірліктерін таңдаңыз.",
            ["метр", "килограмм", "секунда", "ньютон", "джоуль", "ватт"],
            [0, 1, 2],
        ),
        _choice_question(
            "phys_backfill_multi_006",
            "multiple_choice",
            2,
            "Выберите виды механической энергии.",
            "Механикалық энергия түрлерін таңдаңыз.",
            [
                "кинетическая",
                "химическая",
                "потенциальная",
                "ядерная",
                "упругая",
                "световая",
            ],
            [0, 2, 4],
        ),
        _choice_question(
            "phys_backfill_multi_007",
            "multiple_choice",
            2,
            "Какие величины сохраняются в замкнутых системах при соответствующих условиях?",
            "Тиісті жағдайларда тұйық жүйелерде қандай шамалар сақталады?",
            ["энергия", "импульс", "электрический заряд", "температура", "путь", "давление"],
            [0, 1, 2],
        ),
        _choice_question(
            "phys_backfill_multi_008",
            "multiple_choice",
            2,
            "Выберите электромагнитные волны.",
            "Электромагниттік толқындарды таңдаңыз.",
            [
                "звук",
                "радиоволны",
                "сейсмические волны",
                "инфракрасное излучение",
                "видимый свет",
                "волны на воде",
            ],
            [1, 3, 4],
        ),
        _choice_question(
            "phys_backfill_multi_009",
            "multiple_choice",
            2,
            "Какие факторы влияют на сопротивление проводника?",
            "Өткізгіштің кедергісіне қандай факторлар әсер етеді?",
            ["длина", "площадь поперечного сечения", "цвет", "материал", "температура", "звук"],
            [0, 1, 3, 4],
        ),
        _choice_question(
            "phys_backfill_multi_010",
            "multiple_choice",
            2,
            "Выберите субатомные частицы.",
            "Субатомдық бөлшектерді таңдаңыз.",
            ["протон", "нейтрон", "электрон", "молекула воды", "клетка", "капля"],
            [0, 1, 2],
        ),
        _context_question(
            "phys_backfill_ctx_mech_001",
            "phys_backfill_ctx_mech",
            PHYSICS_MECHANICS_STIMULUS_RU,
            PHYSICS_MECHANICS_STIMULUS_KZ,
            "Чему равно ускорение тела?",
            "Дененің үдеуі неге тең?",
            ["2 м/с^2", "4 м/с^2", "5 м/с^2", "20 м/с^2"],
            [1],
        ),
        _context_question(
            "phys_backfill_ctx_mech_002",
            "phys_backfill_ctx_mech",
            PHYSICS_MECHANICS_STIMULUS_RU,
            PHYSICS_MECHANICS_STIMULUS_KZ,
            "Какой станет скорость тела через 4 с?",
            "4 с өткен соң дененің жылдамдығы қандай болады?",
            ["8 м/с", "12 м/с", "16 м/с", "20 м/с"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_mech_003",
            "phys_backfill_ctx_mech",
            PHYSICS_MECHANICS_STIMULUS_RU,
            PHYSICS_MECHANICS_STIMULUS_KZ,
            "Какой путь пройдет тело за 4 с?",
            "Дене 4 с ішінде қандай жол жүреді?",
            ["16 м", "24 м", "32 м", "40 м"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_mech_004",
            "phys_backfill_ctx_mech",
            PHYSICS_MECHANICS_STIMULUS_RU,
            PHYSICS_MECHANICS_STIMULUS_KZ,
            "Какую работу совершит сила за это время?",
            "Осы уақыт ішінде күш қандай жұмыс атқарады?",
            ["320 Дж", "480 Дж", "640 Дж", "800 Дж"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_mech_005",
            "phys_backfill_ctx_mech",
            PHYSICS_MECHANICS_STIMULUS_RU,
            PHYSICS_MECHANICS_STIMULUS_KZ,
            "Чему равна кинетическая энергия тела в конце движения?",
            "Қозғалыс соңындағы дененің кинетикалық энергиясы неге тең?",
            ["320 Дж", "500 Дж", "640 Дж", "1000 Дж"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_circuit_001",
            "phys_backfill_ctx_circuit",
            PHYSICS_CIRCUIT_STIMULUS_RU,
            PHYSICS_CIRCUIT_STIMULUS_KZ,
            "Чему равно эквивалентное сопротивление цепи?",
            "Тізбектің баламалы кедергісі неге тең?",
            ["2 Ом", "3 Ом", "6 Ом", "9 Ом"],
            [0],
        ),
        _context_question(
            "phys_backfill_ctx_circuit_002",
            "phys_backfill_ctx_circuit",
            PHYSICS_CIRCUIT_STIMULUS_RU,
            PHYSICS_CIRCUIT_STIMULUS_KZ,
            "Чему равна общая сила тока?",
            "Жалпы ток күші неге тең?",
            ["2 А", "4 А", "6 А", "12 А"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_circuit_003",
            "phys_backfill_ctx_circuit",
            PHYSICS_CIRCUIT_STIMULUS_RU,
            PHYSICS_CIRCUIT_STIMULUS_KZ,
            "Какой ток течет через резистор 3 Ом?",
            "3 Ом резистор арқылы қандай ток өтеді?",
            ["2 А", "3 А", "4 А", "6 А"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_circuit_004",
            "phys_backfill_ctx_circuit",
            PHYSICS_CIRCUIT_STIMULUS_RU,
            PHYSICS_CIRCUIT_STIMULUS_KZ,
            "Какова полная мощность цепи?",
            "Тізбектің толық қуаты қандай?",
            ["24 Вт", "48 Вт", "72 Вт", "144 Вт"],
            [2],
        ),
        _context_question(
            "phys_backfill_ctx_circuit_005",
            "phys_backfill_ctx_circuit",
            PHYSICS_CIRCUIT_STIMULUS_RU,
            PHYSICS_CIRCUIT_STIMULUS_KZ,
            "Какой заряд пройдет через источник за 10 с?",
            "10 с ішінде көз арқылы қандай заряд өтеді?",
            ["20 Кл", "40 Кл", "60 Кл", "120 Кл"],
            [2],
        ),
    ],
    "Foreign Language": [
        _choice_question(
            "eng_backfill_single_002",
            "single_choice",
            1,
            "Choose the correct form: They ___ football now.",
            "Дұрыс форманы таңдаңыз: They ___ football now.",
            ["play", "are playing", "played", "plays"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_003",
            "single_choice",
            1,
            "Choose the Past Simple form of 'write'.",
            "'write' етістігінің Past Simple формасын таңдаңыз.",
            ["writed", "written", "wrote", "writes"],
            [2],
        ),
        _choice_question(
            "eng_backfill_single_004",
            "single_choice",
            1,
            "Choose the opposite of 'expensive'.",
            "'expensive' сөзінің антонимін таңдаңыз.",
            ["cheap", "large", "modern", "heavy"],
            [0],
        ),
        _choice_question(
            "eng_backfill_single_005",
            "single_choice",
            1,
            "Choose the correct sentence.",
            "Дұрыс сөйлемді таңдаңыз.",
            [
                "She don't like tea.",
                "She doesn't like tea.",
                "She not likes tea.",
                "She isn't like tea.",
            ],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_006",
            "single_choice",
            1,
            "Choose the correct preposition: interested ___ music.",
            "Дұрыс предлогты таңдаңыз: interested ___ music.",
            ["on", "at", "in", "for"],
            [2],
        ),
        _choice_question(
            "eng_backfill_single_007",
            "single_choice",
            1,
            "Choose the comparative form of 'good'.",
            "'good' сөзінің салыстырмалы шырайын таңдаңыз.",
            ["gooder", "best", "better", "more good"],
            [2],
        ),
        _choice_question(
            "eng_backfill_single_008",
            "single_choice",
            1,
            "Choose the correct article: ___ apple a day.",
            "Дұрыс артикльді таңдаңыз: ___ apple a day.",
            ["A", "An", "The", "-"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_009",
            "single_choice",
            1,
            "Choose the passive voice: The book ___ by him.",
            "Ырықсыз етісті таңдаңыз: The book ___ by him.",
            ["wrote", "was written", "writes", "is writing"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_010",
            "single_choice",
            1,
            "Choose the correct modal: You ___ wear a seat belt.",
            "Дұрыс модаль етістікті таңдаңыз: You ___ wear a seat belt.",
            ["must", "may", "can", "might"],
            [0],
        ),
        _choice_question(
            "eng_backfill_single_011",
            "single_choice",
            1,
            "Choose the synonym of 'quick'.",
            "'quick' сөзінің синонимін таңдаңыз.",
            ["slow", "fast", "late", "weak"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_012",
            "single_choice",
            1,
            "Choose the correct question tag: You are from Astana, ___?",
            "Дұрыс question tag таңдаңыз: You are from Astana, ___?",
            ["are you", "isn't it", "aren't you", "do you"],
            [2],
        ),
        _choice_question(
            "eng_backfill_single_013",
            "single_choice",
            1,
            "Choose the correct conditional: If it rains, we ___ at home.",
            "Дұрыс шартты сөйлемді таңдаңыз: If it rains, we ___ at home.",
            ["stay", "will stay", "stayed", "would stay"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_014",
            "single_choice",
            1,
            "Choose the reported speech: He said, 'I am tired.'",
            "Төл сөзді төлеу сөзге айналдырыңыз: He said, 'I am tired.'",
            [
                "He said he was tired.",
                "He said I am tired.",
                "He says he tired.",
                "He said he is tired yesterday.",
            ],
            [0],
        ),
        _choice_question(
            "eng_backfill_single_015",
            "single_choice",
            1,
            "Choose the correct word: I have ___ finished my homework.",
            "Дұрыс сөзді таңдаңыз: I have ___ finished my homework.",
            ["yet", "already", "tomorrow", "ago"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_016",
            "single_choice",
            1,
            "Choose the plural form of 'child'.",
            "'child' сөзінің көпше түрін таңдаңыз.",
            ["childs", "children", "childes", "childrens"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_017",
            "single_choice",
            1,
            "Choose the correct tense: I ___ here since 2020.",
            "Дұрыс шақты таңдаңыз: I ___ here since 2020.",
            ["live", "lived", "have lived", "am living"],
            [2],
        ),
        _choice_question(
            "eng_backfill_single_018",
            "single_choice",
            1,
            "Choose the correct meaning of 'environment'.",
            "'environment' сөзінің дұрыс мағынасын таңдаңыз.",
            ["қоршаған орта", "емтихан", "ғимарат", "жылдамдық"],
            [0],
            ["қоршаған орта", "емтихан", "ғимарат", "жылдамдық"],
        ),
        _choice_question(
            "eng_backfill_single_019",
            "single_choice",
            1,
            "Choose the correct form: There ___ many students in the room.",
            "Дұрыс форманы таңдаңыз: There ___ many students in the room.",
            ["is", "are", "was", "be"],
            [1],
        ),
        _choice_question(
            "eng_backfill_single_020",
            "single_choice",
            1,
            "Choose the correct infinitive: She wants ___ abroad.",
            "Дұрыс инфинитивті таңдаңыз: She wants ___ abroad.",
            ["study", "to study", "studying", "studied"],
            [1],
        ),
        _choice_question(
            "eng_backfill_multi_001",
            "multiple_choice",
            2,
            "Select irregular verbs.",
            "Бұрыс етістіктерді таңдаңыз.",
            ["go", "take", "write", "play", "clean", "watch"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_002",
            "multiple_choice",
            2,
            "Select modal verbs.",
            "Модаль етістіктерді таңдаңыз.",
            ["can", "must", "should", "quickly", "table", "because"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_003",
            "multiple_choice",
            2,
            "Select Present Perfect markers.",
            "Present Perfect көрсеткіштерін таңдаңыз.",
            ["already", "yet", "ever", "yesterday", "last week", "in 2010"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_004",
            "multiple_choice",
            2,
            "Select countable nouns.",
            "Саналатын зат есімдерді таңдаңыз.",
            ["apple", "book", "chair", "water", "rice", "advice"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_005",
            "multiple_choice",
            2,
            "Select adjectives.",
            "Сын есімдерді таңдаңыз.",
            ["large", "beautiful", "quick", "run", "slowly", "teacher"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_006",
            "multiple_choice",
            2,
            "Select phrasal verbs.",
            "Фразалық етістіктерді таңдаңыз.",
            ["look after", "give up", "turn on", "very good", "in school", "red car"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_007",
            "multiple_choice",
            2,
            "Select question words.",
            "Сұрау сөздерін таңдаңыз.",
            ["where", "why", "how", "green", "before", "never"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_008",
            "multiple_choice",
            2,
            "Select linking words.",
            "Байланыстырушы сөздерді таңдаңыз.",
            ["however", "because", "therefore", "window", "teacher", "yellow"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_009",
            "multiple_choice",
            2,
            "Select professions.",
            "Мамандықтарды таңдаңыз.",
            ["teacher", "doctor", "engineer", "city", "friendly", "often"],
            [0, 1, 2],
        ),
        _choice_question(
            "eng_backfill_multi_010",
            "multiple_choice",
            2,
            "Select British English spellings.",
            "British English жазылымдарын таңдаңыз.",
            ["colour", "centre", "favourite", "color", "center", "favorite"],
            [0, 1, 2],
        ),
        _context_question(
            "eng_backfill_ctx_study_001",
            "eng_backfill_ctx_study",
            ENGLISH_STUDY_STIMULUS_RU,
            ENGLISH_STUDY_STIMULUS_KZ,
            "Where is Aruzhan preparing to study?",
            "Аружан қай елде оқуға дайындалып жүр?",
            ["Canada", "Japan", "Germany", "Kazakhstan"],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_study_002",
            "eng_backfill_ctx_study",
            ENGLISH_STUDY_STIMULUS_RU,
            ENGLISH_STUDY_STIMULUS_KZ,
            "How long does she study English every evening?",
            "Ол әр кеш сайын ағылшын тілін қанша уақыт оқиды?",
            ["one hour", "two hours", "three hours", "four hours"],
            [1],
        ),
        _context_question(
            "eng_backfill_ctx_study_003",
            "eng_backfill_ctx_study",
            ENGLISH_STUDY_STIMULUS_RU,
            ENGLISH_STUDY_STIMULUS_KZ,
            "What does she keep for vocabulary?",
            "Сөздік үшін ол не жүргізеді?",
            ["a notebook", "a calendar", "a map", "a ticket"],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_study_004",
            "eng_backfill_ctx_study",
            ENGLISH_STUDY_STIMULUS_RU,
            ENGLISH_STUDY_STIMULUS_KZ,
            "How often does she practice speaking?",
            "Ол сөйлеуді қаншалықты жиі жаттықтырады?",
            ["once a month", "twice a week", "every morning", "never"],
            [1],
        ),
        _context_question(
            "eng_backfill_ctx_study_005",
            "eng_backfill_ctx_study",
            ENGLISH_STUDY_STIMULUS_RU,
            ENGLISH_STUDY_STIMULUS_KZ,
            "Who does she practice speaking with?",
            "Ол кіммен сөйлеуді жаттықтырады?",
            ["classmates", "tourists", "parents", "drivers"],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_energy_001",
            "eng_backfill_ctx_energy",
            ENGLISH_ENERGY_STIMULUS_RU,
            ENGLISH_ENERGY_STIMULUS_KZ,
            "What is renewable energy?",
            "Жаңартылатын энергия деген не?",
            [
                "energy from naturally replaced sources",
                "energy only from coal",
                "energy from plastic",
                "energy used once",
            ],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_energy_002",
            "eng_backfill_ctx_energy",
            ENGLISH_ENERGY_STIMULUS_RU,
            ENGLISH_ENERGY_STIMULUS_KZ,
            "Which source is mentioned in the text?",
            "Мәтінде қандай көз аталған?",
            ["sunlight", "oil", "gasoline", "uranium only"],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_energy_003",
            "eng_backfill_ctx_energy",
            ENGLISH_ENERGY_STIMULUS_RU,
            ENGLISH_ENERGY_STIMULUS_KZ,
            "Why do countries invest in renewable energy?",
            "Елдер неге жаңартылатын энергияға инвестиция салады?",
            [
                "to reduce air pollution",
                "to increase smoke",
                "to stop education",
                "to use more coal",
            ],
            [0],
        ),
        _context_question(
            "eng_backfill_ctx_energy_004",
            "eng_backfill_ctx_energy",
            ENGLISH_ENERGY_STIMULUS_RU,
            ENGLISH_ENERGY_STIMULUS_KZ,
            "What do renewables reduce dependence on?",
            "Жаңартылатын энергия қандай тәуелділікті азайтады?",
            ["fossil fuels", "books", "rain", "languages"],
            [0],
        ),
    ],
}


def _questions_from_subject_block(subj_block: dict[str, Any]) -> list[dict[str, Any]]:
    """Return regular + context questions in the ORM-friendly JSON shape."""
    questions = list(subj_block.get("questions", []))

    for cluster in subj_block.get("context_clusters", []):
        stimulus_kz = cluster.get("stimulus_kz")
        stimulus_ru = cluster.get("stimulus_ru")
        cluster_id = cluster.get("cluster_id")

        for child in cluster.get("child_questions", []):
            questions.append(
                {
                    **child,
                    "format": "context",
                    "context_stimulus_kz": stimulus_kz,
                    "context_stimulus_ru": stimulus_ru,
                    "context_group_id": cluster_id,
                }
            )

    return questions


def load_json_files() -> dict[str, list[dict[str, Any]]]:
    """Load all JSON files and return {canonical_subject: questions_list}."""
    subject_questions = {}

    for filename, canonical in FILE_SUBJECT_MAP.items():
        json_path = DATABASE_DIR / f"{filename}.json"
        if not json_path.exists():
            print(f"  [SKIP] {filename}.json - not found")
            continue

        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)

        # Unwrap the outer wrapper: {"unt_exam_schema_version": "...", "subjects": [...]}
        subjects_list = data.get("subjects", [data])

        for subj_block in subjects_list:
            questions = _questions_from_subject_block(subj_block)
            if canonical not in subject_questions:
                subject_questions[canonical] = []
            subject_questions[canonical].extend(questions)
            print(f"  [OK] {canonical}: {len(questions)} questions loaded")

    for canonical, questions in BACKFILL_QUESTIONS.items():
        subject_questions.setdefault(canonical, []).extend(questions)
        print(f"  [OK] {canonical}: {len(questions)} backfill questions loaded")

    return subject_questions


def question_to_row(subject: str, q: dict[str, Any]) -> ExamQuestion:
    """Convert a JSON question dict to an ExamQuestion ORM row."""
    return ExamQuestion(
        subject=subject,
        source_id=q.get("question_id"),
        format=q.get("format", "single_choice"),
        max_points=q.get("max_points", 1),
        question_text_kz=q.get("question_text_kz", ""),
        question_text_ru=q.get("question_text_ru", ""),
        options_kz=q.get("options_kz", []),
        options_ru=q.get("options_ru", []),
        correct_answers_indices=q.get("correct_answers_indices", [0]),
        context_stimulus_kz=q.get("context_stimulus_kz"),
        context_stimulus_ru=q.get("context_stimulus_ru"),
        context_group_id=q.get("context_group_id"),
    )


def _option_letter(index: int) -> str:
    return chr(ord("A") + index)


def _mock_question_text(q: dict[str, Any], language: str) -> str:
    question = q.get(f"question_text_{language}") or q.get("question_text_ru") or ""
    stimulus = q.get(f"context_stimulus_{language}") or q.get("context_stimulus_ru")
    if stimulus:
        return f"{stimulus}\n\n{question}".strip()
    return str(question).strip()


def question_to_mock_rows(subject: str, q: dict[str, Any]) -> list[MockQuestion]:
    """Mirror single-answer seed exam questions into the exact-answer bank."""
    correct_indices = q.get("correct_answers_indices") or []
    if len(correct_indices) != 1:
        return []

    try:
        correct_index = int(correct_indices[0])
    except (TypeError, ValueError):
        return []

    rows: list[MockQuestion] = []
    for language in ("ru", "kz"):
        text = _mock_question_text(q, language)
        options_list = q.get(f"options_{language}") or q.get("options_ru") or []
        if not text or correct_index < 0 or correct_index >= len(options_list):
            continue

        options = {_option_letter(index): str(option) for index, option in enumerate(options_list)}
        content_key = "|".join(
            [
                "opensamga_seed",
                language,
                str(q.get("question_id") or ""),
                text,
            ]
        )
        rows.append(
            MockQuestion(
                subject=subject,
                language=language,
                source="opensamga_seed",
                content_hash=hashlib.sha256(content_key.encode("utf-8")).hexdigest(),
                topic_tag=subject,
                question_text=text,
                options=options,
                correct_answer=_option_letter(correct_index),
                difficulty="MEDIUM",
            )
        )
    return rows


async def seed_questions(dry_run: bool = True):
    print("\n=== OpenSamga question seeder ===\n")
    print(f"Database dir: {DATABASE_DIR}")
    print(f"Mode: {'DRY RUN' if dry_run else 'COMMIT'}\n")

    subject_questions = load_json_files()

    total = sum(len(qs) for qs in subject_questions.values())
    mock_total = sum(
        len(question_to_mock_rows(subject, q))
        for subject, questions in subject_questions.items()
        for q in questions
    )
    print(f"\nTotal subjects: {len(subject_questions)}")
    print(f"Total questions: {total}")
    print(f"Exact-answer mock-bank rows: {mock_total}")

    if dry_run:
        print("\n[DRY RUN] No data written. Run with --commit to write.")
        return

    inserted = 0
    inserted_mock = 0
    skipped_existing = 0
    skipped_existing_mock = 0
    async with AsyncSessionLocal() as session:
        for subject, questions in subject_questions.items():
            for q in questions:
                source_id = q.get("question_id")
                if not source_id:
                    continue

                # Check if already exists
                result = await session.execute(
                    select(ExamQuestion).where(ExamQuestion.source_id == source_id)
                )
                existing = result.scalar_one_or_none()
                if existing:
                    skipped_existing += 1
                else:
                    row = question_to_row(subject, q)
                    session.add(row)
                    inserted += 1

                for mock_row in question_to_mock_rows(subject, q):
                    mock_result = await session.execute(
                        select(MockQuestion).where(
                            MockQuestion.content_hash == mock_row.content_hash
                        )
                    )
                    existing_mock = mock_result.scalar_one_or_none()
                    if existing_mock:
                        skipped_existing_mock += 1
                        continue
                    session.add(mock_row)
                    inserted_mock += 1

        await session.commit()
        print(f"\n[DONE] Inserted {inserted} exam questions ({skipped_existing} already existed).")
        print(
            f"[DONE] Inserted {inserted_mock} exact-answer mock-bank rows "
            f"({skipped_existing_mock} already existed)."
        )


if __name__ == "__main__":
    commit = "--commit" in sys.argv
    asyncio.run(seed_questions(dry_run=not commit))
