import enum

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class SubscriptionTier(str, enum.Enum):
    FREE = "FREE"
    PRO = "PRO"  # Legacy alias — kept for DB backward compat
    PREMIUM = "PREMIUM"


class LeagueTier(str, enum.Enum):
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"
    DIAMOND = "DIAMOND"
    ELITE = "ELITE"


class ConnectionStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    BLOCKED = "BLOCKED"


class ConnectionType(str, enum.Enum):
    FRIEND = "FRIEND"
    STUDY_BUDDY = "STUDY_BUDDY"
    RIVAL = "RIVAL"


class ActivityType(str, enum.Enum):
    TEST_COMPLETED = "TEST_COMPLETED"
    UNI_SELECTED = "UNI_SELECTED"
    BADGE_EARNED = "BADGE_EARNED"
    STREAK_MILESTONE = "STREAK_MILESTONE"


class Visibility(str, enum.Enum):
    PUBLIC = "PUBLIC"
    FRIENDS_ONLY = "FRIENDS_ONLY"
    PRIVATE = "PRIVATE"


class BattleStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class LootBoxRarity(str, enum.Enum):
    COMMON = "COMMON"
    RARE = "RARE"
    LEGENDARY = "LEGENDARY"


class RewardType(str, enum.Enum):
    TIP = "TIP"
    COSMETIC = "COSMETIC"
    TUTOR_SESSION = "TUTOR_SESSION"
    XP_MULTIPLIER = "XP_MULTIPLIER"


class LanguagePreference(str, enum.Enum):
    KZ = "KZ"
    RU = "RU"
    EN = "EN"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    subscription_tier = Column(Enum(SubscriptionTier), default=SubscriptionTier.FREE)

    # Auth fields
    email = Column(String, unique=True, index=True, nullable=True)
    phone = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    name = Column(String, nullable=True)
    language_preference = Column(Enum(LanguagePreference), default=LanguagePreference.RU)
    is_admin = Column(Boolean, default=False)

    # Billing / Subscription
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    billing_provider = Column(String, nullable=True)  # "manual" | "stripe" | "kaspi"
    provider_subscription_id = Column(String, nullable=True)

    # Safety & Moderation
    honor_score = Column(Integer, default=100)
    is_shadow_banned = Column(Boolean, default=False)
    moderation_flags = Column(JSON, default=[])

    # Relationships
    profile = relationship("StudentProfile", back_populates="user", uselist=False)
    gamification_profile = relationship("GamificationProfile", back_populates="user", uselist=False)
    activity_logs = relationship("ActivityLog", back_populates="user")
    mistakes = relationship("MistakeReview", back_populates="user")
    exam_attempts = relationship("ExamAttempt")


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))

    # Academic Info
    target_university_id = Column(Integer, nullable=True)
    chosen_subjects = Column(ARRAY(String))
    current_grade = Column(Integer)
    target_majors = Column(ARRAY(String), nullable=True)
    target_universities = Column(ARRAY(Integer), nullable=True)
    last_test_results = Column(JSON, nullable=True)
    weakest_subject = Column(String, nullable=True)
    # s26 phase 7: quota choice persisted so the chat agent can answer
    # "какие мои шансы?" without re-asking. Values match the strings
    # the DB already uses elsewhere ("GENERAL" | "RURAL"). NULL means
    # the student never picked one (legacy users from before the
    # onboarding step was tightened).
    competition_quota = Column(String, nullable=True)

    # Social Info
    bio = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)

    user = relationship("User", back_populates="profile")


class GamificationProfile(Base):
    __tablename__ = "gamification_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))

    current_streak = Column(Integer, default=0)
    last_activity_date = Column(DateTime(timezone=True), nullable=True)
    total_xp = Column(Integer, default=0)
    league_tier = Column(Enum(LeagueTier), default=LeagueTier.BRONZE)
    badges = Column(JSON, default=[])

    user = relationship("User", back_populates="gamification_profile")


class Connection(Base):
    __tablename__ = "connections"
    __table_args__ = (
        UniqueConstraint("follower_id", "following_id", name="uq_follower_following"),
        CheckConstraint("follower_id != following_id", name="check_no_self_follow"),
    )

    id = Column(Integer, primary_key=True, index=True)
    follower_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    following_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    status = Column(Enum(ConnectionStatus), default=ConnectionStatus.PENDING)
    connection_type = Column(Enum(ConnectionType), default=ConnectionType.FRIEND)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class StudyMatchRequest(Base):
    __tablename__ = "study_match_requests"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    receiver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    match_reason = Column(String)
    status = Column(Enum(ConnectionStatus), default=ConnectionStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Squad(Base):
    __tablename__ = "squads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    current_battle_id = Column(Integer, ForeignKey("squad_battles.id"), nullable=True)


class SquadMember(Base):
    __tablename__ = "squad_members"

    id = Column(Integer, primary_key=True, index=True)
    squad_id = Column(Integer, ForeignKey("squads.id"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    xp_contributed = Column(Integer, default=0)
    is_leader = Column(Boolean, default=False)


class SquadBattle(Base):
    __tablename__ = "squad_battles"

    id = Column(Integer, primary_key=True, index=True)
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    status = Column(Enum(BattleStatus), default=BattleStatus.ACTIVE)
    winning_squad_id = Column(Integer, nullable=True)


class LootBox(Base):
    __tablename__ = "loot_boxes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    opened_at = Column(DateTime(timezone=True), nullable=True)
    rarity = Column(Enum(LootBoxRarity))
    reward_type = Column(Enum(RewardType), nullable=True)
    reward_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserInventory(Base):
    __tablename__ = "user_inventory"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    item_type = Column(String)
    item_data = Column(JSON)
    acquired_at = Column(DateTime(timezone=True), server_default=func.now())


class ModerationLog(Base):
    __tablename__ = "moderation_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    action_type = Column(String)
    content = Column(String)
    verdict = Column(String)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    activity_type = Column(Enum(ActivityType))
    metadata_blob = Column(JSON, nullable=True)
    visibility = Column(Enum(Visibility), default=Visibility.PUBLIC)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_activity_logs_user_created", "user_id", created_at.desc()),)

    user = relationship("User", back_populates="activity_logs")


class PracticeSession(Base):
    __tablename__ = "practice_sessions"
    __table_args__ = (
        Index("ix_practice_sessions_user_updated", "user_id", text("updated_at DESC")),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject = Column(String, nullable=True, index=True)
    grade = Column(Integer, nullable=True)
    difficulty = Column(String, default="MEDIUM")
    language = Column(String, default="kz")
    target_questions = Column(Integer, default=10)
    generated_questions_count = Column(Integer, default=0)
    answered_questions_count = Column(Integer, default=0)
    correct_answers_count = Column(Integer, default=0)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")
    questions = relationship(
        "PracticeSessionQuestion",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class MistakeReview(Base):
    __tablename__ = "mistake_reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # Question snapshot (preserves original question even if DB changes)
    original_question_snapshot = Column(JSON, nullable=False)

    # Student's answer and correct answer
    user_answer = Column(String, nullable=False)
    correct_answer = Column(String, nullable=False)

    # AI diagnosis explanation
    ai_diagnosis = Column(Text, nullable=False)

    # RAG citation from library
    library_citation = Column(JSON, nullable=True)

    # Remedial practice questions (list of 3 questions)
    remedial_questions = Column(JSON, nullable=True)

    # Resolution tracking
    is_resolved = Column(Boolean, default=False, index=True)

    # === NEW FIELDS for MistakeReview & Gap Closer System ===

    # Topic extracted via AI or from question metadata (for clustering in Gap Analyzer)
    topic_tag = Column(String, nullable=True, index=True)

    # Source of truth chunk from textbook (ForeignKey to textbook_chunks.id)
    textbook_chunk_id = Column(Integer, ForeignKey("textbook_chunks.id"), nullable=True)

    # Question source type: "practice", "exam", or "chat"
    question_type = Column(String, nullable=True, default="practice")

    # Points lost for this mistake (fixed at 1 per requirement)
    points_lost = Column(Integer, default=1)

    # Count of correct answers on similar questions (for resurrection logic)
    # When >= 2, set is_resolved = True
    correct_answers_count = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_mistake_reviews_user_created", "user_id", created_at.desc()),
        Index("ix_mistake_reviews_user_resolved", "user_id", "is_resolved"),
        Index(
            "ix_mistake_reviews_user_topic",
            "user_id",
            "topic_tag",
            postgresql_where=text("topic_tag IS NOT NULL"),
        ),
    )

    # Relationships
    user = relationship("User", back_populates="mistakes")
    textbook_chunk = relationship("TextbookChunk")


class AcceptanceScore(Base):
    """Historical UNT acceptance thresholds by university/major/year."""

    __tablename__ = "acceptance_scores"
    __table_args__ = (
        UniqueConstraint(
            "university_code",
            "major_code",
            "year",
            "quota_type",
            name="uq_acceptance_score",
        ),
        Index("ix_acceptance_lookup", "university_code", "major_code", "year"),
    )

    id = Column(Integer, primary_key=True, index=True)
    university_code = Column(String, index=True, nullable=False)
    major_code = Column(String, index=True, nullable=False)
    year = Column(Integer, index=True, nullable=False)
    quota_type = Column(String, nullable=False)  # "GENERAL" or "RURAL"
    min_score = Column(Integer, nullable=False)
    grants_awarded = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UniversityData(Base):
    __tablename__ = "university_data"

    id = Column(Integer, primary_key=True, index=True)
    uni_name = Column(String, index=True)
    major_code = Column(String, index=True)
    major_name = Column(String)
    min_score_paid = Column(Integer, default=50)  # FIXED: Added missing column
    grant_threshold_general = Column(Integer)
    grant_threshold_rural = Column(Integer)
    tuition_per_year = Column(Integer, nullable=True)
    city = Column(String, nullable=True)


class MockQuestion(Base):
    __tablename__ = "mock_questions"

    id = Column(Integer, primary_key=True, index=True)
    subject = Column(String, index=True)
    grade = Column(Integer, nullable=True)
    language = Column(String(8), default="ru", index=True)
    source = Column(String(32), default="curated", index=True)
    source_url = Column(Text, nullable=True)
    content_hash = Column(String(64), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    topic_tag = Column(String)
    question_text = Column(String)
    options = Column(JSON)
    correct_answer = Column(String)
    difficulty = Column(String, default="MEDIUM")
    # 1024-d to match DashScope text-embedding-v4 (session 23c).
    question_embedding = Column(Vector(1024))


class ExamQuestion(Base):
    """
    Stores questions for the proper EHT/UBT exam engine simulation.

    Supported format values:
        "single_choice"   — one correct option (1 pt)
        "multiple_choice" — multiple correct options (up to 2 pts, partial credit)
        "context"         — single choice with a shared reading passage (1 pt)
        "matching"        — pair items from two columns (partial credit)
        "fill_blank"      — text input validated against accepted answers
        "image_choice"    — image with answer choices (scored like single/multi)
        "ordering"        — arrange items in correct sequence (partial credit)
    """

    __tablename__ = "exam_questions"

    id = Column(Integer, primary_key=True, index=True)

    # "Mathematics", "History of Kazakhstan", etc.
    # Use canonical english names from constants/subjects.py
    subject = Column(String, index=True, nullable=False)

    # Original JSON ID like "bio_single_001"
    source_id = Column(String, unique=True, index=True)

    # See docstring above for valid format values
    format = Column(String, nullable=False)
    max_points = Column(Integer, default=1)

    # Bilingual text
    question_text_kz = Column(Text, nullable=False)
    question_text_ru = Column(Text, nullable=False)

    # JSON arrays of strings: ["Option 1", "Option 2"]
    # Used by single_choice, multiple_choice, context, image_choice
    options_kz = Column(JSON, nullable=False)
    options_ru = Column(JSON, nullable=False)

    # Array of integers (0-indexed) — correct option indices
    # Used by single_choice, multiple_choice, context, image_choice
    correct_answers_indices = Column(ARRAY(Integer), nullable=False)

    # For context questions
    context_stimulus_kz = Column(Text, nullable=True)
    context_stimulus_ru = Column(Text, nullable=True)
    context_group_id = Column(String, nullable=True, index=True)

    # ── New columns for expanded question types ──────────────────────────
    # NOTE: These are nullable additions. In production, run:
    #   ALTER TABLE exam_questions ADD COLUMN matching_pairs JSON;
    #   ALTER TABLE exam_questions ADD COLUMN image_url VARCHAR;
    #   ALTER TABLE exam_questions ADD COLUMN correct_order JSON;
    #   ALTER TABLE exam_questions ADD COLUMN accepted_answers JSON;

    # For matching: [{"left": "...", "right": "..."}] pairs
    matching_pairs = Column(JSON, nullable=True)

    # For image-based questions: URL to question image (not binary)
    image_url = Column(String, nullable=True)

    # For ordering: list of item IDs in correct sequence
    correct_order = Column(JSON, nullable=True)

    # For fill-in-the-blank: list of acceptable answer strings
    accepted_answers = Column(JSON, nullable=True)


class HistoricalGrantThreshold(Base):
    __tablename__ = "historical_grant_thresholds"

    id = Column(Integer, primary_key=True, index=True)
    uni_name = Column(String, index=True)
    major_code = Column(String, index=True)
    data_year = Column(Integer, index=True)
    quota_type = Column(String)
    min_score = Column(Integer)
    grants_awarded_count = Column(Integer)
    is_admission_score = Column(String)


class MajorGroup(Base):
    __tablename__ = "major_groups"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, unique=True, index=True)
    group_name = Column(String)
    unt_subjects = Column(String)
    url = Column(String, nullable=True)
    # Search keywords: comma-separated synonyms for human-friendly search
    # e.g., "it, айти, coding, программирование, developer"
    search_keywords = Column(String, nullable=True)


class UniversityDetail(Base):
    __tablename__ = "university_details"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, index=True)
    university_code = Column(String, unique=True, index=True)
    website = Column(String, nullable=True)
    total_students = Column(Integer, default=0)
    grant_students = Column(Integer, default=0)
    paid_students = Column(Integer, default=0)
    military_chair = Column(String)
    has_dorm = Column(String)
    contacts_raw = Column(JSON, nullable=True)
    source_url = Column(String, nullable=True)
    # Search keywords: comma-separated synonyms for human-friendly search
    # e.g., "sdu, сду, demirel, демирель, kaskelen"
    search_keywords = Column(String, nullable=True)


class ChatThread(Base):
    """Session 22 (BUG-S22-sidebar): per-user chat conversation.

    A "thread" is what users perceive as a separate ChatGPT-style
    conversation. Legacy `chat_messages` rows pre-dating s22 have
    `thread_id=NULL` and are surfaced in the FE under a synthetic
    "Main chat" bucket, so no backfill is needed and no history is
    lost on migration day.
    """

    __tablename__ = "chat_threads"
    __table_args__ = (Index("ix_chat_threads_user_updated", "user_id", text("updated_at DESC")),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Short title. FE seeds with the first user turn's first ~40 chars.
    # NULL = untitled ("New chat" placeholder).
    title = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Bumped on every new message save so the sidebar can sort by recency.
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", backref="chat_threads")
    # passive_deletes=True: trust the DB-level ON DELETE CASCADE on
    # chat_messages.thread_id rather than letting SQLAlchemy issue
    # UPDATEs that set child rows' thread_id to NULL. Without this the
    # messages would silently fall into the legacy "Main chat" bucket
    # after a thread delete instead of being removed with it.
    messages = relationship(
        "ChatMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_user_created", "user_id", text("created_at DESC")),
        Index("ix_chat_messages_thread_created", "thread_id", text("created_at ASC")),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # s22: NULL = legacy "main chat" bucket; non-NULL = an explicit thread.
    thread_id = Column(
        Integer,
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Optional: store tool calls or widget data as JSON
    message_metadata = Column(JSON, nullable=True)

    user = relationship("User", backref="chat_messages")
    thread = relationship("ChatThread", back_populates="messages")


class FailedQueryStatus(str, enum.Enum):
    PENDING = "PENDING"
    ANALYZED = "ANALYZED"


class FailureReason(str, enum.Enum):
    RETRIEVAL_BUG = "RETRIEVAL_BUG"
    MISSING_DATA = "MISSING_DATA"
    AMBIGUOUS = "AMBIGUOUS"
    UNKNOWN = "UNKNOWN"


class FailedQuery(Base):
    __tablename__ = "failed_queries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )  # Nullable for guest users
    user_query = Column(String, nullable=False)  # The original user question
    ai_response = Column(String, nullable=False)  # The AI's response that indicated failure
    timestamp = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    status = Column(Enum(FailedQueryStatus), default=FailedQueryStatus.PENDING, index=True)
    failure_reason = Column(Enum(FailureReason), nullable=True)
    suggested_fix = Column(String, nullable=True)  # e.g., "Add alias 'Polytech' to Uni ID 25"

    # Additional metadata for analysis
    tool_calls_attempted = Column(JSON, nullable=True)  # List of tools that were called
    analysis_notes = Column(String, nullable=True)  # Notes from the judge agent

    user = relationship("User", backref="failed_queries")


class Textbook(Base):
    __tablename__ = "textbooks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    subject = Column(String, nullable=False, index=True)  # e.g., "Mathematics", "Physics"
    grade = Column(Integer, nullable=False, index=True)  # e.g., 10, 11
    file_path = Column(String, nullable=False, unique=True)  # Original file path
    file_name = Column(String, nullable=False)  # Just the filename
    total_pages = Column(Integer, nullable=False)
    total_chunks = Column(Integer, default=0)
    ocr_status = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    chunks = relationship("TextbookChunk", back_populates="textbook", cascade="all, delete-orphan")


class TextbookChunk(Base):
    __tablename__ = "textbook_chunks"

    id = Column(Integer, primary_key=True, index=True)
    textbook_id = Column(Integer, ForeignKey("textbooks.id"), nullable=False, index=True)
    page_number = Column(Integer, nullable=False, index=True)  # CRITICAL: Retain page number
    chunk_index = Column(Integer, nullable=False)  # Index of chunk within the page
    content = Column(String, nullable=False)  # The actual text content
    token_count = Column(Integer, nullable=False)  # Approximate token count
    # Session-10 (2026-04-20): RAG chunks use DashScope text-embedding-v4
    # (multilingual, 1024-dim). Previous 384-dim MiniLM column has been
    # resized in-place via alter_schema_for_qwen.py.
    chunk_embedding = Column(Vector(1024))
    ingest_source = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # === Commuter Mode: TTS Audio fields ===
    audio_file_path = Column(String, nullable=True)  # Path to generated OGG audio
    audio_generated_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    textbook = relationship("Textbook", back_populates="chunks")


class GeneratedQuestion(Base):
    """
    Grounded Question Generator (GQG) - Stores AI-generated MCQ questions
    that are guaranteed to be grounded in textbook content.

    The anchor_chunk contains the "truth" (correct answer source).
    Distractors are sourced from semantically similar but different chunks.
    """

    __tablename__ = "generated_questions"

    id = Column(Integer, primary_key=True, index=True)

    # Source tracking (the "Anchor" - truth source)
    anchor_chunk_id = Column(Integer, ForeignKey("textbook_chunks.id"), nullable=False, index=True)
    subject = Column(
        String, nullable=False, index=True
    )  # e.g., "Mathematics", "History of Kazakhstan"
    grade = Column(Integer, nullable=False, index=True)  # e.g., 10, 11

    # Question content
    question_text = Column(String, nullable=False)
    question_type = Column(
        String, default="factual"
    )  # "when", "who", "where", "what", "why", "factual"
    difficulty = Column(String, default="MEDIUM")  # EASY, MEDIUM, HARD
    language = Column(String, default="kz")  # "kz" (Kazakh) or "ru" (Russian)

    # Options - Option A is ALWAYS the correct answer by design
    option_a = Column(String, nullable=False)  # CORRECT - derived from anchor
    option_b = Column(String, nullable=False)  # Distractor from similar chunk
    option_c = Column(String, nullable=False)  # Distractor from similar chunk
    option_d = Column(String, nullable=False)  # Distractor from similar chunk

    # Distractor source tracking (for verification/debugging)
    distractor_chunk_ids = Column(ARRAY(Integer))  # [chunk_b_id, chunk_c_id, chunk_d_id]

    # Citation metadata - the "receipt" proving the answer
    citation = Column(JSON)  # {"book": "...", "page": 145, "quote": "..."}

    # Explanations for each option
    explanations = Column(JSON)  # {"a": "Correct because...", "b": "Wrong because..."}

    # Analytics
    times_served = Column(Integer, default=0)
    times_answered_correctly = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    anchor_chunk = relationship("TextbookChunk")
    session_entries = relationship("PracticeSessionQuestion", back_populates="question")


class PracticeSessionQuestion(Base):
    __tablename__ = "practice_session_questions"
    __table_args__ = (
        UniqueConstraint(
            "practice_session_id",
            "question_id",
            name="uq_practice_session_question",
        ),
        Index(
            "ix_practice_session_questions_session_sequence",
            "practice_session_id",
            "sequence_number",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    practice_session_id = Column(
        Integer,
        ForeignKey("practice_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    question_id = Column(
        Integer,
        ForeignKey("generated_questions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    sequence_number = Column(Integer, nullable=False)
    answered_at = Column(DateTime(timezone=True), nullable=True)
    answered_correctly = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("PracticeSession", back_populates="questions")
    question = relationship("GeneratedQuestion", back_populates="session_entries")


class AudioPlaybackLog(Base):
    """
    Commuter Mode: Tracks audio playback for mistake segments.
    Used to determine when mistakes should be auto-resolved (after 5 complete listens).
    """

    __tablename__ = "audio_playback_logs"
    __table_args__ = (
        # Composite index for efficient playback count queries
        Index("ix_playback_user_mistake", "user_id", "mistake_review_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mistake_review_id = Column(Integer, ForeignKey("mistake_reviews.id", ondelete="CASCADE"))
    segment_index = Column(Integer, default=0)  # Which segment in playlist
    playback_completed = Column(Boolean, default=False)  # True if full segment listened
    started_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User")
    mistake_review = relationship("MistakeReview")


class UsageCounter(Base):
    """
    Daily usage counters per user.
    One row per (user_id, date) — resets each day.
    Used for enforcing FREE / PREMIUM quotas.
    """

    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_usage_user_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    date = Column(Date, nullable=False, index=True)

    chat_messages = Column(Integer, default=0)
    exam_runs = Column(Integer, default=0)
    mistake_analyses = Column(Integer, default=0)
    practice_questions = Column(Integer, default=0)

    user = relationship("User")


# =============================================================================
# STUDENT SUPERAPP MARKETPLACE MODELS
# =============================================================================


class OnboardingStep(str, enum.Enum):
    """Progressive profiling stages"""

    REGISTERED = "REGISTERED"
    PROFILE_BASIC = "PROFILE_BASIC"
    PROFILE_ACADEMIC = "PROFILE_ACADEMIC"
    PROFILE_SKILLS = "PROFILE_SKILLS"
    PROFILE_PORTFOLIO = "PROFILE_PORTFOLIO"
    APPLY_READY = "APPLY_READY"


class OpportunityStatus(str, enum.Enum):
    """Opportunity lifecycle states"""

    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    CLOSED = "CLOSED"
    EXPIRED = "EXPIRED"
    FLAGGED = "FLAGGED"


class OpportunityType(str, enum.Enum):
    """Types of opportunities"""

    INTERNSHIP = "INTERNSHIP"
    PART_TIME = "PART_TIME"
    FULL_TIME = "FULL_TIME"
    PROJECT = "PROJECT"
    CLUB = "CLUB"
    HACKATHON = "HACKATHON"
    COFOUNDER = "COFOUNDER"
    MENTORSHIP = "MENTORSHIP"
    RESEARCH = "RESEARCH"


class ApplicationStatus(str, enum.Enum):
    """Application state machine states"""

    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    VIEWED = "VIEWED"
    SHORTLISTED = "SHORTLISTED"
    INTERVIEW_SCHEDULED = "INTERVIEW_SCHEDULED"
    OFFERED = "OFFERED"
    ACCEPTED = "ACCEPTED"
    DECLINED_BY_POSTER = "DECLINED_BY_POSTER"
    DECLINED_BY_STUDENT = "DECLINED_BY_STUDENT"
    WITHDRAWN = "WITHDRAWN"
    EXPIRED = "EXPIRED"


class VerificationType(str, enum.Enum):
    """Types of user verification"""

    EMAIL_EDU = "EMAIL_EDU"
    TRANSCRIPT = "TRANSCRIPT"
    LINKEDIN = "LINKEDIN"
    GITHUB = "GITHUB"
    EMPLOYER_VERIFIED = "EMPLOYER_VERIFIED"


class ReportType(str, enum.Enum):
    """Types of user reports"""

    SPAM = "SPAM"
    FAKE_OPPORTUNITY = "FAKE_OPPORTUNITY"
    HARASSMENT = "HARASSMENT"
    INAPPROPRIATE = "INAPPROPRIATE"
    SCAM = "SCAM"
    OTHER = "OTHER"


class ReportStatus(str, enum.Enum):
    """Report resolution status"""

    PENDING = "PENDING"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED_ACTION_TAKEN = "RESOLVED_ACTION_TAKEN"
    RESOLVED_NO_ACTION = "RESOLVED_NO_ACTION"
    DISMISSED = "DISMISSED"


# Valid application state transitions (state machine)
VALID_APPLICATION_TRANSITIONS = {
    ApplicationStatus.DRAFT: [ApplicationStatus.SUBMITTED, ApplicationStatus.WITHDRAWN],
    ApplicationStatus.SUBMITTED: [
        ApplicationStatus.VIEWED,
        ApplicationStatus.EXPIRED,
        ApplicationStatus.WITHDRAWN,
    ],
    ApplicationStatus.VIEWED: [
        ApplicationStatus.SHORTLISTED,
        ApplicationStatus.DECLINED_BY_POSTER,
    ],
    ApplicationStatus.SHORTLISTED: [
        ApplicationStatus.INTERVIEW_SCHEDULED,
        ApplicationStatus.OFFERED,
        ApplicationStatus.DECLINED_BY_POSTER,
    ],
    ApplicationStatus.INTERVIEW_SCHEDULED: [
        ApplicationStatus.OFFERED,
        ApplicationStatus.DECLINED_BY_POSTER,
        ApplicationStatus.DECLINED_BY_STUDENT,
    ],
    ApplicationStatus.OFFERED: [
        ApplicationStatus.ACCEPTED,
        ApplicationStatus.DECLINED_BY_STUDENT,
    ],
    ApplicationStatus.ACCEPTED: [],  # Terminal state
    ApplicationStatus.DECLINED_BY_POSTER: [],  # Terminal state
    ApplicationStatus.DECLINED_BY_STUDENT: [],  # Terminal state
    ApplicationStatus.WITHDRAWN: [],  # Terminal state
    ApplicationStatus.EXPIRED: [],  # Terminal state
}


class Opportunity(Base):
    """
    Job, project, club, or other opportunity posted by employers/organizations.
    Core of the two-sided marketplace.
    """

    __tablename__ = "opportunities"
    __table_args__ = (
        Index("ix_opportunities_skills", "required_skills", postgresql_using="gin"),
        Index("ix_opportunities_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    poster_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # Basic info
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    opportunity_type = Column(Enum(OpportunityType), nullable=False)

    # Requirements
    required_skills = Column(ARRAY(String), default=[])
    preferred_major_codes = Column(ARRAY(String), default=[])
    min_grade = Column(Integer, nullable=True)  # Minimum grade level

    # Location & commitment
    location = Column(String, default="remote")  # 'remote', 'almaty', 'astana', etc.
    is_remote = Column(Boolean, default=True)
    commitment_hours_per_week = Column(Integer, nullable=True)
    duration_weeks = Column(Integer, nullable=True)
    start_date = Column(DateTime(timezone=True), nullable=True)

    # Compensation
    is_paid = Column(Boolean, default=False)
    compensation_description = Column(String, nullable=True)

    # Screening questions (max 3)
    screening_questions = Column(JSON, default=[])  # [{"question": "...", "required": true}]

    # Status & lifecycle
    status = Column(Enum(OpportunityStatus), default=OpportunityStatus.DRAFT)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    # Embedding for semantic matching (pgvector)
    opportunity_embedding = Column(Vector(1536), nullable=True)

    # Trust & safety
    is_verified = Column(Boolean, default=False)
    is_featured = Column(Boolean, default=False)
    report_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    application_count = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    poster = relationship("User", backref="posted_opportunities")
    applications = relationship(
        "OpportunityApplication",
        back_populates="opportunity",
        cascade="all, delete-orphan",
    )


class OpportunityApplication(Base):
    """
    Student application to an opportunity.
    Implements a proper state machine for application lifecycle.
    """

    __tablename__ = "opportunity_applications"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "applicant_id", name="uq_opportunity_applicant"),
        Index("ix_applications_status", "status"),
        Index("ix_applications_applicant", "applicant_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    opportunity_id = Column(Integer, ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    applicant_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # State machine
    status = Column(Enum(ApplicationStatus), default=ApplicationStatus.DRAFT)
    status_changed_at = Column(DateTime(timezone=True), server_default=func.now())
    status_history = Column(
        JSON, default=[]
    )  # Audit trail: [{"status": "...", "at": "...", "by": "..."}]

    # Application content
    cover_note = Column(Text, nullable=True)
    screening_answers = Column(JSON, default=[])  # [{"question_id": 0, "answer": "..."}]
    attachment_urls = Column(ARRAY(String), default=[])

    # Poster notes (private)
    poster_notes = Column(Text, nullable=True)

    # Interview scheduling
    interview_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    interview_location = Column(String, nullable=True)  # URL for video call or physical address

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    viewed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    opportunity = relationship("Opportunity", back_populates="applications")
    applicant = relationship("User", backref="applications")


class Verification(Base):
    """
    Cryptographic verification of user claims (school email, LinkedIn, GitHub, etc.)
    Trust primitive for the marketplace.
    """

    __tablename__ = "verifications"
    __table_args__ = (
        UniqueConstraint("user_id", "verification_type", name="uq_user_verification"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    verification_type = Column(Enum(VerificationType), nullable=False)

    # Proof storage
    proof_hash = Column(String, nullable=True)  # SHA256 of evidence
    proof_metadata = Column(JSON, default={})  # {"domain": "narxoz.kz", "verified_email": "..."}

    # Status
    is_verified = Column(Boolean, default=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    # For OAuth verifications
    oauth_provider_id = Column(String, nullable=True)  # LinkedIn/GitHub user ID
    oauth_profile_url = Column(String, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", backref="verifications")


class Report(Base):
    """
    User reports for trust/safety moderation.
    """

    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_status", "status"),)

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # What's being reported
    reported_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    reported_opportunity_id = Column(
        Integer, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=True
    )

    # Report details
    report_type = Column(Enum(ReportType), nullable=False)
    description = Column(Text, nullable=True)
    evidence_urls = Column(ARRAY(String), default=[])

    # Resolution
    status = Column(Enum(ReportStatus), default=ReportStatus.PENDING)
    moderator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_notes = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    reporter = relationship("User", foreign_keys=[reporter_id], backref="reports_filed")
    reported_user = relationship(
        "User", foreign_keys=[reported_user_id], backref="reports_received"
    )
    reported_opportunity = relationship("Opportunity", backref="reports")


class TelemetryEvent(Base):
    """
    Event sourcing for analytics, funnels, and A/B testing.
    Core of the event-driven architecture.
    """

    __tablename__ = "telemetry_events"
    __table_args__ = (
        Index("ix_events_funnel", "event_type", "user_id", "timestamp"),
        Index("ix_events_session", "session_id", "timestamp"),
        Index("ix_events_type_time", "event_type", "timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # Event identification
    event_type = Column(
        String, nullable=False, index=True
    )  # 'portfolio.created', 'opportunity.viewed'
    event_version = Column(String, default="1.0")  # Schema versioning

    # Who triggered the event
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_id = Column(String, nullable=True, index=True)

    # Event data
    properties = Column(JSON, default={})  # Flexible schema for event-specific data

    # Context
    source = Column(String, nullable=True)  # 'web', 'mobile', 'api'
    page_url = Column(String, nullable=True)
    referrer = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)

    # A/B testing support
    experiment_id = Column(String, nullable=True)
    variant = Column(String, nullable=True)

    # Timestamp
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class Portfolio(Base):
    """
    Student portfolio for applying to opportunities.
    Implements progressive profiling with completeness scoring.
    """

    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    # Progressive profiling stage
    onboarding_step = Column(Enum(OnboardingStep), default=OnboardingStep.REGISTERED)
    onboarding_completed_at = Column(DateTime(timezone=True), nullable=True)

    # Skills & interests
    skills = Column(ARRAY(String), default=[])
    interests = Column(ARRAY(String), default=[])
    intents = Column(ARRAY(String), default=[])  # ['internship', 'project', 'cofounder', 'mentor']

    # Availability
    availability_hours_per_week = Column(Integer, nullable=True)
    available_start_date = Column(DateTime(timezone=True), nullable=True)
    preferred_locations = Column(ARRAY(String), default=["remote"])

    # External links
    linkedin_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    portfolio_url = Column(String, nullable=True)
    resume_url = Column(String, nullable=True)

    # Projects (structured data)
    projects = Column(
        JSON, default=[]
    )  # [{"title": "...", "description": "...", "url": "...", "skills": [...]}]
    achievements = Column(
        JSON, default=[]
    )  # [{"title": "...", "date": "...", "description": "..."}]

    # Headline and summary
    headline = Column(String, nullable=True)  # "CS Student | Aspiring PM | Open to Internships"
    summary = Column(Text, nullable=True)

    # Completeness flags for scoring
    has_skills = Column(Boolean, default=False)
    has_bio = Column(Boolean, default=False)
    has_avatar = Column(Boolean, default=False)
    has_linkedin = Column(Boolean, default=False)
    has_github = Column(Boolean, default=False)
    has_project = Column(Boolean, default=False)
    has_resume = Column(Boolean, default=False)

    # Embedding for semantic matching (pgvector)
    portfolio_embedding = Column(Vector(1536), nullable=True)
    last_embedding_update = Column(DateTime(timezone=True), nullable=True)

    # Visibility
    visibility = Column(Enum(Visibility), default=Visibility.PUBLIC)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", backref="portfolio")

    @property
    def completeness_score(self) -> int:
        """
        Calculate apply-ready score (0-100).
        Weighted by importance for opportunities.
        """
        factors = [
            (self.has_bio, 10),
            (self.has_avatar, 5),
            (self.has_skills and len(self.skills or []) >= 3, 25),
            (self.has_linkedin, 15),
            (self.has_github, 10),
            (self.has_project and len(self.projects or []) >= 1, 20),
            (self.has_resume, 15),
        ]
        return sum(weight for flag, weight in factors if flag)


class UploadJobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING_OCR = "PROCESSING_OCR"
    PROCESSING_VECTOR = "PROCESSING_VECTOR"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class LibraryUploadJob(Base):
    """
    Background job to track the upload, OCR transcription, and vector embedding
    of scanned textbooks for the web admin interface.
    """

    __tablename__ = "library_upload_jobs"
    __table_args__ = (Index("ix_library_jobs_status", "status"),)

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    grade = Column(Integer, nullable=False)

    # Progress tracking
    status = Column(Enum(UploadJobStatus), default=UploadJobStatus.PENDING)
    logs = Column(Text, nullable=True)  # captures script output/errors

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ParentReportShareToken(Base):
    """v3.27 (2026-05-01): Tokenized share link for the parent report.

    A student can mint one of these from /api/parent-report/tokens; the
    token grants read-only access to a sanitized snapshot (first name +
    grade, exam history, target universities, weak topics, profile
    pair) for ``expires_at``. The student can revoke a token at any
    time via ``is_revoked = true``.

    PII surface is intentionally narrow (first name + grade, no email,
    no surname, no telegram_id) — see docs/EXTERNAL_USER_SIGNAL_POLICY.md
    and KZ Law on Personal Data refs.
    """

    __tablename__ = "parent_report_share_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # secrets.token_urlsafe(32) — 43 char URL-safe opaque string. Never a JWT;
    # do NOT use any field from this token to authenticate the student.
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Bookkeeping for ops + audit. Updated on each successful read.
    last_accessed_at = Column(DateTime(timezone=True), nullable=True)
    access_count = Column(Integer, default=0, nullable=False)


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Exam configuration
    subjects = Column(ARRAY(String), nullable=False)
    total_questions = Column(Integer, nullable=False)
    time_limit_seconds = Column(Integer, nullable=False)

    # Results
    score = Column(Integer, nullable=False)
    max_score = Column(Integer, nullable=False)
    answers = Column(JSON, nullable=False)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=False)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    time_taken_seconds = Column(Integer, nullable=False)
    __table_args__ = (Index("ix_exam_attempts_user_submitted", "user_id", submitted_at.desc()),)

    # Relationships
    user = relationship("User", overlaps="exam_attempts")
