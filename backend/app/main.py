import asyncio
import os
import sys
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from brotli_asgi import BrotliMiddleware
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from starlette.middleware.gzip import GZipMiddleware

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import settings
from .database import AsyncSessionLocal, engine
from .logging_config import get_logger, setup_logging
from .middleware.logging import log_requests_middleware
from .middleware.rate_limit import limiter
from .middleware.security_headers import security_headers_middleware
from .middleware.sentry import init_sentry
from .models import User
from .routers import (
    admin,
    analytics,
    auth,
    billing,
    chat,
    chat_websocket,
    commuter,
    data,
    dev_console,
    exam,
    feedback,
    gamification,
    growth,
    health,
    library,
    matching,
    mistakes,
    opportunities,
    parent_report,
    portfolio,
    practice,
    rewards,
    social,
    strategy,
    users,
)
from .utils.onboarding import is_onboarding_completed

# telemetry_console module is a private ops surface that is NOT shipped in
# the open-source build. The main app keeps the integration points but they
# are no-ops here; if you want application telemetry, wire your own
# OpenTelemetry / Sentry / etc. client into the places that currently check
# TELEMETRY_AVAILABLE.
TELEMETRY_AVAILABLE = False
telemetry_router = None
telemetry_client = None


class _StubSeverity:
    """Fallback shim so SeverityLevel.* attribute access doesn't explode in
    code paths the upstream private build uses. Each attribute just returns
    the string form of the level name."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


SeverityLevel = _StubSeverity


async def init_telemetry_tables() -> None:  # type: ignore[no-redef]
    """No-op in the open-source build.

    Declared `async` because the upstream private surface is awaited at
    module-load (`await init_telemetry_tables()`); a sync stub would raise
    TypeError if anyone ever flipped `TELEMETRY_AVAILABLE = True`.
    """
    return None


setup_logging(debug=os.getenv("DEBUG", "false").lower() == "true")
logger = get_logger("main")

# Graceful shutdown timeout (seconds) - configurable per D-04
SHUTDOWN_TIMEOUT = int(os.getenv("SHUTDOWN_TIMEOUT", "30"))

ONBOARDING_ALLOWED_EXACT_PATHS = {
    "/api/users/me",
    "/api/billing/status",
}
ONBOARDING_ALLOWED_PREFIXES = (
    "/api/auth/",
    "/api/data/universities",
)


def _is_onboarding_allowed_path(path: str) -> bool:
    return path in ONBOARDING_ALLOWED_EXACT_PATHS or any(
        path.startswith(prefix) for prefix in ONBOARDING_ALLOWED_PREFIXES
    )


def _extract_request_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization") or ""
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            return token

    query_token = request.query_params.get("token")
    if query_token:
        return query_token.strip() or None
    return None


def _decode_token_email(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[settings.ALGORITHM],
        )
    except JWTError:
        return None
    except Exception:
        return None
    # v3.3: refresh tokens are not access tokens. The onboarding-redirect
    # middleware uses this helper to decide whether the request is from
    # an authenticated student; a refresh token is NOT an authenticated
    # request in that sense.
    if payload.get("type") == "refresh":
        return None
    email = payload.get("sub")
    return str(email) if email else None


@asynccontextmanager
async def lifespan(app: FastAPI):

    logger.info("🚀 Starting Samga.ai API...")

    # Fail fast on misconfigured production settings
    from .config import validate_settings as _validate

    _cfg_errors = _validate()
    if _cfg_errors:
        msg = "Configuration errors:\n  - " + "\n  - ".join(_cfg_errors)
        if settings.ENVIRONMENT == "production":
            logger.critical(msg)
            raise RuntimeError(msg)
        logger.warning(msg)

    logger.info("⚡ Knowledge Graph will load lazily on first use")

    # v3.7 (2026-04-30) — audit finding #3.
    #
    # Previously this branch ran `Base.metadata.create_all`, which
    # was a latent schema bomb: it masked missing Alembic revisions
    # (the graph had FOUR parallel heads at the time of the audit),
    # silently skipped existing tables, and meant the schema was
    # being kept in sync by `create_all` rather than by Alembic.
    # Adding a `Column(nullable=False)` to a model without a real
    # migration would crash on the first INSERT — and the green
    # "Database tables verified" log line gave no warning.
    #
    # The new posture: the running app does NOT touch DDL. Schema
    # changes are the deploy operator's job (`alembic upgrade head`).
    # We DO compare the live alembic_version row against the
    # expected head and refuse to start in production when they
    # diverge — fail-fast is preferable to running with a schema
    # that doesn't match the model layer.
    #
    # `engine` is still needed below for the lifespan to test the
    # connection is reachable.
    logger.info("🗄️ Verifying database connectivity...")
    try:
        from sqlalchemy import text

        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            logger.info("Database connection OK")
    except Exception as e:
        logger.critical(f"Database connectivity check failed: {e}")
        raise

    # In production, refuse to start if Alembic is not at head.
    # Dev keeps the warning-only behavior so a fresh laptop
    # checkout can still iterate without first running migrations.
    try:
        from .utils.alembic_check import warn_or_raise_on_alembic_drift

        await warn_or_raise_on_alembic_drift(engine, settings.ENVIRONMENT)
    except Exception:
        logger.exception("Alembic drift check failed (non-fatal in dev)")

    # Initialize Sentry error tracking (DEPLOY-04, DEPLOY-05)
    if settings.SENTRY_DSN:
        init_sentry(settings)
        logger.info("Sentry error tracking initialized")
    else:
        logger.info("Sentry not configured (SENTRY_DSN not set)")

    if TELEMETRY_AVAILABLE:
        try:
            await init_telemetry_tables()
            logger.info("Telemetry tables initialized")
        except Exception as e:
            logger.warning(f"Telemetry initialization failed (non-critical): {e}")

    uploads_path = Path(__file__).parent.parent / "uploads"
    uploads_path.mkdir(exist_ok=True)
    (uploads_path / "audio").mkdir(exist_ok=True)
    (uploads_path / "avatars").mkdir(exist_ok=True)
    logger.info("Upload directories ready")

    # Initialize cache backend (SCALE-01: Redis if configured, else in-memory)
    from .utils import cache as cache_module
    from .utils.cache import create_cache

    cache_backend = await create_cache(settings.REDIS_URL)
    await cache_module.cache.set_backend(cache_backend)

    # v3.6 (2026-04-29): janitor stuck library upload jobs left over
    # from a previous worker that died mid-OCR. Audit finding #9.
    try:
        from .services.library_upload_janitor import mark_stuck_uploads_failed

        async with AsyncSessionLocal() as session:
            flipped = await mark_stuck_uploads_failed(session)
        if flipped:
            logger.info("Library upload janitor flipped %d stuck job(s)", flipped)
    except Exception:
        logger.exception("Library upload janitor failed (non-fatal)")

    logger.info("Samga.ai API started successfully")

    yield

    # Graceful shutdown: cancel background tasks and close connections
    logger.info("Shutting down Samga.ai API gracefully...")
    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    logger.info(f"Cancelling {len(pending)} pending background tasks...")

    if pending:
        for task in pending:
            task.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(*pending, return_exceptions=True),
                timeout=SHUTDOWN_TIMEOUT - 5,
            )
            logger.info("All background tasks finished")
        except TimeoutError:
            logger.warning(
                f"Shutdown timeout reached ({SHUTDOWN_TIMEOUT - 5}s), "
                f"some tasks may not have completed"
            )

    await engine.dispose()
    logger.info("Database connections closed")

    # Close cache backend through stable proxy object
    from .utils import cache as cache_module

    await cache_module.cache.close()
    logger.info("Cache backend closed")

    # v3.4 (2026-04-29): close all module-level httpx.AsyncClient
    # instances that registered themselves at import time. Previously
    # these leaked file descriptors on every restart. Audit finding #5.
    from .utils.http_client_registry import close_all_http_clients

    await close_all_http_clients()
    logger.info("HTTP clients closed")

    logger.info("Shutdown complete")


def create_app() -> FastAPI:

    app = FastAPI(
        title="Samga.ai API",
        description="UNT Strategic Guidance Platform API",
        version="4.0.0",
        lifespan=lifespan,
        docs_url="/docs" if os.getenv("DEBUG", "false").lower() == "true" else None,
        redoc_url="/redoc" if os.getenv("DEBUG", "false").lower() == "true" else None,
    )

    # opensamga round-4 (2026-05-15) audit: actually install the rate-limit
    # middleware + handler. Round-3 hardened the IP-extraction logic
    # (`get_client_ip` walks XFF only via TRUSTED_PROXIES) but never wired
    # `SlowAPIMiddleware` into the app — every `@limiter.limit(...)`
    # decorator was a no-op. Install order matters: SlowAPI middleware
    # must run AFTER CORS so preflight requests are never throttled — see
    # the `app.add_middleware(SlowAPIMiddleware)` call below the CORS
    # middleware block.
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        # Custom body; we reuse slowapi's Retry-After header propagation
        # via the standard `_rate_limit_exceeded_handler`, then override
        # the JSON body for UX consistency with the rest of the API.
        response = _rate_limit_exceeded_handler(request, exc)
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please try again later."},
            headers={"Retry-After": response.headers.get("Retry-After", "60")},
        )

    # CORS hardened per SEC-04 - no wildcards allowed
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    # TrustedHostMiddleware: reject requests with unexpected Host headers
    # (prevents Host header injection / cache poisoning). Dev default (empty list)
    # = disabled; configure ALLOWED_HOSTS env var in production.
    if settings.ALLOWED_HOSTS:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

    # HTTPS redirect (defense in depth; Caddy already terminates TLS in prod).
    if settings.FORCE_HTTPS:
        app.add_middleware(HTTPSRedirectMiddleware)

    # Compression middleware (SCALE-03, D-13)
    # Brotli preferred by modern browsers, GZip as fallback
    # minimum_size=500: don't compress tiny responses (overhead > savings)
    app.add_middleware(BrotliMiddleware, quality=4, minimum_size=500)
    app.add_middleware(GZipMiddleware, minimum_size=500)

    # opensamga round-4 (2026-05-15): install the slowapi middleware so
    # decorators take effect. Tests can disable via RATE_LIMIT_ENABLED=false.
    if os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false":
        app.add_middleware(SlowAPIMiddleware)

    @app.middleware("http")
    async def log_requests(request: Request, call_next: Callable) -> Response:
        """Log all requests with structured context."""
        return await log_requests_middleware(request, call_next)

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Callable) -> Response:
        """Add OWASP security headers to all responses."""
        if settings.SECURITY_HEADERS_ENABLED:
            return await security_headers_middleware(request, call_next)
        return await call_next(request)

    @app.middleware("http")
    async def static_cache_headers(request: Request, call_next: Callable) -> Response:
        """Add Cache-Control headers for static file responses (SCALE-03, D-11)."""
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            # Uploaded files may change; use 1-hour cache with revalidation
            response.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
        return response

    @app.middleware("http")
    async def enforce_onboarding_completion(request: Request, call_next: Callable) -> Response:
        """Block authenticated product APIs until registration context is complete."""
        path = request.url.path
        if (
            request.method == "OPTIONS"
            or not path.startswith("/api/")
            or _is_onboarding_allowed_path(path)
        ):
            return await call_next(request)

        token = _extract_request_token(request)
        if not token:
            return await call_next(request)

        email = _decode_token_email(token)
        if not email:
            return await call_next(request)

        onboarding_required = False
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(User).options(selectinload(User.profile)).where(User.email == email)
            )
            user = result.scalars().first()
            admin_emails = {
                item.strip().lower()
                for item in (os.environ.get("RAG_ADMIN_EMAILS", "") or "").split(",")
                if item.strip()
            }
            is_admin = bool(getattr(user, "is_admin", False)) or (email.lower() in admin_emails)
            onboarding_required = bool(
                user and not is_admin and not is_onboarding_completed(user.profile)
            )

        if onboarding_required:
            return JSONResponse(
                status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                content={
                    "detail": {
                        "code": "onboarding_required",
                        "message": (
                            "Complete onboarding before using the platform. "
                            "Платформаны қолдану үшін алдымен профильді толықтырыңыз."
                        ),
                        "redirect": "/dashboard/onboarding",
                    }
                },
            )

        return await call_next(request)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):

        # Log the path WITHOUT query string. Library + WS endpoints accept a
        # short-lived JWT in `?token=` (see app/routers/library.py); leaking
        # that to logs / Sentry breadcrumbs would be a credential disclosure.
        logger.error(
            "Unhandled exception at %s %s: %s",
            request.method,
            request.url.path,
            exc,
            exc_info=True,
        )

        if TELEMETRY_AVAILABLE and telemetry_client:
            try:
                await telemetry_client.capture_exception(
                    exc,
                    request_path=str(request.url.path),
                    request_method=request.method,
                    severity=SeverityLevel.HIGH,
                    context={"query_params": dict(request.query_params)},
                )
            except Exception as tel_err:
                logger.warning(f"Telemetry capture failed: {tel_err}")

        if os.getenv("DEBUG", "false").lower() == "true":
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal Server Error",
                    "error": str(exc),
                    "path": str(request.url.path),
                },
            )

        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

    # Health check endpoints (no /api prefix - follows Kubernetes convention)
    app.include_router(health.router, tags=["health"])

    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(chat_websocket.router, prefix="/api")  # WebSocket streaming
    app.include_router(data.router, prefix="/api")
    app.include_router(matching.router, prefix="/api")
    app.include_router(social.router, prefix="/api")
    app.include_router(rewards.router, prefix="/api")
    app.include_router(growth.router, prefix="/api")
    app.include_router(gamification.router, prefix="/api")
    app.include_router(analytics.router, prefix="/api")
    app.include_router(library.router, prefix="/api")
    app.include_router(mistakes.router, prefix="/api")
    app.include_router(strategy.router, prefix="/api")
    app.include_router(parent_report.router, prefix="/api")
    app.include_router(practice.router, prefix="/api")
    app.include_router(commuter.router, prefix="/api")
    app.include_router(exam.router, prefix="/api")

    app.include_router(billing.router, prefix="/api")
    app.include_router(billing.admin_router, prefix="/api")
    logger.info("Billing router mounted at /api/billing, /api/admin")

    # Session 15 (2026-04-21): chat thumbs-up/down feedback.
    app.include_router(feedback.router, prefix="/api")
    logger.info("Feedback router mounted at /api/feedback")

    app.include_router(opportunities.router)
    app.include_router(portfolio.router)
    app.include_router(admin.router)
    logger.info("Marketplace routers (opportunities, portfolio, admin) mounted")

    if TELEMETRY_AVAILABLE and telemetry_router:
        app.include_router(telemetry_router, prefix="/api")
        logger.info("Telemetry router mounted at /api/telemetry")

    # v3.3 (2026-04-29): the dev-console router exposes XP/streak/league/
    # mistakes mutations. Its in-router localhost guard parses the FIRST
    # value of `X-Forwarded-For`, which is attacker-supplied behind a
    # reverse proxy that doesn't strip XFF. Any user behind such a proxy
    # could mutate gamification state for `current_user`. We now refuse
    # to mount the router at all outside `ENVIRONMENT == "development"`,
    # so production deployments cannot ship the endpoints by accident.
    if settings.ENVIRONMENT == "development":
        app.include_router(dev_console.router, prefix="/api")
        logger.info("Dev console router mounted at /api/dev (development only)")
    else:
        logger.info("Dev console router NOT mounted (ENVIRONMENT=%s)", settings.ENVIRONMENT)

    uploads_path = Path(__file__).parent.parent / "uploads"
    if uploads_path.exists():
        app.mount("/static", StaticFiles(directory=str(uploads_path)), name="static")

    @app.get("/")
    async def root():
        """Root endpoint."""
        return {"message": "Samga.ai API is running", "version": "1.0.0"}

    return app


app = create_app()
