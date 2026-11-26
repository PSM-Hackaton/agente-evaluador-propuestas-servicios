"""FastAPI dependencies for authentication (Bearer header + SSE/download query token) and RBAC."""

from __future__ import annotations

import secrets
import time
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import UserRole, decode_token
from app.db.base import get_db
from app.db.models import User

bearer_scheme = HTTPBearer(auto_error=False)

# Single-use opaque tickets for SSE EventSource / file downloads without placing JWT in URLs
_STREAM_TICKETS: dict[str, tuple[str, float]] = {}


def issue_stream_ticket(user_id: str, ttl_seconds: int = 60) -> str:
    """Issue a short-lived single-use opaque ticket for SSE or file download requests."""
    now = time.monotonic()
    for key, (_, exp) in list(_STREAM_TICKETS.items()):
        if exp <= now:
            _STREAM_TICKETS.pop(key, None)
    ticket = secrets.token_urlsafe(32)
    _STREAM_TICKETS[ticket] = (user_id, now + ttl_seconds)
    return ticket


def consume_stream_ticket(ticket: str) -> str | None:
    """Atomically consume a valid stream ticket and return the associated user_id, or None."""
    entry = _STREAM_TICKETS.pop(ticket, None)
    if not entry:
        return None
    user_id, exp = entry
    if time.monotonic() > exp:
        return None
    return user_id


async def _resolve_user_from_token(raw_token: str | None, db: AsyncSession) -> User:
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación requerido.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(raw_token)
        if payload.get("type") != "access":
            raise ValueError("Invalid token type")
        user_id = str(payload.get("sub"))
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario inactivo o inexistente.",
        )
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials if credentials else None
    return await _resolve_user_from_token(token, db)


async def get_current_user_flexible(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    ticket: str | None = Query(
        default=None,
        description="Ticket opaco de un solo uso (POST /auth/stream-ticket) para SSE o descargas sin exponer JWT en URL.",
    ),
    token: str | None = Query(default=None, description="JWT opcional para EventSource (SSE) o descargas."),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Authenticate via Bearer header, one-time ?ticket=, HttpOnly cookie, or ?token=."""
    if credentials and credentials.credentials:
        return await _resolve_user_from_token(credentials.credentials, db)

    if ticket:
        user_id = consume_stream_ticket(ticket)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Ticket inválido, usado o expirado.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user = await db.get(User, user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario inactivo o inexistente.",
            )
        return user

    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return await _resolve_user_from_token(cookie_token, db)

    return await _resolve_user_from_token(token, db)


def require_roles(allowed_roles: set[UserRole]) -> Callable[..., User]:
    allowed_values = {r.value for r in allowed_roles}

    async def _guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso denegado. Rol '{current_user.role}' no autorizado para esta operación.",
            )
        return current_user

    return _guard


def require_roles_flexible(allowed_roles: set[UserRole]) -> Callable[..., User]:
    """Role guard accepting Bearer header OR `?token=<jwt>` for SSE streams and file exports."""
    allowed_values = {r.value for r in allowed_roles}

    async def _guard(current_user: User = Depends(get_current_user_flexible)) -> User:
        if current_user.role not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso denegado. Rol '{current_user.role}' no autorizado para esta operación.",
            )
        return current_user

    return _guard


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
