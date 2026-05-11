"""
Sentry SDK initialization and sensitive data filtering.

Integrates Sentry for error tracking and performance monitoring
with FastAPI, SQLAlchemy, and asyncio integrations.
"""

import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from ..logging_config import get_logger

logger = get_logger("sentry")

# Headers whose values must never be sent to Sentry
_SENSITIVE_HEADERS = {"authorization", "cookie", "x-api-key"}

# Query string parameter names that trigger full query redaction
_SENSITIVE_QUERY_PARAMS = {"token", "key"}


def filter_sensitive_data(event, hint):
    """Strip sensitive values from Sentry events before transmission.

    Masks Authorization, Cookie, and X-API-Key headers.
    Redacts entire query string if it contains 'token' or 'key' params.
    """
    request = event.get("request")
    if not request:
        return event

    # Mask sensitive headers
    headers = request.get("headers")
    if headers:
        for header_name in list(headers.keys()):
            if header_name.lower() in _SENSITIVE_HEADERS:
                headers[header_name] = "[Filtered]"

    # Redact query string containing sensitive param names
    query_string = request.get("query_string")
    if query_string:
        qs_lower = query_string.lower()
        for param in _SENSITIVE_QUERY_PARAMS:
            if param in qs_lower:
                request["query_string"] = "[Filtered]"
                break

    return event


def init_sentry(settings):
    """Initialize Sentry SDK with FastAPI, SQLAlchemy, and asyncio integrations.

    Does nothing if settings.SENTRY_DSN is empty — the application
    runs normally without Sentry when the DSN is not configured.
    """
    if not settings.SENTRY_DSN:
        logger.info("Sentry not configured (SENTRY_DSN not set), skipping initialization")
        return

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            AsyncioIntegration(),
        ],
        before_send=filter_sensitive_data,
        enable_tracing=True,
    )

    logger.info(f"Sentry initialized for environment: {settings.SENTRY_ENVIRONMENT}")
