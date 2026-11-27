"""Official BCV USD/VES exchange rate service with TLS 1.2+ fetching, caching, and override."""

from __future__ import annotations

import logging
import re
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import BcvRateSnapshot

logger = logging.getLogger(__name__)


@dataclass
class BcvRateInfo:
    usd_to_ves: float
    source: str
    fetched_at: datetime
    is_manual_override: bool = False


_CACHE: BcvRateInfo | None = None
_CACHE_TTL = timedelta(minutes=30)


def _local_tz() -> timezone:
    """Venezuela timezone from settings.timezone_offset (e.g. "-04:00")."""
    raw = (get_settings().timezone_offset or "-04:00").strip()
    sign = -1 if raw.startswith("-") else 1
    hours, _, minutes = raw.lstrip("+-").partition(":")
    return timezone(sign * timedelta(hours=int(hours or 0), minutes=int(minutes or 0)))


def manual_override_is_current(fetched_at: datetime, now: datetime | None = None) -> bool:
    """A committee override applies only on the local calendar day it was set.

    The next day the official live rate is used again, so a stale manual rate can never silently
    leak into later evaluations.
    """
    tz = _local_tz()
    ref = now or datetime.now(UTC)
    stamp = fetched_at if fetched_at.tzinfo else fetched_at.replace(tzinfo=UTC)
    return stamp.astimezone(tz).date() == ref.astimezone(tz).date()


def _create_tls12_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


async def fetch_live_bcv_rate() -> BcvRateInfo:
    """Fetch official BCV rate over TLS 1.2+ HTTPS with reliable fallback."""
    global _CACHE
    now = datetime.now(UTC)
    if _CACHE and (now - _CACHE.fetched_at) < _CACHE_TTL and not _CACHE.is_manual_override:
        return _CACHE

    settings = get_settings()
    ssl_ctx = _create_tls12_ssl_context()

    # Source 1: ve.dolarapi.com official BCV endpoint (HTTPS)
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=ssl_ctx) as client:
            resp = await client.get("https://ve.dolarapi.com/v1/dolares/oficial")
            if resp.status_code == 200:
                data = resp.json()
                rate = float(data.get("promedio") or data.get("venta") or 0)
                if 1.0 < rate < 100000.0:
                    info = BcvRateInfo(
                        usd_to_ves=round(rate, 4),
                        source="bcv_dolarapi_oficial",
                        fetched_at=now,
                    )
                    _CACHE = info
                    return info
    except Exception as exc:
        logger.debug("BCV source 1 (dolarapi) unavailable: %s", exc)

    # Source 2: Official BCV website HTML scrape (HTTPS)
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=ssl_ctx) as client:
            resp = await client.get("https://www.bcv.org.ve/")
            if resp.status_code == 200:
                match = re.search(r'id="dolar".*?<strong>\s*([\d,\.]+)\s*</strong>', resp.text, re.S | re.I)
                if match:
                    raw = match.group(1).strip().replace(".", "").replace(",", ".")
                    rate = float(raw)
                    if 1.0 < rate < 100000.0:
                        info = BcvRateInfo(
                            usd_to_ves=round(rate, 4),
                            source="bcv_org_ve_oficial",
                            fetched_at=now,
                        )
                        _CACHE = info
                        return info
    except Exception as exc:
        logger.debug("BCV source 2 (bcv.org.ve) unavailable: %s", exc)

    # Fallback to configured official reference rate
    return BcvRateInfo(
        usd_to_ves=round(settings.bcv_fallback_rate, 4),
        source="configured_bcv_fallback",
        fetched_at=now,
    )


async def get_active_bcv_rate(db: AsyncSession | None = None, force_refresh: bool = False) -> BcvRateInfo:
    """Return today's manual override if present in DB, otherwise fetch the live BCV rate."""
    global _CACHE
    if force_refresh:
        _CACHE = None

    if db is not None and not force_refresh:
        result = await db.execute(
            select(BcvRateSnapshot).order_by(desc(BcvRateSnapshot.fetched_at)).limit(1)
        )
        snap = result.scalar_one_or_none()
        if snap and snap.is_manual_override and manual_override_is_current(snap.fetched_at):
            return BcvRateInfo(
                usd_to_ves=snap.usd_to_ves,
                source=snap.source,
                fetched_at=snap.fetched_at,
                is_manual_override=True,
            )

    info = await fetch_live_bcv_rate()
    if db is not None:
        db.add(
            BcvRateSnapshot(
                usd_to_ves=info.usd_to_ves,
                source=info.source,
                is_manual_override=False,
                fetched_at=info.fetched_at,
            )
        )
        await db.flush()
    return info
