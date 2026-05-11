import time
import uuid
from contextvars import ContextVar

from fastapi import Request
from jose import JWTError, jwt

from ..config import settings
from ..logging_config import get_logger

logger = get_logger("middleware.logging")

# Async-safe request ID storage
request_id_var: ContextVar[str] = ContextVar("request_id", default=None)


async def log_requests_middleware(request: Request, call_next):
    """Log requests with structured context including request ID, timing, and error details."""

    # Generate unique request ID
    request_id = str(uuid.uuid4())
    request_id_var.set(request_id)

    # Extract client IP
    client_ip = request.client.host if request.client else "unknown"

    # Extract user from JWT token if present
    user_identifier = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(
                token, settings.SECRET_KEY.get_secret_value(), algorithms=[settings.ALGORITHM]
            )
            user_identifier = payload.get("sub")
        except JWTError:
            pass

    # Log request start
    start_time = time.time()
    logger.info(
        f"Request started: {request.method} {request.url.path}",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": client_ip,
            "user_id": user_identifier,
        },
    )

    try:
        # Process request
        response = await call_next(request)

        # Calculate duration
        duration_ms = (time.time() - start_time) * 1000

        # Log successful completion
        logger.info(
            f"Request completed: {request.method} {request.url.path}",
            extra={
                "request_id": request_id,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
                "user_id": user_identifier,
            },
        )

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        return response

    except Exception as exc:
        # Calculate duration even on error
        duration_ms = (time.time() - start_time) * 1000

        # Log error with full context
        logger.error(
            f"Request failed: {request.method} {request.url.path}",
            extra={
                "request_id": request_id,
                "error_type": type(exc).__name__,
                "error_message": str(exc),
                "duration_ms": round(duration_ms, 2),
                "user_id": user_identifier,
            },
            exc_info=True,
        )

        # Re-raise to let global exception handler process it
        raise
