"""Auth and user schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.security import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.CARGADOR


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    full_name: str


class StreamTicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int = 60


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserRoleUpdate(BaseModel):
    role: UserRole
    is_active: bool | None = None


class InvitationCreateRequest(BaseModel):
    role: UserRole = UserRole.REVISOR
    email: EmailStr | None = None
    max_uses: int = Field(default=1, ge=1, le=100)
    expires_in_hours: int = Field(default=72, ge=1, le=24 * 90)


class InvitationOut(BaseModel):
    id: str
    code_prefix: str
    role: str
    email: str | None = None
    max_uses: int
    uses_count: int
    expires_at: datetime
    revoked_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class InvitationCreatedOut(InvitationOut):
    code: str


class InvitationValidateRequest(BaseModel):
    code: str = Field(min_length=4, max_length=64)


class InvitationValidateResponse(BaseModel):
    valid: bool = True
    role: str
    email_locked: str | None = None
    expires_at: datetime


class SignupRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    invitation_code: str | None = Field(default=None, max_length=64)
