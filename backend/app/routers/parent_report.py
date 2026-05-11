"""
parent_report.py — v3.27 router (Issue #15 AC#5).

Endpoints:
    POST /api/parent-report/tokens          (auth) → mint a share token
    GET  /api/parent-report/tokens          (auth) → list student's tokens
    DELETE /api/parent-report/tokens/{id}   (auth) → revoke a token
    GET  /api/parent-report/view/{token}    (no auth) → JSON payload
    GET  /api/parent-report/view/{token}.html  (no auth) → printable HTML
    GET  /api/parent-report/view/{token}.pdf   (no auth) → branded PDF

The parent-facing routes are intentionally unauthenticated; the token
itself is the credential. Each successful read bumps
``last_accessed_at`` + ``access_count`` for ops audit.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ParentReportShareToken, User
from ..services.parent_report import (
    PARENT_REPORT_DEFAULT_TTL_DAYS,
    PARENT_REPORT_MAX_TTL_DAYS,
    build_parent_report_payload,
    lookup_active_token,
    mint_parent_report_token,
    revoke_parent_report_token,
)
from .auth import get_current_user

router = APIRouter(prefix="/parent-report", tags=["parent-report"])


# ──────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ──────────────────────────────────────────────────────────────────────────


class _TokenSummary(BaseModel):
    id: int
    token: str
    expires_at: datetime
    is_revoked: bool
    created_at: datetime | None
    last_accessed_at: datetime | None
    access_count: int


class MintTokenRequest(BaseModel):
    ttl_days: int | None = None


class MintTokenResponse(_TokenSummary):
    pass


class TokenListResponse(BaseModel):
    items: list[_TokenSummary]


# ──────────────────────────────────────────────────────────────────────────
# Authenticated endpoints (student manages their own share tokens)
# ──────────────────────────────────────────────────────────────────────────


@router.post("/tokens", response_model=MintTokenResponse, status_code=status.HTTP_201_CREATED)
async def mint_token(
    body: MintTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a new tokenized share link for the current student.

    ``ttl_days`` is clamped to ``[1, PARENT_REPORT_MAX_TTL_DAYS]``;
    None falls back to the default 30-day window.
    """

    row = await mint_parent_report_token(db=db, user=current_user, ttl_days=body.ttl_days)
    return _row_to_summary(row)


@router.get("/tokens", response_model=TokenListResponse)
async def list_tokens(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the current student's share tokens (active + historical)."""

    rows = (
        (
            await db.execute(
                select(ParentReportShareToken)
                .where(ParentReportShareToken.user_id == current_user.id)
                .order_by(desc(ParentReportShareToken.created_at))
            )
        )
        .scalars()
        .all()
    )
    return TokenListResponse(items=[_row_to_summary(r) for r in rows])


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ok = await revoke_parent_report_token(db=db, user=current_user, token_id=token_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="token_not_found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ──────────────────────────────────────────────────────────────────────────
# Parent-facing endpoints (token-only, no auth)
# ──────────────────────────────────────────────────────────────────────────


async def _resolve_token_to_user(
    *, db: AsyncSession, token: str
) -> tuple[ParentReportShareToken, User]:
    """Return ``(share_token_row, owner_user)`` for an active token, else 404."""

    share_row = await lookup_active_token(db=db, token=token)
    if share_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="token_not_found_or_expired"
        )
    user_row = (
        (await db.execute(select(User).where(User.id == share_row.user_id))).scalars().first()
    )
    if user_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
    # Audit bookkeeping. We commit on the route-level db session so
    # the bump persists alongside the response.
    share_row.last_accessed_at = datetime.now(UTC)
    share_row.access_count = (share_row.access_count or 0) + 1
    await db.commit()
    return share_row, user_row


@router.get("/view/{token}", status_code=status.HTTP_200_OK)
async def view_payload(
    token: str,
    lang: str = Query("ru", description="Language: ru or kz"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the sanitized JSON payload for the parent UI to render."""

    _, user = await _resolve_token_to_user(db=db, token=token)
    return await build_parent_report_payload(db=db, user=user, language=lang)


@router.get("/view/{token}.html", response_class=HTMLResponse)
async def view_html(
    token: str,
    lang: str = Query("ru"),
    db: AsyncSession = Depends(get_db),
):
    """Render the parent report as printable HTML."""

    # Lazy import — see docstring on parent_report_pdf.
    from ..services.parent_report_pdf import render_parent_report_html

    _, user = await _resolve_token_to_user(db=db, token=token)
    payload = await build_parent_report_payload(db=db, user=user, language=lang)
    return HTMLResponse(content=render_parent_report_html(payload))


@router.get("/view/{token}.pdf")
async def view_pdf(
    token: str,
    lang: str = Query("ru"),
    db: AsyncSession = Depends(get_db),
):
    """Render the parent report as branded PDF via WeasyPrint."""

    from ..services.parent_report_pdf import render_parent_report_pdf

    _, user = await _resolve_token_to_user(db=db, token=token)
    payload = await build_parent_report_payload(db=db, user=user, language=lang)
    try:
        pdf_bytes = render_parent_report_pdf(payload)
    except Exception as exc:  # pragma: no cover - infra-dependent
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"pdf_renderer_unavailable: {exc}",
        ) from exc
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (f'inline; filename="samga-parent-report-{user.id}.pdf"'),
        },
    )


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _row_to_summary(row: ParentReportShareToken) -> _TokenSummary:
    return _TokenSummary(
        id=row.id,
        token=row.token,
        expires_at=row.expires_at,
        is_revoked=bool(row.is_revoked),
        created_at=row.created_at,
        last_accessed_at=row.last_accessed_at,
        access_count=int(row.access_count or 0),
    )


# Re-export TTL constants so tests / docs can pin them without importing
# the service.
__all__ = [
    "router",
    "MintTokenRequest",
    "MintTokenResponse",
    "TokenListResponse",
    "PARENT_REPORT_DEFAULT_TTL_DAYS",
    "PARENT_REPORT_MAX_TTL_DAYS",
]
