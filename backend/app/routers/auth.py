from datetime import UTC, datetime, timedelta

# Python 3.12+: datetime.utcnow() is deprecated. Use tz-aware
# datetime.now(UTC) everywhere. JWT libraries accept both naive and
# tz-aware datetimes, and the User.created_at column is
# DateTime(timezone=True), so tz-aware is the right choice.
_UTC = UTC


def _now_utc() -> datetime:
    return datetime.now(_UTC)


import logging
import os

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import get_settings
from ..database import get_db
from ..middleware.rate_limit import (
    LIMIT_AUTH_LOGIN,
    LIMIT_AUTH_REFRESH,
    LIMIT_AUTH_REGISTER,
    limiter,
)
from ..models import LanguagePreference, User

# v3.45 (2026-05-02): replaced four bare `print(f"ERROR …")` calls and
# one bare `except:` with a real module logger and `except Exception:`.
# The bare except in `get_current_user_optional` previously swallowed
# `KeyboardInterrupt` and `SystemExit` along with auth failures — a
# real-world hazard during graceful shutdown / Ctrl-C in dev. The
# `print` calls leaked exception strings to stdout instead of the
# standard logging pipeline that the rest of the routers use.
logger = logging.getLogger(__name__)

_settings = get_settings()
SECRET_KEY = _settings.SECRET_KEY.get_secret_value()
ALGORITHM = _settings.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = _settings.ACCESS_TOKEN_EXPIRE_MINUTES

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

router = APIRouter(prefix="/auth", tags=["auth"])


# Schemas
class Token(BaseModel):
    access_token: str
    token_type: str
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    language_preference: str | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Имя не может быть пустым")
        if len(v) > 120:
            raise ValueError("Имя слишком длинное (максимум 120 символов)")
        return v

    @staticmethod
    def validate_password_strength(password: str) -> None:
        if len(password) < 8:
            raise ValueError("Пароль должен содержать минимум 8 символов")
        # bcrypt 5.0.0 raises ValueError on passwords >72 bytes instead of
        # silently truncating (the 3.x/4.x behavior). Catch at validation
        # time so registration surfaces a clean 400, not a 500.
        if len(password.encode("utf-8")) > 72:
            raise ValueError("Пароль слишком длинный (максимум 72 байта)")
        if not any(c.isdigit() for c in password):
            raise ValueError("Пароль должен содержать хотя бы одну цифру")
        if not any(c.isalpha() for c in password):
            raise ValueError("Пароль должен содержать хотя бы одну букву")


class UserLogin(BaseModel):
    email: EmailStr
    password: str


def _normalize_language_preference(value: str | None) -> LanguagePreference:
    raw = (value or "").strip().lower()
    if raw.startswith(("kz", "kk")):
        return LanguagePreference.KZ
    if raw.startswith("en"):
        return LanguagePreference.EN
    return LanguagePreference.RU


# Utils
def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = _now_utc() + expires_delta
    else:
        expire = _now_utc() + timedelta(minutes=15)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict, expires_delta: timedelta | None = None):
    """Issue a longer-lived refresh token (JWT for now; DB-backed rotation is future work)."""
    to_encode = data.copy()
    days = _settings.REFRESH_TOKEN_EXPIRE_DAYS
    expire = _now_utc() + (expires_delta or timedelta(days=days))
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    """
    Get current authenticated user from JWT token.
    DEFENSIVE: Handles all edge cases to prevent silent 500 errors.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учетные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Step 1: Decode JWT token
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        # v3.3 (2026-04-29): explicitly reject refresh tokens here.
        # /refresh has always validated `type == "refresh"`, but every
        # other authenticated endpoint accepted ANY valid JWT — meaning
        # an intercepted 30-day refresh token doubled as a 24-hour
        # access token. Tokens minted before v3.3 may not carry a
        # `type` claim at all, so we accept missing for backward
        # compatibility and reject only the explicit "refresh" case.
        token_type = payload.get("type")
        if token_type == "refresh":
            raise credentials_exception
    except JWTError:
        # JWT decode failed - invalid/expired token. Use `from None`
        # to avoid chaining the JOSE internals into the auth response.
        raise credentials_exception from None
    except HTTPException:
        # Re-raise our own auth errors so they aren't masked by the
        # broad `Exception` catch below.
        raise
    except Exception as exc:
        # Any other error in JWT processing
        logger.exception("get_current_user: unexpected error during JWT decode")
        raise credentials_exception from exc

    # Step 2: Fetch user from database
    # DEFENSIVE: Try with selectinload first, fallback to simple query if it fails
    try:
        query = (
            select(User)
            .options(selectinload(User.profile), selectinload(User.gamification_profile))
            .where(User.email == email)
        )
        result = await db.execute(query)
        user = result.scalars().first()
    except Exception:
        # If selectinload fails (relationship not configured), try without it
        logger.warning(
            "get_current_user: selectinload failed, retrying with simple query",
            exc_info=True,
        )
        try:
            query = select(User).where(User.email == email)
            result = await db.execute(query)
            user = result.scalars().first()
        except Exception as exc:
            logger.exception("get_current_user: database query failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Ошибка базы данных при аутентификации",
            ) from exc

    if user is None:
        raise credentials_exception

    return user


async def get_current_user_optional(request: Request, db: AsyncSession = Depends(get_db)):
    """Get current user if token is provided, otherwise return None.

    v3.45: narrowed bare `except:` to `except Exception:` so that
    `KeyboardInterrupt` and `SystemExit` propagate during shutdown
    instead of silently returning `None` to the caller.
    """
    try:
        authorization = request.headers.get("Authorization")
        if not authorization or not authorization.startswith("Bearer "):
            return None
        token = authorization.split(" ")[1]
        return await get_current_user(token, db)
    except HTTPException:
        # Auth failure (401/403) — the optional path explicitly returns
        # None so anonymous callers fall through to the public branch.
        return None
    except Exception:
        # Anything else (DB error, decode error) — log and degrade to
        # anonymous; never poison KeyboardInterrupt / SystemExit.
        logger.warning(
            "get_current_user_optional: unexpected error, treating as anonymous",
            exc_info=True,
        )
        return None


# Session 19 (2026-04-21): shared admin gate. A user is considered an
# admin when:
#   1. `users.is_admin == TRUE` in the DB, OR
#   2. their email is in the `RAG_ADMIN_EMAILS` env var (comma-separated,
#      case-insensitive). This is a deliberate backdoor so ops can grant
#      access without shelling into the DB.
# The helper is defined here (not in routers/admin.py) because
# routers/analytics.py must not import routers/admin.py — that module
# has its own mountain of schemas and circular-import risk.
def _env_admin_emails() -> set[str]:
    raw = os.environ.get("RAG_ADMIN_EMAILS", "") or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


async def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require an authenticated admin. Raises 403 otherwise."""
    email = (current_user.email or "").lower()
    is_admin_flag = bool(getattr(current_user, "is_admin", False))
    if is_admin_flag or (email and email in _env_admin_emails()):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access required",
    )


# Endpoints
@router.post("/register", response_model=Token)
@limiter.limit(LIMIT_AUTH_REGISTER)
async def register(
    user_data: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        UserCreate.validate_password_strength(user_data.password)
    except ValueError as e:
        # ValueError messages from the validator are user-facing strings
        # ("password too short", etc.) and safe to surface verbatim.
        raise HTTPException(status_code=400, detail=str(e)) from e

    query = select(User).where(User.email == user_data.email)
    result = await db.execute(query)
    existing_user = result.scalars().first()

    if existing_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    hashed_pw = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        hashed_password=hashed_pw,
        name=user_data.name,
        language_preference=_normalize_language_preference(
            user_data.language_preference or request.headers.get("Accept-Language")
        ),
        created_at=_now_utc(),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    # Generate tokens (access + refresh)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_user.email}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": new_user.email})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
    }


@router.post("/token", response_model=Token)
@limiter.limit(LIMIT_AUTH_LOGIN)
async def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    # OAuth2PasswordRequestForm expects 'username' field, we use it for email
    query = select(User).where(User.email == form_data.username)
    result = await db.execute(query)
    user = result.scalars().first()

    is_valid = False
    if user:
        try:
            is_valid = verify_password(form_data.password, user.hashed_password)
        except Exception:
            is_valid = False

    if not user or not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)
    refresh_token = create_refresh_token(data={"sub": user.email})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
    }


@router.post("/login", response_model=Token)
@limiter.limit(LIMIT_AUTH_LOGIN)
async def login_json(
    request: Request,
    user_data: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    query = select(User).where(User.email == user_data.email)
    result = await db.execute(query)
    user = result.scalars().first()

    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)
    refresh_token = create_refresh_token(data={"sub": user.email})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
    }


@router.post("/refresh", response_model=Token)
@limiter.limit(LIMIT_AUTH_REFRESH)
async def refresh_access_token(
    request: Request,
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a refresh token for a new access token.

    MVP: stateless JWT-based, no rotation / no revocation list yet.
    Future: persist refresh tokens in DB, rotate on use, detect reuse.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный или просроченный refresh-токен",
    )
    try:
        decoded = jwt.decode(payload.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise credentials_exc from None

    if decoded.get("type") != "refresh":
        raise credentials_exc
    email = decoded.get("sub")
    if not email:
        raise credentials_exc

    user = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if not user:
        raise credentials_exc

    new_access = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    new_refresh = create_refresh_token(data={"sub": user.email})
    return {
        "access_token": new_access,
        "token_type": "bearer",
        "refresh_token": new_refresh,
    }
