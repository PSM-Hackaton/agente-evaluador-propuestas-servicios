"""Immutable Audit Log query endpoints (Section 2.E.2 & 2.F)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.security import ROLES_READ
from app.db.base import get_db
from app.db.models import AuditLog, User
from app.schemas.domain import AuditLogOut

router = APIRouter(prefix="/audit-logs", tags=["Auditoría y Registro de Cambios"])


@router.get("", response_model=list[AuditLogOut])
async def list_audit_logs(
    resource_type: str | None = None,
    resource_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[AuditLog]:
    fetch_limit = min(limit, 500) if not action else 1000
    stmt = select(AuditLog).order_by(desc(AuditLog.created_at)).limit(fetch_limit)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)
    res = await db.execute(stmt)
    logs = list(res.scalars().all())
    if action:
        q = action.strip().lower()
        logs = [entry for entry in logs if q in entry.action.lower()][: min(limit, 500)]
    return logs
