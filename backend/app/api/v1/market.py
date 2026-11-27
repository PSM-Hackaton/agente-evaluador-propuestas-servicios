"""Self-contained Market Price Benchmarking API (Section 2.C — Issue #11, zero external API keys)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles
from app.core.config import get_settings
from app.core.security import ROLES_APPROVE, ROLES_READ
from app.db.base import get_db
from app.db.models import User
from app.schemas.domain import MarketBenchmarkBatchRequest, MarketBenchmarkRequest
from app.services.audit.service import record_audit
from app.services.market.search import (
    _CACHE_TTL_SECONDS,
    _SEARCH_CACHE,
    BASELINE_MARKET_REFERENCES,
    search_market_price,
)

router = APIRouter(prefix="/market", tags=["Contraste de Precios de Mercado"])


@router.post("/benchmark")
async def benchmark_item_price(
    payload: MarketBenchmarkRequest,
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    """Compare a single hardware/service item against live autonomous web search (no third-party API keys)."""
    return await search_market_price(
        item_description=payload.item_description,
        proposed_unit_price_usd=payload.proposed_unit_price_usd,
        enable_web=payload.enable_web,
    )


@router.post("/benchmark/batch")
async def benchmark_items_batch(
    payload: MarketBenchmarkBatchRequest,
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    """Compare up to 20 items in one request using the internal autonomous market price search service."""
    results = await asyncio.gather(
        *(
            search_market_price(
                item_description=item.item_description,
                proposed_unit_price_usd=item.proposed_unit_price_usd,
                enable_web=payload.enable_web and item.enable_web,
            )
            for item in payload.items
        )
    )
    flagged = [r for r in results if r.get("is_abusive_overprice")]
    return {
        "total_items": len(results),
        "abusive_overprice_count": len(flagged),
        "results": list(results),
    }


@router.get("/reference-catalog")
async def get_reference_catalog(
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    """Expose fallback hardware reference catalog and cache status for auditability."""
    settings = get_settings()
    return {
        "provider": "autonomous_web_search",
        "requires_external_api_key": False,
        "web_search_enabled": settings.web_search_enabled,
        "cached_queries": len(_SEARCH_CACHE),
        "cache_ttl_seconds": int(_CACHE_TTL_SECONDS),
        "fallback_catalog": [
            {
                "keyword": kw,
                "reference_low_usd": lo,
                "reference_high_usd": hi,
                "description": label,
            }
            for kw, (lo, hi), label in BASELINE_MARKET_REFERENCES
        ],
    }


@router.delete("/cache")
async def clear_market_cache(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_APPROVE)),
) -> dict:
    """Clear in-memory web price search cache and record an audit trail event."""
    cleared = len(_SEARCH_CACHE)
    _SEARCH_CACHE.clear()
    await record_audit(
        db,
        action="market.cache_cleared",
        resource_type="market_cache",
        resource_id="memory",
        user=current_user,
        ip_address=get_client_ip(request),
        details={"cleared_entries": cleared},
    )
    await db.commit()
    return {"cleared_entries": cleared}
