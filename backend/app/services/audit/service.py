"""Audit log service for immutable action tracking (Section 2.E.2 & 2.F)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import blind_index
from app.db.models import AuditLog, User


async def record_audit(
    db: AsyncSession,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    user: User | None = None,
    actor_email: str = "system@evaluador.ve",
    actor_role: str = "system",
    ip_address: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=user.id if user else None,
        actor_email=user.email if user else actor_email,
        actor_role=user.role if user else actor_role,
        action=action,
        action_hash=blind_index(action) or "",
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        details=details,
    )
    db.add(entry)
    await db.flush()
    return entry
