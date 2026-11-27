"""Authentication, password hashing (scrypt), JWT tokens, and Role-Based Access Control (RBAC)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import jwt

from app.core.config import get_settings


class UserRole(StrEnum):
    """Platform roles defined in Section 2.E.2 of the hackathon specification."""

    CARGADOR = "cargador"      # Uploads projects & proposals
    REVISOR = "revisor"        # Runs/reviews AI evaluations, adds notes, moves to committee review
    APROBADOR = "aprobador"    # Approves final decision, adjudicates / closes projects
    AUDITOR = "auditor"        # Read-only access to projects, reports, and audit logs
    ADMIN = "admin"            # Full platform & user management


# Role permission hierarchy helpers
ROLES_UPLOAD = {UserRole.CARGADOR, UserRole.REVISOR, UserRole.ADMIN}
ROLES_EVALUATE = {UserRole.REVISOR, UserRole.APROBADOR, UserRole.ADMIN}
ROLES_REVIEW = {UserRole.REVISOR, UserRole.APROBADOR, UserRole.ADMIN}
ROLES_APPROVE = {UserRole.APROBADOR, UserRole.ADMIN}
ROLES_READ = {UserRole.CARGADOR, UserRole.REVISOR, UserRole.APROBADOR, UserRole.AUDITOR, UserRole.ADMIN}
ROLES_ADMIN = {UserRole.ADMIN}


def hash_password(password: str) -> str:
    """Hash password using memory-hard scrypt (stdlib hashlib, zero external C issues)."""
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algo, n_s, r_s, p_s, salt_b64, dk_b64 = stored_hash.split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        candidate = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=len(expected),
        )
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def create_access_token(subject: str, role: str, extra: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: str, role: str) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "role": role,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.refresh_token_expire_days)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
