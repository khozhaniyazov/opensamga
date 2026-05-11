"""
Telemetry Service - Event-Driven Architecture Core

This service handles event emission, storage, and basic analytics queries.
All user actions should emit events through this service.
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TelemetryEvent


class TelemetryService:
    """
    Core telemetry service for event tracking.

    Usage:
        telemetry = TelemetryService(db)
        await telemetry.track("opportunity.viewed", user_id=1, properties={"opportunity_id": 123})
    """

    # Core event types for the Student SuperApp
    EVENT_TYPES = {
        # User lifecycle
        "user.registered": "User completed registration",
        "user.logged_in": "User logged in",
        "user.profile_updated": "User updated their profile",
        # Portfolio events
        "portfolio.created": "Portfolio was created",
        "portfolio.updated": "Portfolio was updated",
        "portfolio.skills_added": "User added skills to portfolio",
        "portfolio.project_added": "User added a project to portfolio",
        "portfolio.linkedin_connected": "User connected LinkedIn",
        "portfolio.github_connected": "User connected GitHub",
        "portfolio.completeness_changed": "Portfolio completeness score changed",
        # Opportunity events
        "opportunity.created": "Opportunity was created",
        "opportunity.published": "Opportunity was published",
        "opportunity.viewed": "Opportunity was viewed by a student",
        "opportunity.saved": "Opportunity was saved/bookmarked",
        "opportunity.shared": "Opportunity was shared",
        # Application events
        "application.started": "Application was started (draft)",
        "application.submitted": "Application was submitted",
        "application.viewed_by_poster": "Application was viewed by poster",
        "application.shortlisted": "Application was shortlisted",
        "application.offered": "Offer was extended",
        "application.accepted": "Offer was accepted",
        "application.declined": "Application/offer was declined",
        "application.withdrawn": "Application was withdrawn",
        # Matching events
        "match.suggested": "Match was suggested to user",
        "match.clicked": "User clicked on a suggested match",
        # Verification events
        "verification.started": "Verification process started",
        "verification.completed": "Verification completed",
        "verification.failed": "Verification failed",
        # Trust/safety events
        "report.submitted": "Report was submitted",
        "report.resolved": "Report was resolved",
        # Engagement events
        "session.started": "Session started",
        "page.viewed": "Page was viewed",
        "feature.used": "Feature was used",
    }

    def __init__(self, db: AsyncSession):
        self.db = db

    async def track(
        self,
        event_type: str,
        user_id: int | None = None,
        properties: dict[str, Any] | None = None,
        request: Request | None = None,
        session_id: str | None = None,
        experiment_id: str | None = None,
        variant: str | None = None,
    ) -> TelemetryEvent:
        """
        Track an event.

        Args:
            event_type: Type of event (e.g., 'opportunity.viewed')
            user_id: User who triggered the event (optional for anonymous)
            properties: Event-specific data
            request: FastAPI request for context extraction
            session_id: Session identifier
            experiment_id: A/B test experiment ID
            variant: A/B test variant
        """
        # Extract context from request if provided
        source = None
        page_url = None
        referrer = None
        user_agent = None
        ip_address = None

        if request:
            source = "web"
            page_url = str(request.url) if request.url else None
            referrer = request.headers.get("referer")
            user_agent = request.headers.get("user-agent")
            # Get IP from X-Forwarded-For or client host
            ip_address = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            if not ip_address:
                ip_address = request.client.host if request.client else None

        # Generate session ID if not provided
        if not session_id and request:
            session_id = request.cookies.get("session_id")

        event = TelemetryEvent(
            event_type=event_type,
            user_id=user_id,
            session_id=session_id,
            properties=properties or {},
            source=source,
            page_url=page_url,
            referrer=referrer,
            user_agent=user_agent,
            ip_address=ip_address,
            experiment_id=experiment_id,
            variant=variant,
            timestamp=datetime.now(UTC),
        )

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def track_batch(
        self,
        events: list[dict[str, Any]],
    ) -> list[TelemetryEvent]:
        """
        Track multiple events in a single transaction.

        Args:
            events: List of event dictionaries with keys:
                    - event_type (required)
                    - user_id (optional)
                    - properties (optional)
                    - session_id (optional)
        """
        telemetry_events = []

        for event_data in events:
            event = TelemetryEvent(
                event_type=event_data["event_type"],
                user_id=event_data.get("user_id"),
                session_id=event_data.get("session_id"),
                properties=event_data.get("properties", {}),
                timestamp=datetime.now(UTC),
            )
            self.db.add(event)
            telemetry_events.append(event)

        await self.db.commit()
        return telemetry_events

    # =========================================================================
    # ANALYTICS QUERIES
    # =========================================================================

    async def get_event_count(
        self,
        event_type: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        user_id: int | None = None,
    ) -> int:
        """Get count of events matching criteria."""
        query = select(func.count(TelemetryEvent.id)).where(TelemetryEvent.event_type == event_type)

        if start_date:
            query = query.where(TelemetryEvent.timestamp >= start_date)
        if end_date:
            query = query.where(TelemetryEvent.timestamp <= end_date)
        if user_id:
            query = query.where(TelemetryEvent.user_id == user_id)

        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_unique_users(
        self,
        event_type: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> int:
        """Get count of unique users who triggered an event."""
        query = select(func.count(func.distinct(TelemetryEvent.user_id))).where(
            TelemetryEvent.event_type == event_type,
            TelemetryEvent.user_id.isnot(None),
        )

        if start_date:
            query = query.where(TelemetryEvent.timestamp >= start_date)
        if end_date:
            query = query.where(TelemetryEvent.timestamp <= end_date)

        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_funnel_conversion(
        self,
        step_events: list[str],
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> dict[str, Any]:
        """
        Calculate funnel conversion between sequential event types.

        Args:
            step_events: List of event types in funnel order
                         e.g., ['opportunity.viewed', 'application.started', 'application.submitted']

        Returns:
            Dict with step counts and conversion rates
        """
        results = {
            "steps": [],
            "overall_conversion": 0.0,
        }

        for i, event_type in enumerate(step_events):
            count = await self.get_unique_users(event_type, start_date, end_date)
            step_data = {
                "event_type": event_type,
                "unique_users": count,
            }

            if i > 0 and results["steps"][i - 1]["unique_users"] > 0:
                step_data["conversion_rate"] = count / results["steps"][i - 1]["unique_users"]
            else:
                step_data["conversion_rate"] = 1.0 if i == 0 else 0.0

            results["steps"].append(step_data)

        # Calculate overall conversion
        if len(results["steps"]) >= 2 and results["steps"][0]["unique_users"] > 0:
            results["overall_conversion"] = (
                results["steps"][-1]["unique_users"] / results["steps"][0]["unique_users"]
            )

        return results

    async def get_retention(
        self,
        cohort_event: str,
        return_event: str,
        cohort_date: datetime,
        day: int = 7,
    ) -> dict[str, Any]:
        """
        Calculate D{day} retention for a cohort.

        Args:
            cohort_event: Event that defines the cohort (e.g., 'user.registered')
            return_event: Event that indicates return (e.g., 'session.started')
            cohort_date: Date of cohort creation
            day: Day to measure retention (default D7)
        """
        # Get users in cohort
        cohort_query = select(func.distinct(TelemetryEvent.user_id)).where(
            TelemetryEvent.event_type == cohort_event,
            TelemetryEvent.timestamp >= cohort_date,
            TelemetryEvent.timestamp < cohort_date + timedelta(days=1),
            TelemetryEvent.user_id.isnot(None),
        )
        cohort_result = await self.db.execute(cohort_query)
        cohort_users = set(row[0] for row in cohort_result.fetchall())

        if not cohort_users:
            return {"cohort_size": 0, "retained": 0, "retention_rate": 0.0}

        # Get users who returned on day N
        return_date = cohort_date + timedelta(days=day)
        return_query = select(func.distinct(TelemetryEvent.user_id)).where(
            TelemetryEvent.event_type == return_event,
            TelemetryEvent.timestamp >= return_date,
            TelemetryEvent.timestamp < return_date + timedelta(days=1),
            TelemetryEvent.user_id.in_(cohort_users),
        )
        return_result = await self.db.execute(return_query)
        returned_users = set(row[0] for row in return_result.fetchall())

        return {
            "cohort_size": len(cohort_users),
            "retained": len(returned_users),
            "retention_rate": len(returned_users) / len(cohort_users) if cohort_users else 0.0,
            "day": day,
        }

    async def get_user_journey(
        self,
        user_id: int,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get chronological event journey for a user."""
        query = (
            select(TelemetryEvent)
            .where(TelemetryEvent.user_id == user_id)
            .order_by(TelemetryEvent.timestamp.desc())
            .limit(limit)
        )

        result = await self.db.execute(query)
        events = result.scalars().all()

        return [
            {
                "event_type": e.event_type,
                "properties": e.properties,
                "timestamp": e.timestamp.isoformat(),
                "source": e.source,
            }
            for e in events
        ]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def generate_session_id() -> str:
    """Generate a unique session ID."""
    return str(uuid.uuid4())


def hash_ip(ip_address: str) -> str:
    """Hash IP address for privacy-preserving storage."""
    return hashlib.sha256(ip_address.encode()).hexdigest()[:16]


# =============================================================================
# MIDDLEWARE FOR AUTOMATIC TRACKING
# =============================================================================


class TelemetryMiddleware:
    """
    FastAPI middleware for automatic page view tracking.

    Usage:
        app.add_middleware(TelemetryMiddleware, db_session_factory=get_db)
    """

    EXCLUDED_PATHS = {
        "/health",
        "/api/docs",
        "/api/openapi.json",
        "/favicon.ico",
        "/static",
    }

    def __init__(self, app, db_session_factory):
        self.app = app
        self.db_session_factory = db_session_factory

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Skip excluded paths
        path = scope.get("path", "")
        if any(path.startswith(excluded) for excluded in self.EXCLUDED_PATHS):
            await self.app(scope, receive, send)
            return

        # Track page view (non-blocking, fire-and-forget)
        # In production, use a background task queue like Celery or RQ

        await self.app(scope, receive, send)
