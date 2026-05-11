from collections.abc import Callable

from fastapi import Request, Response

from ..config import get_settings

# Paths that must be framable by the same-origin frontend (e.g. PDF reader
# in `<iframe>`). DENY breaks the library PDF viewer (BUG #1, 2026-04-24),
# so we relax to SAMEORIGIN for this allowlist only. Same-origin framing
# does not permit third-party clickjacking, so this is still safe.
_SAMEORIGIN_FRAME_PREFIXES = (
    "/api/library/books/",  # /pdf, /pages/*/thumbnail
)


def _should_allow_sameorigin_frame(path: str) -> bool:
    return any(path.startswith(p) for p in _SAMEORIGIN_FRAME_PREFIXES)


async def security_headers_middleware(request: Request, call_next: Callable) -> Response:
    """Add OWASP baseline security headers to all responses."""
    settings = get_settings()
    response = await call_next(request)

    # CSP: Block inline scripts, allow only trusted sources.
    # Library PDF streaming needs frame-ancestors 'self' so the
    # same-origin iframe viewer can embed it.
    csp = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self' data:; "
        "connect-src 'self'"
    )
    if _should_allow_sameorigin_frame(request.url.path):
        csp += "; frame-ancestors 'self'"
    response.headers["Content-Security-Policy"] = csp

    # HSTS: Enforce HTTPS in production only
    if settings.ENVIRONMENT == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # Prevent clickjacking. DENY is the default; the library PDF endpoints
    # need SAMEORIGIN so the in-app iframe viewer works.
    if _should_allow_sameorigin_frame(request.url.path):
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
    else:
        response.headers["X-Frame-Options"] = "DENY"

    # Prevent MIME-sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"

    # XSS protection
    response.headers["X-XSS-Protection"] = "1; mode=block"

    # Referrer policy
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # Permissions-Policy: explicitly deny powerful APIs we don't use.
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    )

    # Cross-Origin isolation for defense in depth.
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"

    return response
