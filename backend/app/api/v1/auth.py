"""Authentication & RBAC User Management endpoints (Section 2.E.2)."""

from __future__ import annotations

import math
import secrets
import time
from collections import deque
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, get_current_user, issue_stream_ticket, require_roles
from app.core.config import get_settings
from app.core.crypto import blind_index
from app.core.security import (
    ROLES_ADMIN,
    UserRole,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.base import get_db
from app.db.models import InvitationCode, User, utcnow
from app.schemas.auth import (
    InvitationCreatedOut,
    InvitationCreateRequest,
    InvitationOut,
    InvitationValidateRequest,
    InvitationValidateResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    SignupRequest,
    StreamTicketResponse,
    TokenResponse,
    UserOut,
    UserRoleUpdate,
)
from app.services.audit.service import record_audit

router = APIRouter(prefix="/auth", tags=["Autenticación y Roles"])

# Sliding-window failed login tracker keyed by client IP and blind-indexed email
_FAILED_LOGINS_BY_IP: dict[str, deque[float]] = {}
_FAILED_LOGINS_BY_EMAIL: dict[str, deque[float]] = {}
_INVITE_VALIDATE_BY_IP: dict[str, deque[float]] = {}
_SIGNUP_BY_IP: dict[str, deque[float]] = {}

_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_VALIDATE_MAX_ATTEMPTS = 20
_INVITE_VALIDATE_WINDOW_SECONDS = 300
_SIGNUP_MAX_ATTEMPTS = 10
_SIGNUP_WINDOW_SECONDS = 300


def reset_login_rate_limiter() -> None:
    """Clear in-memory auth rate-limit windows (used in test isolation)."""
    _FAILED_LOGINS_BY_IP.clear()
    _FAILED_LOGINS_BY_EMAIL.clear()
    _INVITE_VALIDATE_BY_IP.clear()
    _SIGNUP_BY_IP.clear()


def _prune_window(dq: deque[float], now: float, window_seconds: int) -> None:
    cutoff = now - window_seconds
    while dq and dq[0] <= cutoff:
        dq.popleft()


def _get_retry_after(ip: str, email_h: str, now: float, max_attempts: int, window_seconds: int) -> int:
    retry_after = 0
    for store, key in ((_FAILED_LOGINS_BY_IP, ip), (_FAILED_LOGINS_BY_EMAIL, email_h)):
        if not key:
            continue
        dq = store.get(key)
        if not dq:
            continue
        _prune_window(dq, now, window_seconds)
        if len(dq) >= max_attempts:
            remaining = math.ceil((dq[0] + window_seconds) - now)
            retry_after = max(retry_after, max(1, remaining))
    return retry_after


def _record_failed_login(ip: str, email_h: str, now: float) -> None:
    for store, key in ((_FAILED_LOGINS_BY_IP, ip), (_FAILED_LOGINS_BY_EMAIL, email_h)):
        if not key:
            continue
        store.setdefault(key, deque()).append(now)


def _clear_failed_login(ip: str, email_h: str) -> None:
    _FAILED_LOGINS_BY_IP.pop(ip, None)
    if email_h:
        _FAILED_LOGINS_BY_EMAIL.pop(email_h, None)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    settings = get_settings()
    ip = get_client_ip(request)
    email_h = blind_index(payload.email.lower()) or ""
    now = time.monotonic()
    retry_after = _get_retry_after(
        ip,
        email_h,
        now,
        settings.login_rate_limit_max_attempts,
        settings.login_rate_limit_window_seconds,
    )
    if retry_after > 0:
        await record_audit(
            db,
            action="auth.login_blocked",
            resource_type="auth",
            ip_address=ip,
            details={"email_hash": email_h, "retry_after_seconds": retry_after},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos de inicio de sesión. Intente más tarde.",
            headers={"Retry-After": str(retry_after)},
        )

    res = await db.execute(select(User).where(User.email_hash == email_h))
    user = res.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        _record_failed_login(ip, email_h, now)
        await record_audit(
            db,
            action="auth.login_failed",
            resource_type="auth",
            ip_address=ip,
            details={"email_hash": email_h},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario desactivado.")

    _clear_failed_login(ip, email_h)
    access = create_access_token(user.id, user.role, extra={"email": user.email})
    refresh = create_refresh_token(user.id, user.role)
    await record_audit(
        db,
        action="auth.login",
        resource_type="user",
        resource_id=user.id,
        user=user,
        ip_address=ip,
    )
    await db.commit()
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        role=user.role,
        user_id=user.id,
        full_name=user.full_name,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_roles(ROLES_ADMIN)),
) -> User:
    email = payload.email.lower()
    email_h = blind_index(email) or ""
    existing = await db.execute(select(User).where(User.email_hash == email_h))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El correo ya está registrado.")

    new_user = User(
        email=email,
        email_hash=email_h,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role.value,
        is_active=True,
    )
    db.add(new_user)
    await db.flush()
    await record_audit(
        db,
        action="user.create",
        resource_type="user",
        resource_id=new_user.id,
        user=admin_user,
        ip_address=get_client_ip(request),
        details={"created_email": email, "role": payload.role.value},
    )
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        claims = decode_token(payload.refresh_token)
        if claims.get("type") != "refresh":
            raise ValueError("Invalid token type")
        user_id = str(claims.get("sub"))
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token inválido.") from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no válido.")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role, extra={"email": user.email}),
        refresh_token=create_refresh_token(user.id, user.role),
        role=user.role,
        user_id=user.id,
        full_name=user.full_name,
    )


@router.post("/stream-ticket", response_model=StreamTicketResponse)
async def create_stream_ticket(current_user: User = Depends(get_current_user)) -> StreamTicketResponse:
    """Issue a 60s single-use opaque ticket for SSE EventSource and direct report downloads."""
    return StreamTicketResponse(ticket=issue_stream_ticket(current_user.id, ttl_seconds=60), expires_in_seconds=60)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_ADMIN)),
) -> list[User]:
    res = await db.execute(select(User).order_by(User.created_at))
    return list(res.scalars().all())


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user_role(
    user_id: str,
    payload: UserRoleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_roles(ROLES_ADMIN)),
) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")
    old_role = target.role
    target.role = payload.role.value
    if payload.is_active is not None:
        target.is_active = payload.is_active
    await record_audit(
        db,
        action="user.update_role",
        resource_type="user",
        resource_id=target.id,
        user=admin_user,
        ip_address=get_client_ip(request),
        details={"old_role": old_role, "new_role": target.role, "is_active": target.is_active},
    )
    await db.commit()
    await db.refresh(target)
    return target


def _generate_invitation_code() -> str:
    """Generate a cryptographically secure invitation code like INV-XXXX-XXXX."""
    part1 = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(4))
    part2 = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(4))
    return f"INV-{part1}-{part2}"


def _enforce_ip_rate_limit(
    store: dict[str, deque[float]],
    ip: str,
    max_attempts: int,
    window_seconds: int,
) -> None:
    if not ip:
        return
    now = time.monotonic()
    dq = store.setdefault(ip, deque())
    _prune_window(dq, now, window_seconds)
    if len(dq) >= max_attempts:
        retry_after = max(1, math.ceil((dq[0] + window_seconds) - now))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes desde esta IP. Intente más tarde.",
            headers={"Retry-After": str(retry_after)},
        )
    dq.append(now)


def _validate_invitation_state(inv: InvitationCode | None) -> InvitationCode:
    if inv is None or inv.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Código de invitación inválido o revocado.",
        )
    if inv.expires_at <= utcnow():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="El código de invitación ha expirado.",
        )
    if inv.uses_count >= inv.max_uses:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="El código de invitación ya alcanzó su límite de usos.",
        )
    return inv


@router.post("/invitations", response_model=InvitationCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_roles(ROLES_ADMIN)),
) -> InvitationCreatedOut:
    code = ""
    code_h = ""
    for _ in range(5):
        candidate = _generate_invitation_code()
        candidate_h = blind_index(candidate) or ""
        exists = await db.execute(select(InvitationCode.id).where(InvitationCode.code_hash == candidate_h))
        if exists.scalar_one_or_none() is None:
            code = candidate
            code_h = candidate_h
            break
    if not code:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo generar un código de invitación único.",
        )

    locked_email = payload.email.lower() if payload.email else None
    locked_email_h = blind_index(locked_email) if locked_email else None
    now_utc = utcnow()
    inv = InvitationCode(
        code_hash=code_h,
        code_prefix=code[:8],
        role=payload.role.value,
        email=locked_email,
        email_hash=locked_email_h,
        max_uses=payload.max_uses,
        uses_count=0,
        expires_at=now_utc + timedelta(hours=payload.expires_in_hours),
        created_by_id=admin_user.id,
        created_at=now_utc,
    )
    db.add(inv)
    await db.flush()
    await record_audit(
        db,
        action="invitation.create",
        resource_type="invitation_code",
        resource_id=inv.id,
        user=admin_user,
        ip_address=get_client_ip(request),
        details={
            "code_prefix": inv.code_prefix,
            "role": inv.role,
            "max_uses": inv.max_uses,
            "email_restricted": bool(locked_email),
        },
    )
    await db.commit()
    await db.refresh(inv)
    return InvitationCreatedOut(
        id=inv.id,
        code=code,
        code_prefix=inv.code_prefix,
        role=inv.role,
        email=inv.email,
        max_uses=inv.max_uses,
        uses_count=inv.uses_count,
        expires_at=inv.expires_at,
        revoked_at=inv.revoked_at,
        created_at=inv.created_at,
    )


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_ADMIN)),
) -> list[InvitationCode]:
    res = await db.execute(select(InvitationCode).order_by(InvitationCode.created_at.desc()))
    return list(res.scalars().all())


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_roles(ROLES_ADMIN)),
) -> Response:
    inv = await db.get(InvitationCode, invitation_id)
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada.")
    if inv.revoked_at is None:
        inv.revoked_at = utcnow()
        await record_audit(
            db,
            action="invitation.revoke",
            resource_type="invitation_code",
            resource_id=inv.id,
            user=admin_user,
            ip_address=get_client_ip(request),
            details={"code_prefix": inv.code_prefix, "role": inv.role},
        )
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invitations/validate", response_model=InvitationValidateResponse)
async def validate_invitation(
    payload: InvitationValidateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> InvitationValidateResponse:
    ip = get_client_ip(request)
    _enforce_ip_rate_limit(
        _INVITE_VALIDATE_BY_IP,
        ip,
        _INVITE_VALIDATE_MAX_ATTEMPTS,
        _INVITE_VALIDATE_WINDOW_SECONDS,
    )
    normalized = payload.code.strip().upper()
    code_h = blind_index(normalized) or ""
    res = await db.execute(select(InvitationCode).where(InvitationCode.code_hash == code_h))
    inv = _validate_invitation_state(res.scalar_one_or_none())
    return InvitationValidateResponse(
        valid=True,
        role=inv.role,
        email_locked=inv.email,
        expires_at=inv.expires_at,
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: SignupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    ip = get_client_ip(request)
    _enforce_ip_rate_limit(_SIGNUP_BY_IP, ip, _SIGNUP_MAX_ATTEMPTS, _SIGNUP_WINDOW_SECONDS)

    email = payload.email.lower()
    email_h = blind_index(email) or ""
    existing = await db.execute(select(User.id).where(User.email_hash == email_h))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El correo ya está registrado.")

    assigned_role = UserRole.CARGADOR.value
    invitation_used_id: str | None = None
    raw_code = (payload.invitation_code or "").strip().upper()

    if raw_code:
        code_h = blind_index(raw_code) or ""
        res = await db.execute(
            select(InvitationCode).where(InvitationCode.code_hash == code_h).with_for_update()
        )
        inv = _validate_invitation_state(res.scalar_one_or_none())
        if inv.email_hash and inv.email_hash != email_h:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Este código de invitación está restringido a otro correo electrónico.",
            )
        assigned_role = inv.role
        inv.uses_count += 1
        invitation_used_id = inv.id

    new_user = User(
        email=email,
        email_hash=email_h,
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=assigned_role,
        is_active=True,
    )
    db.add(new_user)
    await db.flush()
    await record_audit(
        db,
        action="auth.signup",
        resource_type="user",
        resource_id=new_user.id,
        user=new_user,
        ip_address=ip,
        details={
            "role": assigned_role,
            "invitation_id": invitation_used_id,
            "via_invitation": bool(invitation_used_id),
        },
    )
    await db.commit()
    await db.refresh(new_user)

    access = create_access_token(new_user.id, new_user.role, extra={"email": new_user.email})
    refresh = create_refresh_token(new_user.id, new_user.role)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        role=new_user.role,
        user_id=new_user.id,
        full_name=new_user.full_name,
    )
