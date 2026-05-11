"""
Notification Service - Email Digests & Alerts

Handles:
- Daily opportunity digest for students
- Application status notifications
- Poster alerts for new applications
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

# Optional SMTP library
try:
    import aiosmtplib

    SMTP_AVAILABLE = True
except ImportError:
    SMTP_AVAILABLE = False
    aiosmtplib = None

from jinja2 import Template
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import AsyncSessionLocal
from ..models import (
    ApplicationStatus,
    Opportunity,
    OpportunityApplication,
    OpportunityStatus,
    Portfolio,
    User,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@samga.ai")
FROM_NAME = os.getenv("FROM_NAME", "Samga.ai")


# =============================================================================
# EMAIL TEMPLATES
# =============================================================================

DIGEST_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { text-align: center; padding: 20px 0; border-bottom: 1px solid #27272a; }
        .logo { font-size: 24px; font-weight: bold; color: #818cf8; }
        .content { padding: 20px 0; }
        h2 { color: #fff; margin-bottom: 20px; }
        .opportunity-card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
        .opportunity-title { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 8px; }
        .opportunity-meta { font-size: 13px; color: #a1a1aa; margin-bottom: 8px; }
        .match-badge { display: inline-block; background: #312e81; color: #818cf8; font-size: 12px; padding: 4px 8px; border-radius: 6px; margin-right: 8px; }
        .skill-tag { display: inline-block; background: #27272a; color: #d4d4d8; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin: 2px; }
        .cta-button { display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; margin-top: 20px; }
        .cta-button:hover { background: #4338ca; }
        .footer { text-align: center; padding: 20px 0; border-top: 1px solid #27272a; font-size: 12px; color: #71717a; }
        .unsubscribe { color: #71717a; text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🎓 Samga.ai</div>
        </div>

        <div class="content">
            <h2>{{ greeting }}, {{ user_name }}!</h2>
            <p style="color: #a1a1aa; margin-bottom: 24px;">{{ intro_text }}</p>

            {% for opp in opportunities %}
            <div class="opportunity-card">
                <div class="opportunity-title">{{ opp.title }}</div>
                <div class="opportunity-meta">
                    📍 {{ opp.location }}
                    {% if opp.is_remote %}• 🏠 Удаленно{% endif %}
                    {% if opp.is_paid %}• 💰 Оплачивается{% endif %}
                </div>
                {% if opp.match_score %}
                <span class="match-badge">{{ opp.match_score }}% совпадение</span>
                {% endif %}
                <span class="match-badge">{{ opp.type_label }}</span>
                <div style="margin-top: 8px;">
                    {% for skill in opp.skills[:4] %}
                    <span class="skill-tag">{{ skill }}</span>
                    {% endfor %}
                </div>
            </div>
            {% endfor %}

            <a href="{{ cta_url }}" class="cta-button">{{ cta_text }}</a>
        </div>

        <div class="footer">
            <p>© 2024 Samga.ai — Платформа для студентов Казахстана</p>
            <p><a href="{{ unsubscribe_url }}" class="unsubscribe">Отписаться от рассылки</a></p>
        </div>
    </div>
</body>
</html>
"""

APPLICATION_STATUS_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { text-align: center; padding: 20px 0; border-bottom: 1px solid #27272a; }
        .logo { font-size: 24px; font-weight: bold; color: #818cf8; }
        .content { padding: 20px 0; }
        .status-card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; margin: 20px 0; }
        .status-badge { display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 500; margin-bottom: 12px; }
        .status-viewed { background: #1e3a8a; color: #93c5fd; }
        .status-shortlisted { background: #14532d; color: #86efac; }
        .status-offered { background: #713f12; color: #fde047; }
        .status-rejected { background: #450a0a; color: #fca5a5; }
        .cta-button { display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; margin-top: 20px; }
        .footer { text-align: center; padding: 20px 0; border-top: 1px solid #27272a; font-size: 12px; color: #71717a; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🎓 Samga.ai</div>
        </div>

        <div class="content">
            <h2>{{ greeting }}, {{ user_name }}!</h2>
            <p style="color: #a1a1aa;">{{ message }}</p>

            <div class="status-card">
                <span class="status-badge status-{{ status_class }}">{{ status_label }}</span>
                <h3 style="color: #fff; margin: 0 0 8px 0;">{{ opportunity_title }}</h3>
                <p style="color: #a1a1aa; margin: 0;">{{ company_name }}</p>
            </div>

            {% if next_steps %}
            <h3 style="color: #fff;">Следующие шаги:</h3>
            <p style="color: #a1a1aa;">{{ next_steps }}</p>
            {% endif %}

            <a href="{{ cta_url }}" class="cta-button">{{ cta_text }}</a>
        </div>

        <div class="footer">
            <p>© 2024 Samga.ai — Платформа для студентов Казахстана</p>
        </div>
    </div>
</body>
</html>
"""


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class OpportunityDigestItem:
    id: int
    title: str
    location: str
    is_remote: bool
    is_paid: bool
    type_label: str
    skills: list[str]
    match_score: int | None = None


@dataclass
class EmailPayload:
    to_email: str
    to_name: str
    subject: str
    html_content: str


# =============================================================================
# EMAIL SENDING
# =============================================================================


async def send_email(payload: EmailPayload) -> bool:
    """Send email via SMTP."""
    if not SMTP_AVAILABLE or not SMTP_USER or not SMTP_PASSWORD:
        logger.info(
            "[DRY RUN] Would send to %s: %s",
            payload.to_email,
            payload.subject,
        )
        return True

    try:
        message = MIMEMultipart("alternative")
        message["Subject"] = payload.subject
        message["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
        message["To"] = payload.to_email

        html_part = MIMEText(payload.html_content, "html")
        message.attach(html_part)

        await aiosmtplib.send(
            message,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER,
            password=SMTP_PASSWORD,
            start_tls=True,
        )

        return True
    except Exception:
        logger.exception("Email send failed to %s", payload.to_email)
        return False


async def send_batch_emails(payloads: list[EmailPayload], delay_ms: int = 100) -> int:
    """Send multiple emails with rate limiting."""
    sent = 0
    for payload in payloads:
        if await send_email(payload):
            sent += 1
        await asyncio.sleep(delay_ms / 1000)
    return sent


# =============================================================================
# NOTIFICATION SERVICE
# =============================================================================


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def send_daily_digest(self, user_id: int) -> bool:
        """Send daily opportunity digest to a specific user."""
        # Get user and portfolio
        user_query = select(User).where(User.id == user_id)
        user_result = await self.db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user or not user.email:
            return False

        portfolio_query = select(Portfolio).where(Portfolio.user_id == user_id)
        portfolio_result = await self.db.execute(portfolio_query)
        portfolio = portfolio_result.scalar_one_or_none()

        # Get matched opportunities (simplified - in production use embeddings)
        opps_query = (
            select(Opportunity)
            .where(
                Opportunity.status == OpportunityStatus.ACTIVE,
                Opportunity.created_at >= datetime.now(UTC) - timedelta(days=7),
            )
            .order_by(Opportunity.is_featured.desc(), Opportunity.created_at.desc())
            .limit(5)
        )

        opps_result = await self.db.execute(opps_query)
        opportunities = opps_result.scalars().all()

        if not opportunities:
            return False

        # Build digest items
        type_labels = {
            "INTERNSHIP": "Стажировка",
            "PROJECT": "Проект",
            "COFOUNDER": "Кофаундер",
            "HACKATHON": "Хакатон",
            "MENTORSHIP": "Менторство",
            "RESEARCH": "Исследование",
            "PART_TIME": "Частичная занятость",
            "FULL_TIME": "Полная занятость",
            "CLUB": "Клуб",
        }

        digest_items = [
            {
                "title": opp.title,
                "location": opp.location,
                "is_remote": opp.is_remote,
                "is_paid": opp.is_paid,
                "type_label": type_labels.get(opp.opportunity_type.value, "Возможность"),
                "skills": opp.required_skills or [],
                "match_score": 85 if portfolio else None,  # Placeholder
            }
            for opp in opportunities
        ]

        # Render template
        template = Template(DIGEST_TEMPLATE)
        html_content = template.render(
            greeting="Привет",
            user_name=user.name or "студент",
            intro_text=f"За последнюю неделю появилось {len(opportunities)} новых возможностей, которые могут тебе подойти:",
            opportunities=digest_items,
            cta_url="https://samga.ai/opportunities",
            cta_text="Смотреть все возможности",
            unsubscribe_url="https://samga.ai/settings/notifications",
        )

        # Send email
        return await send_email(
            EmailPayload(
                to_email=user.email,
                to_name=user.name or "Student",
                subject="🎯 Новые возможности для тебя — Samga.ai",
                html_content=html_content,
            )
        )

    async def send_application_status_update(
        self,
        application_id: int,
        new_status: ApplicationStatus,
    ) -> bool:
        """Notify applicant about status change."""
        # Get application with relationships
        app_query = (
            select(OpportunityApplication)
            .options(
                joinedload(OpportunityApplication.applicant),
                joinedload(OpportunityApplication.opportunity),
            )
            .where(OpportunityApplication.id == application_id)
        )

        app_result = await self.db.execute(app_query)
        application = app_result.scalar_one_or_none()

        if not application or not application.applicant.email:
            return False

        # Status-specific content
        status_config = {
            ApplicationStatus.VIEWED: {
                "label": "Заявка просмотрена",
                "class": "viewed",
                "message": "Работодатель просмотрел твою заявку!",
                "next_steps": "Ожидай ответа. Если твой профиль заинтересует, тебя пригласят на следующий этап.",
            },
            ApplicationStatus.SHORTLISTED: {
                "label": "В шорт-листе",
                "class": "shortlisted",
                "message": "Отличные новости! Ты в шорт-листе кандидатов!",
                "next_steps": "Работодатель рассматривает твою кандидатуру для интервью.",
            },
            ApplicationStatus.INTERVIEW_SCHEDULED: {
                "label": "Интервью назначено",
                "class": "shortlisted",
                "message": "Поздравляем! Тебя пригласили на интервью!",
                "next_steps": "Проверь свою почту для деталей о времени и формате интервью.",
            },
            ApplicationStatus.OFFERED: {
                "label": "Оффер получен! 🎉",
                "class": "offered",
                "message": "Поздравляем! Тебе сделали оффер!",
                "next_steps": "Зайди в приложение, чтобы принять или отклонить предложение.",
            },
            ApplicationStatus.DECLINED_BY_POSTER: {
                "label": "Отклонено",
                "class": "rejected",
                "message": "К сожалению, работодатель выбрал другого кандидата.",
                "next_steps": "Не расстраивайся! Продолжай откликаться на другие возможности.",
            },
        }

        config = status_config.get(new_status)
        if not config:
            return False

        # Render template
        template = Template(APPLICATION_STATUS_TEMPLATE)
        html_content = template.render(
            greeting="Привет",
            user_name=application.applicant.name or "студент",
            message=config["message"],
            status_label=config["label"],
            status_class=config["class"],
            opportunity_title=application.opportunity.title,
            company_name="",  # TODO: Add company from opportunity
            next_steps=config["next_steps"],
            cta_url=f"https://samga.ai/opportunities/{application.opportunity_id}",
            cta_text="Открыть заявку",
        )

        # Send email
        return await send_email(
            EmailPayload(
                to_email=application.applicant.email,
                to_name=application.applicant.name or "Student",
                subject=f"📬 {config['label']} — {application.opportunity.title}",
                html_content=html_content,
            )
        )

    async def send_new_application_alert(self, application_id: int) -> bool:
        """Notify poster about new application."""
        # Get application with relationships
        app_query = (
            select(OpportunityApplication)
            .options(
                joinedload(OpportunityApplication.applicant),
                joinedload(OpportunityApplication.opportunity),
            )
            .where(OpportunityApplication.id == application_id)
        )

        app_result = await self.db.execute(app_query)
        application = app_result.scalar_one_or_none()

        if not application:
            return False

        # Get poster
        poster_query = select(User).where(User.id == application.opportunity.poster_id)
        poster_result = await self.db.execute(poster_query)
        poster = poster_result.scalar_one_or_none()

        if not poster or not poster.email:
            return False

        # Simple text email for posters
        subject = f"📥 Новая заявка на «{application.opportunity.title}»"

        html_content = f"""
        <html>
        <body style="font-family: sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 20px;">
            <h2>Новая заявка!</h2>
            <p><strong>{application.applicant.name or "Студент"}</strong> откликнулся на вашу вакансию «{application.opportunity.title}»</p>
            <p>Всего заявок: {application.opportunity.application_count}</p>
            <a href="https://samga.ai/my/opportunities/{application.opportunity_id}/applications"
               style="display: inline-block; background: #4f46e5; color: #fff; padding: 12px 24px;
                      border-radius: 8px; text-decoration: none; margin-top: 16px;">
                Просмотреть заявки
            </a>
        </body>
        </html>
        """

        return await send_email(
            EmailPayload(
                to_email=poster.email,
                to_name=poster.name or "Poster",
                subject=subject,
                html_content=html_content,
            )
        )


# =============================================================================
# BATCH DIGEST JOB (for cron)
# =============================================================================


async def run_daily_digest_job():
    """
    Run daily digest for all eligible users.

    Should be called by a cron job daily at appropriate time.
    Example: 0 9 * * * python -c "from app.services.notifications import run_daily_digest_job; import asyncio; asyncio.run(run_daily_digest_job())"
    """
    logger.info(
        "Daily digest job started | run_at=%s",
        datetime.now(UTC).isoformat(),
    )

    async with AsyncSessionLocal() as db:
        # Get users with portfolios who haven't received digest today
        # In production, add digest_sent_at tracking
        query = (
            select(User)
            .join(Portfolio)
            .where(
                User.email.isnot(None),
            )
            .limit(100)
        )  # Batch limit

        result = await db.execute(query)
        users = result.scalars().all()

        logger.info("Daily digest: found %d users to notify", len(users))

        notification_service = NotificationService(db)
        sent = 0

        for user in users:
            try:
                if await notification_service.send_daily_digest(user.id):
                    sent += 1
                    logger.debug("Daily digest sent to %s", user.email)
                await asyncio.sleep(0.1)  # Rate limiting
            except Exception:
                # Per-user failure: don't take down the whole digest run.
                # logger.exception attaches the stack so the operator can
                # tell the difference between an SMTP-side failure and a
                # template/serialization bug.
                logger.exception(
                    "Daily digest failed for user_id=%s email=%s",
                    user.id,
                    user.email,
                )

        logger.info("Daily digest job complete | sent=%d/%d", sent, len(users))
