import os
from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/unt_platform"
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 30
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800

    OPENAI_API_KEY: SecretStr = SecretStr("")
    OPENAI_BASE_URL: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_PREMIUM_MODEL: str = ""
    EMBEDDING_API_KEY: SecretStr = SecretStr("")
    EMBEDDING_BASE_URL: str = ""
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    LIBRARY_EMBEDDING_PROVIDER: str = "local"
    LIBRARY_EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    # BUG-12 (2026-04-19) shadow rollout of multilingual embeddings.
    # When true, retrieval reads/writes `chunk_embedding_ml` (same
    # Vector(384) dimension) populated by
    # paraphrase-multilingual-MiniLM-L12-v2. Off-line smoke test showed
    # ru-kz cross-lingual cosine 0.748 avg with a 0.656 gap vs
    # negatives (vs all-MiniLM-L6-v2 which could not cross the 0.52
    # similarity floor). Flip the flag to true once the shadow table is
    # populated and the grounding probe clears 3/4.
    LIBRARY_EMBEDDING_MULTILINGUAL_MODEL: str = (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    RAG_USE_MULTILINGUAL: bool = False

    # Session-10 (2026-04-20): DashScope Qwen provider for OCR + embeddings.
    DASHSCOPE_API_KEY: SecretStr = SecretStr("")
    DASHSCOPE_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    DASHSCOPE_OCR_MODEL: str = "qwen-vl-ocr-latest"
    DASHSCOPE_EMBED_MODEL: str = "text-embedding-v4"
    EMBEDDING_DIMENSION: int = 1024
    # Session 12 (2026-04-21): rerank endpoint bug fixed (-intl host
    # rejected our key with 401). Mainland endpoint now returns sensible
    # relevance scores on the rerank_sanity probe (0.74 vs 0.01 for
    # off-topic docs).
    # Session 19 (2026-04-21): after two 60-query eval runs at 60-61
    # books the reranker loses on every axis (-1.6 pp grade@1,
    # -3.3 pp kp@1, +3.3 s latency). Default flipped to False; the
    # .env key stays the operational override so we can A/B later.
    RAG_USE_RERANKER: bool = False
    DASHSCOPE_RERANKER_MODEL: str = "gte-rerank"
    OPENAI_TIMEOUT: int = 60

    # === AGENT HARNESS (s24, agent-harness branch, 2026-04-26) ===
    # Master kill-switch. When False, /api/chat behaves exactly like
    # production: server-side RAG prefetch + one-shot tool dispatch.
    # When True, /api/chat delegates to the agent loop in
    # services/chat/agent_loop.py — autonomous tool-use, multi-iteration,
    # citation validator, no server-side prefetch.
    CHAT_AGENT_LOOP: bool = False
    # Hard ceiling on iterations per user turn. Anthropic Claude Code
    # defaults to ~25; we start tight at 8 because UNT chat is mostly
    # 1-2 hop reasoning and a runaway loop is worse than truncation.
    CHAT_AGENT_MAX_ITERATIONS: int = 8
    # When True, <think>…</think> blocks emitted by Qwen-family models
    # are routed to the thinking channel instead of being stripped.
    # Has no effect on non-thinking models.
    CHAT_AGENT_THINKING_VISIBLE: bool = True
    # s35 wave A1 (2026-04-28): per-tool wall-clock timeout. If a single
    # tool dispatch (e.g. consult_library hitting a slow Postgres) doesn't
    # return within this many seconds, asyncio.wait_for cancels it and
    # `_dispatch_one_tool` returns a timeout-shaped error envelope. The
    # FE renders it via FailedToolPill exactly like any other tool error.
    # 30s leaves headroom for cold-cache RAG hits while preventing a
    # single hung tool from burning the whole iteration cap.
    CHAT_AGENT_TOOL_TIMEOUT_SEC: float = 30.0
    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = ""
    MINIMAX_API_KEY: SecretStr = SecretStr("")
    MINIMAX_BASE_URL: str = ""

    SECRET_KEY: SecretStr = SecretStr("dev-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    DEBUG: bool = False
    ENVIRONMENT: str = "development"
    API_PREFIX: str = "/api"

    FRONTEND_URL: str = "http://localhost:5173"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Empty list ⇒ disable TrustedHostMiddleware (dev default). Set in prod.
    ALLOWED_HOSTS: list[str] = []
    # Defense in depth: when true, redirect HTTP→HTTPS at the app layer too.
    FORCE_HTTPS: bool = False

    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_BURST: int = 10
    RATE_LIMIT_PUBLIC: int = 20
    RATE_LIMIT_AUTH: int = 100

    SECURITY_HEADERS_ENABLED: bool = True

    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s:%(lineno)d | %(message)s"

    # Sentry configuration (empty DSN = Sentry disabled)
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "production"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.1

    # Redis caching (SCALE-01) — empty URL = fallback to in-memory cache
    REDIS_URL: str = ""
    REDIS_MAX_CONNECTIONS: int = 50
    REDIS_SOCKET_TIMEOUT: float = 5.0
    STATIC_URL: str = "/static"  # Override with CDN URL in production (SCALE-03 prep)

    # v3.6 (2026-04-29): payment-provider webhook signing secret.
    # Empty string = webhook in dev/no-provider mode (returns 503).
    # In production this must be a non-empty HMAC secret shared with
    # the payment provider; requests are rejected with 401 unless the
    # `X-Signature` header (HMAC-SHA256 of the raw body, hex-encoded)
    # matches. Audit finding #7.
    BILLING_WEBHOOK_SECRET: SecretStr = SecretStr("")

    @field_validator("SECRET_KEY", mode="before")
    @classmethod
    def validate_secret_key(cls, v, info):
        # Allow the raw string through -- we validate in validate_settings()
        # This ensures SecretStr wrapping works correctly
        return v

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def validate_settings():
    s = get_settings()
    errors = []

    if not s.OPENAI_API_KEY.get_secret_value():
        errors.append("OPENAI_API_KEY is required but not set")

    if s.ENVIRONMENT == "production" and not s.OPENAI_API_KEY.get_secret_value():
        errors.append("OPENAI_API_KEY must be set in production")

    if (
        s.SECRET_KEY.get_secret_value() == "dev-secret-key-change-in-production"
        and s.ENVIRONMENT == "production"
    ):
        errors.append("SECRET_KEY must be changed in production")

    if s.DEBUG and s.ENVIRONMENT == "production":
        errors.append("DEBUG should be False in production")

    if any("*" in origin for origin in s.ALLOWED_ORIGINS):
        errors.append("ALLOWED_ORIGINS must not contain wildcard '*' - use explicit origins only")

    if s.ENVIRONMENT == "production":
        if not s.ALLOWED_HOSTS:
            errors.append("ALLOWED_HOSTS must be a non-empty list of hostnames in production")
        elif any(h == "*" for h in s.ALLOWED_HOSTS):
            errors.append("ALLOWED_HOSTS must not contain wildcard '*' in production")

    return errors
