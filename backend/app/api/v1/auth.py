"""Authentication & RBAC User Management endpoints (Section 2.E.2)."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, get_current_user, issue_stream_ticket, require_roles
from app.core.crypto import blind_index
from app.core.security import (
    ROLES_ADMIN,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.base import get_db
from app.db.models import User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    StreamTicketResponse,
    TokenResponse,
    UserOut,
    UserRoleUpdate,
)
from app.services.audit.service import record_audit

router = APIRouter(prefix="/auth", tags=["Autenticación y Roles"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    email_h = blind_index(payload.email.lower())
    res = await db.execute(select(User).where(User.email_hash == email_h))
    user = res.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario desactivado.")

    access = create_access_token(user.id, user.role, extra={"email": user.email})
    refresh = create_refresh_token(user.id, user.role)
    await record_audit(
        db,
        action="auth.login",
        resource_type="user",
        resource_id=user.id,
        user=user,
        ip_address=get_client_ip(request),
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
