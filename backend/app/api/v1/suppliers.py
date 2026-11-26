"""Supplier Directory, Participation History, and Automatic Alerts (Section 2.E.3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles
from app.core.crypto import blind_index
from app.core.security import ROLES_READ, ROLES_REVIEW, ROLES_UPLOAD
from app.db.base import get_db
from app.db.models import EvaluationRun, Project, Proposal, ProposalEvaluation, Supplier, SupplierAlert, User
from app.schemas.domain import SupplierAlertOut, SupplierCreate, SupplierOut, SupplierUpdate
from app.services.agent.orchestrator import ALERT_REASON_PRIORITY
from app.services.audit.service import record_audit

router = APIRouter(prefix="/suppliers", tags=["Directorio de Proveedores"])


async def _to_supplier_out(db: AsyncSession, supplier: Supplier) -> SupplierOut:
    a_cnt = (
        await db.execute(select(func.count(SupplierAlert.id)).where(SupplierAlert.supplier_id == supplier.id))
    ).scalar_one()
    p_cnt = (
        await db.execute(select(func.count(Proposal.id)).where(Proposal.supplier_id == supplier.id))
    ).scalar_one()
    return SupplierOut(
        id=supplier.id,
        name=supplier.name,
        rif=supplier.rif,
        location=supplier.location,
        representative=supplier.representative,
        phone=supplier.phone,
        email=supplier.email,
        notes=supplier.notes,
        alerts_count=int(a_cnt),
        proposals_count=int(p_cnt),
        created_at=supplier.created_at,
    )


@router.get("", response_model=list[SupplierOut])
async def list_suppliers(
    search: str | None = None,
    only_with_alerts: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[SupplierOut]:
    res = await db.execute(select(Supplier))
    suppliers = sorted(res.scalars().all(), key=lambda s: s.name.lower())
    if search:
        q = search.strip().lower()
        suppliers = [
            s for s in suppliers if q in s.name.lower() or (s.rif and q in s.rif.lower())
        ]
    outs = [await _to_supplier_out(db, s) for s in suppliers]
    if only_with_alerts:
        outs = [o for o in outs if o.alerts_count > 0]
    return outs


@router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    payload: SupplierCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> SupplierOut:
    norm_rif = payload.rif.upper() if payload.rif else None
    rif_h = blind_index(norm_rif)
    if rif_h:
        dup = await db.execute(select(Supplier).where(Supplier.rif_hash == rif_h))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe un proveedor con ese RIF.")
    supplier = Supplier(
        name=payload.name,
        name_hash=blind_index(payload.name) or "",
        rif=norm_rif,
        rif_hash=rif_h,
        location=payload.location,
        representative=payload.representative,
        phone=payload.phone,
        email=payload.email,
        notes=payload.notes,
    )
    db.add(supplier)
    await db.flush()
    await record_audit(
        db,
        action="supplier.create",
        resource_type="supplier",
        resource_id=supplier.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"name": supplier.name, "rif": supplier.rif},
    )
    await db.commit()
    await db.refresh(supplier)
    return await _to_supplier_out(db, supplier)


@router.get("/{supplier_id}")
async def get_supplier_detail(
    supplier_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    supplier = await db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    alerts = list(
        (
            await db.execute(
                select(SupplierAlert)
                .where(SupplierAlert.supplier_id == supplier_id)
                .order_by(desc(SupplierAlert.created_at))
            )
        ).scalars().all()
    )
    alerts.sort(
        key=lambda a: (
            0 if a.severity == "critical" else 1,
            ALERT_REASON_PRIORITY.get(a.reason_code, 99),
            -a.created_at.timestamp(),
        )
    )
    proposals = list(
        (
            await db.execute(
                select(Proposal)
                .where(Proposal.supplier_id == supplier_id)
                .order_by(desc(Proposal.created_at))
            )
        ).scalars().all()
    )
    prop_ids = [p.id for p in proposals]
    eval_history: list[dict] = []
    if prop_ids:
        pe_res = await db.execute(
            select(ProposalEvaluation, EvaluationRun, Project)
            .join(EvaluationRun, ProposalEvaluation.evaluation_run_id == EvaluationRun.id)
            .join(Project, EvaluationRun.project_id == Project.id)
            .where(ProposalEvaluation.proposal_id.in_(prop_ids))
            .order_by(desc(EvaluationRun.started_at))
        )
        for pe, run, proj in pe_res.all():
            eval_history.append(
                {
                    "evaluation_run_id": pe.evaluation_run_id,
                    "project_id": proj.id,
                    "project_name": proj.name,
                    "evaluated_at": run.started_at.isoformat(),
                    "proposal_identifier": pe.proposal_identifier,
                    "is_valid": pe.is_valid,
                    "rank_position": pe.rank_position,
                    "adjusted_tco_usd": pe.adjusted_tco_usd,
                    "discard_reasons": pe.discard_reasons or [],
                    "prompt_injection_detected": pe.prompt_injection_detected,
                }
            )

    return {
        "supplier": (await _to_supplier_out(db, supplier)).model_dump(),
        "alerts": [SupplierAlertOut.model_validate(a).model_dump() for a in alerts],
        "participation_history": eval_history,
    }


@router.patch("/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: str,
    payload: SupplierUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_REVIEW)),
) -> SupplierOut:
    supplier = await db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        if k == "rif" and v is not None:
            v = v.upper()
        setattr(supplier, k, v)
    if "name" in changes:
        supplier.name_hash = blind_index(supplier.name) or ""
    if "rif" in changes:
        supplier.rif_hash = blind_index(supplier.rif)
    await record_audit(
        db,
        action="supplier.update",
        resource_type="supplier",
        resource_id=supplier.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"changes": changes},
    )
    await db.commit()
    await db.refresh(supplier)
    return await _to_supplier_out(db, supplier)


@router.post("/alerts/{alert_id}/resolve", response_model=SupplierAlertOut)
async def resolve_supplier_alert(
    alert_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_REVIEW)),
) -> SupplierAlert:
    alert = await db.get(SupplierAlert, alert_id)
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta no encontrada.")
    alert.is_resolved = True
    await record_audit(
        db,
        action="supplier_alert.resolve",
        resource_type="supplier_alert",
        resource_id=alert.id,
        user=current_user,
        ip_address=get_client_ip(request),
    )
    await db.commit()
    await db.refresh(alert)
    return alert
