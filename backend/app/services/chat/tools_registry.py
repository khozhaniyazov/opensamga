"""
Canonical OpenAI tool schema for the chat endpoint.

Design rule: This schema is the SINGLE SOURCE OF TRUTH for function-calling.
Every tool name here must have a matching branch in `tool_executor.execute_tool`
(same file, same arg names). Never edit one without the other.

History (2026-04-18 audit): previously the schema lived in
`app.services.ai_orchestrator.TOOLS` and advertised 7 tool names that
`tool_executor.execute_tool` did not implement. The LLM was only ever able to
call `consult_library`; every other call silently resolved to
"Неизвестная функция". Schema is now colocated with the dispatcher.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_university_data",
            "description": (
                "Look up a university (and optionally a specific major) by name. "
                "Accepts slang/abbreviations ('Политех', 'СДУ', 'КБТУ', 'ЕНУ', "
                "'Нархоз', 'Демиреля') and resolves to the full name. Returns the "
                "general- and rural-quota grant thresholds together with their "
                "`data_year`."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "uni_name": {
                        "type": "string",
                        "description": "University name, code, slang, or abbreviation.",
                    },
                    "major_code": {
                        "type": "string",
                        "description": "Optional major code ('B057') or major name ('IT', 'медицина').",
                    },
                },
                "required": ["uni_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_grant_chance",
            "description": (
                "Compute grant probability for a specific university (+ optional "
                "major) given the student's score and quota. Returns a probability "
                "bucket and `data_year`. Use for 'какие у меня шансы в KBTU?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "uni_name": {"type": "string"},
                    "major_code": {"type": "string"},
                    "score": {
                        "type": "integer",
                        "description": "Student UNT/ENT score (0-140).",
                    },
                    "quota_type": {
                        "type": "string",
                        "enum": ["GENERAL", "RURAL", "ORPHAN"],
                        "default": "GENERAL",
                    },
                },
                "required": ["uni_name", "score"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_historical_data",
            "description": (
                "Get historical minimum grant thresholds. If `year` is given, "
                "returns only that year; otherwise walks priority "
                "2025 → 2024 → 2023 → 2022. Supports GROUP_BASELINE fallback."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "uni_name": {
                        "type": "string",
                        "description": "University name/slang, or 'GROUP_BASELINE'. Optional.",
                    },
                    "major_code": {"type": "string"},
                    "year": {
                        "type": "integer",
                        "description": "Specific year (2022-2025). Optional.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_major_requirements",
            "description": (
                "Return which UNT/ENT subjects a major group requires "
                "(e.g. 'B057 → informatics + math')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "major_code": {"type": "string", "description": "e.g. 'B057'."},
                },
                "required": ["major_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recommend_universities",
            "description": (
                "Return up to 5 universities whose thresholds the student's score "
                "clears, sorted by threshold desc. Use when the student gave a "
                "score but no specific university."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "score": {"type": "integer"},
                    "quota_type": {
                        "type": "string",
                        "enum": ["GENERAL", "RURAL", "ORPHAN"],
                        "default": "GENERAL",
                    },
                    "major_code": {"type": "string"},
                },
                "required": ["score"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_majors_by_subjects",
            "description": (
                "Find major groups that require a given pair of UNT/ENT subjects "
                "('какие специальности можно с физикой и математикой?')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subject1": {"type": "string"},
                    "subject2": {"type": "string"},
                },
                "required": ["subject1", "subject2"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_universities",
            "description": (
                "Side-by-side comparison of universities by their detail profiles "
                "(dormitory, military chair, student count, website)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "uni_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of university names or slang, e.g. ['KBTU', 'ЕНУ'].",
                    },
                },
                "required": ["uni_names"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_universities_by_region_and_features",
            "description": (
                "Find universities in a given city/region, optionally requiring "
                "dormitory and/or military chair."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "region": {"type": "string"},
                    "has_dorm": {"type": "boolean"},
                    "has_military_chair": {"type": "boolean"},
                },
                "required": ["region"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_detailed_grant_scores",
            "description": (
                "Detailed per-university min_score rows for a major, walking "
                "2024 → 2023 → 2022 priority. Adds SAFE/TARGET/REACH/UNLIKELY "
                "classification when the student's `score` is provided."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "major_code": {"type": "string"},
                    "major_name": {
                        "type": "string",
                        "description": "Major name or slang ('IT', 'айтишка', 'медицина').",
                    },
                    "uni_name": {"type": "string"},
                    "score": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_universities_by_score",
            "description": (
                "Bucket universities into SAFE / TARGET / REACH for a given "
                "student score + quota across a specific major (or across all "
                "majors if none given)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "score": {"type": "integer"},
                    "major_code": {"type": "string"},
                    "major_name": {"type": "string"},
                    "quota_type": {
                        "type": "string",
                        "enum": ["GENERAL", "RURAL", "ORPHAN"],
                        "default": "GENERAL",
                    },
                },
                "required": ["score"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consult_library",
            "description": (
                "RAG over official Kazakhstani UNT textbooks (TextbookChunk). MUST "
                "be called for any academic question (math, physics, history, "
                "chemistry, biology, geography, informatics). Returns top chunks "
                "with citation (subject, book title, grade, page). Do not answer "
                "academic questions without calling this first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "subject": {
                        "type": "string",
                        "description": "Optional subject filter ('Mathematics', 'Physics', 'History', ...).",
                    },
                    "grade": {
                        "type": "integer",
                        "description": "Student grade (8-11) for soft ranking preference.",
                    },
                },
                "required": ["query"],
            },
        },
    },
]

# Public alias used by the chat router.
tools = TOOLS

__all__ = ["TOOLS", "tools"]
