"""Financial Normalization, BCV Exchange Rate, and TCO Preview endpoints (Section 2.E.4)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles
from app.core.security import ROLES_APPROVE, ROLES_READ
from app.db.base import get_db
from app.db.models import BcvRateSnapshot, User
from app.schemas.domain import BcvOverrideRequest, TcoPreviewRequest
from app.services.audit.service import record_audit
from app.services.finance.bcv import get_active_bcv_rate
from app.services.finance.tco import compute_tco_breakdown

router = APIRouter(prefix="/finance", tags=["Normalización Financiera y BCV"])


@router.get("/bcv-rate")
async def get_bcv_rate(
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    info = await get_active_bcv_rate(db, force_refresh=refresh)
    await db.commit()
    return {
        "usd_to_ves": info.usd_to_ves,
        "source": info.source,
        "fetched_at": info.fetched_at.isoformat(),
        "is_manual_override": info.is_manual_override,
    }


@router.post("/bcv-rate/override")
async def override_bcv_rate(
    payload: BcvOverrideRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_APPROVE)),
) -> dict:
    snap = BcvRateSnapshot(
        usd_to_ves=round(payload.usd_to_ves, 4),
        source=f"manual_override:{payload.note or 'comite'}",
        is_manual_override=True,
        recorded_by=current_user.email,
        fetched_at=datetime.now(UTC),
    )
    db.add(snap)
    await db.flush()
    await record_audit(
        db,
        action="finance.bcv_override",
        resource_type="bcv_rate",
        resource_id=snap.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"usd_to_ves": snap.usd_to_ves, "note": payload.note},
    )
    await db.commit()
    return {
        "id": snap.id,
        "usd_to_ves": snap.usd_to_ves,
        "source": snap.source,
        "is_manual_override": True,
        "fetched_at": snap.fetched_at.isoformat(),
    }


@router.get("/bcv-rate/history")
async def bcv_rate_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[dict]:
    res = await db.execute(
        select(BcvRateSnapshot).order_by(desc(BcvRateSnapshot.fetched_at)).limit(min(limit, 100))
    )
    return [
        {
            "id": r.id,
            "usd_to_ves": r.usd_to_ves,
            "source": r.source,
            "is_manual_override": r.is_manual_override,
            "recorded_by": r.recorded_by,
            "fetched_at": r.fetched_at.isoformat(),
        }
        for r in res.scalars().all()
    ]


@router.post("/tco-preview")
async def preview_tco(
    payload: TcoPreviewRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    info = await get_active_bcv_rate(db)
    return compute_tco_breakdown(
        declared_total=payload.declared_total,
        currency=payload.currency,
        bcv_rate=info.usd_to_ves,
        shipping_included_in_total=payload.shipping_included_in_total,
        shipping_cost=payload.shipping_cost,
        installation_included_in_total=payload.installation_included_in_total,
        installation_cost=payload.installation_cost,
        hidden_surcharge_flat=payload.hidden_surcharge_flat,
        hidden_surcharge_pct=payload.hidden_surcharge_pct,
        iva_applies=payload.iva_applies,
        iva_included=payload.iva_included,
        iva_rate=payload.iva_rate,
        payment_surcharge_pct=payload.payment_surcharge_pct,
    )
