"""Dashboard Summary & Security Posture endpoint for Frontend integration."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.security import ROLES_READ
from app.db.base import get_db
from app.db.models import (
    AuditLog,
    EvaluationRun,
    EvaluationStatus,
    Project,
    ProjectStatus,
    Proposal,
    ProposalEvaluation,
    Supplier,
    SupplierAlert,
    User,
)
from app.services.finance.bcv import get_active_bcv_rate

router = APIRouter(prefix="/dashboard", tags=["Dashboard y Seguridad"])


@router.get("/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    """Single-call aggregate payload for the Frontend main dashboard & security posture panel."""
    settings = get_settings()

    # Projects by workflow stage
    status_rows = (
        await db.execute(select(Project.status, func.count(Project.id)).group_by(Project.status))
    ).all()
    counts_by_status = {s.value: 0 for s in ProjectStatus}
    for st, cnt in status_rows:
        counts_by_status[st] = int(cnt)

    projects_total = sum(counts_by_status.values())
    proposals_total = int((await db.execute(select(func.count(Proposal.id)))).scalar_one())
    evaluations_total = int((await db.execute(select(func.count(EvaluationRun.id)))).scalar_one())
    evaluations_completed = int(
        (
            await db.execute(
                select(func.count(EvaluationRun.id)).where(
                    EvaluationRun.status == EvaluationStatus.COMPLETED.value
                )
            )
        ).scalar_one()
    )
    suppliers_total = int((await db.execute(select(func.count(Supplier.id)))).scalar_one())
    active_alerts = int(
        (
            await db.execute(
                select(func.count(SupplierAlert.id)).where(SupplierAlert.is_resolved.is_(False))
            )
        ).scalar_one()
    )
    injections_blocked = int(
        (
            await db.execute(
                select(func.count(ProposalEvaluation.id)).where(
                    ProposalEvaluation.prompt_injection_detected.is_(True)
                )
            )
        ).scalar_one()
    )
    audit_entries = int((await db.execute(select(func.count(AuditLog.id)))).scalar_one())

    recent_res = await db.execute(select(Project).order_by(desc(Project.updated_at)).limit(5))
    recent_projects = [
        {
            "id": p.id,
            "name": p.name,
            "execution_location": p.execution_location,
            "status": p.status,
            "document_filename": p.document_filename,
            "updated_at": p.updated_at.isoformat(),
        }
        for p in recent_res.scalars().all()
    ]

    bcv = await get_active_bcv_rate(db)
    await db.commit()

    return {
        "projects_total": projects_total,
        "projects_by_status": counts_by_status,
        "proposals_total": proposals_total,
        "evaluations_total": evaluations_total,
        "evaluations_completed": evaluations_completed,
        "suppliers_total": suppliers_total,
        "active_supplier_alerts": active_alerts,
        "prompt_injections_blocked": injections_blocked,
        "bcv_rate": {
            "usd_to_ves": bcv.usd_to_ves,
            "source": bcv.source,
            "fetched_at": bcv.fetched_at.isoformat(),
            "is_manual_override": bcv.is_manual_override,
        },
        "security_status": {
            "encryption_at_rest": "AES-256-GCM",
            "db_sensitive_columns_encrypted": True,
            "storage_files_encrypted": True,
            "tls_enabled": settings.tls_enabled,
            "tls_min_version": "TLS 1.2 / TLS 1.3",
            "rbac_enabled": True,
            "audit_log_entries": audit_entries,
            "llm_provider": settings.resolved_llm_provider(),
        },
        "recent_projects": recent_projects,
    }
