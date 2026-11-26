"""Autonomous Web Search & Market Price Benchmarking (Section 2.C)."""

from __future__ import annotations

import asyncio
import logging
import re
import ssl
import time
from statistics import median
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PRICE_RE = re.compile(r"\$\s*([0-9]{2,5}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)")

# In-memory TTL cache for web searches (query -> (timestamp, sources, provider))
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, str]], str]] = {}
_CACHE_TTL_SECONDS = 1800.0

# Baseline reference ranges (USD) for complete workstations & components (sanity anchor + offline fallback)
BASELINE_MARKET_REFERENCES: list[tuple[str, tuple[float, float], str]] = [
    ("rtx 4070 super", (1800.0, 2900.0), "Workstation gama alta RTX 4070 Super completa + periféricos"),
    ("rtx 4070", (1600.0, 2650.0), "Workstation gama alta RTX 4070 completa + periféricos"),
    ("rtx 4060 ti", (1350.0, 2250.0), "Workstation media-alta RTX 4060 Ti completa + periféricos"),
    ("rtx 4060", (1050.0, 1850.0), "PC media-alta RTX 4060 completa + monitor + protección"),
    ("rtx 3060", (950.0, 1750.0), "PC media-alta RTX 3060 12GB completa + monitor + UPS"),
    ("rx 7600", (950.0, 1750.0), "PC media-alta RX 7600 completa + monitor + protección"),
    ("xeon e5", (350.0, 650.0), "Kit Xeon E5-2680/2690 v4 (arquitectura 2016 reciclada) mercado secundario"),
]


def _build_focused_query(item_description: str) -> str:
    """Extract clean hardware/product terms for higher-precision web pricing queries."""
    tokens: list[str] = []
    for pat in (
        r"(?:amd\s+)?ryzen\s*[579]\s*\d{4}x?|intel\s+core\s+i[3579]-\d{4,5}[a-z]*|xeon\s+e5-\d{4}\s*v\d",
        r"(?:rtx|gtx)\s*\d{4}(?:\s*(?:ti|super))?(?:\s*\d+gb)?|rx\s*\d{4}(?:\s*\d+gb)?",
        r"\b(?:16|32|64)\s*gb\s*(?:ddr[45])?",
    ):
        m = re.search(pat, item_description, re.I)
        if m:
            tokens.append(m.group(0).strip())
    if tokens:
        return f"{' '.join(tokens)} desktop PC price USD"
    clean = re.sub(r"\s+", " ", item_description).strip()
    return f"{clean[:80]} price USD"


async def _search_tavily(query: str, api_key: str) -> list[dict[str, str]]:
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    async with httpx.AsyncClient(timeout=12.0, verify=ctx) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": 4,
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            return [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", "")[:300],
                }
                for r in data.get("results", [])
            ]
    return []


async def _search_ddgs(query: str) -> list[dict[str, str]]:
    def _run() -> list[dict[str, str]]:
        from ddgs import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=4))
            return [
                {
                    "title": str(r.get("title", "")),
                    "url": str(r.get("href", "")),
                    "snippet": str(r.get("body", ""))[:300],
                }
                for r in results
            ]

    return await asyncio.wait_for(asyncio.to_thread(_run), timeout=20.0)


def _baseline_reference(item_spec: str) -> tuple[float, float, str] | None:
    low = item_spec.lower()
    for keyword, (lo, hi), label in BASELINE_MARKET_REFERENCES:
        if keyword in low:
            return lo, hi, label
    return None


async def search_market_price(
    item_description: str,
    proposed_unit_price_usd: float,
    enable_web: bool | None = None,
) -> dict[str, Any]:
    """Search live web prices (with caching) and benchmark proposed unit price against market values."""
    settings = get_settings()
    do_web = settings.web_search_enabled if enable_web is None else enable_web

    query = _build_focused_query(item_description)
    sources: list[dict[str, str]] = []
    web_prices: list[float] = []
    search_provider = "baseline_catalog"

    if do_web:
        cache_key = query.lower()
        cached = _SEARCH_CACHE.get(cache_key)
        now = time.monotonic()
        if cached and (now - cached[0]) < _CACHE_TTL_SECONDS:
            sources, search_provider = cached[1], f"{cached[2]}_cached"
        else:
            try:
                if settings.tavily_api_key:
                    sources = await _search_tavily(query, settings.tavily_api_key)
                    search_provider = "tavily_web_search"
                else:
                    sources = await _search_ddgs(query)
                    search_provider = "duckduckgo_web_search"
                if sources:
                    _SEARCH_CACHE[cache_key] = (now, sources, search_provider)
            except Exception as exc:
                logger.debug("Web search fallback triggered for '%s': %s", query, exc)
                search_provider = "baseline_catalog_fallback"

        for src in sources:
            text = f"{src.get('title', '')} {src.get('snippet', '')}"
            for m in _PRICE_RE.findall(text):
                try:
                    val = float(m.replace(",", ""))
                    if 80.0 <= val <= 15000.0:
                        web_prices.append(val)
                except ValueError:
                    continue

    baseline = _baseline_reference(item_description)
    if baseline:
        ref_low, ref_high, ref_label = baseline
        ref_mid = round((ref_low + ref_high) / 2.0, 2)
    elif web_prices:
        ref_mid = round(median(web_prices), 2)
        ref_low = round(min(web_prices), 2)
        ref_high = round(max(web_prices), 2)
        ref_label = "Referencia extraída de fuentes web"
    else:
        ref_mid = proposed_unit_price_usd if proposed_unit_price_usd > 0 else 1000.0
        ref_low = round(ref_mid * 0.75, 2)
        ref_high = round(ref_mid * 1.25, 2)
        ref_label = "Estimación de mercado sin referencia directa"

    # Blend web median if within plausible order of magnitude of baseline
    if baseline and web_prices:
        web_med = median(web_prices)
        if ref_low * 0.6 <= web_med <= ref_high * 1.6:
            ref_mid = round((ref_mid + web_med) / 2.0, 2)

    variance_pct = 0.0
    if ref_mid > 0 and proposed_unit_price_usd > 0:
        variance_pct = round(((proposed_unit_price_usd - ref_mid) / ref_mid) * 100.0, 1)

    status = "acorde_al_mercado"
    is_abusive_overprice = False
    if proposed_unit_price_usd > ref_high * 1.65 or variance_pct >= 85.0:
        status = "sobrecosto_abusivo"
        is_abusive_overprice = True
    elif proposed_unit_price_usd > ref_high * 1.20 or variance_pct >= 35.0:
        status = "precio_elevado"
    elif proposed_unit_price_usd < ref_low * 0.65:
        status = "sospechosamente_bajo"

    return {
        "item": item_description[:140],
        "query": query,
        "provider": search_provider,
        "proposed_unit_price_usd": round(proposed_unit_price_usd, 2),
        "market_reference_low_usd": ref_low,
        "market_reference_mid_usd": ref_mid,
        "market_reference_high_usd": ref_high,
        "reference_label": ref_label,
        "variance_pct": variance_pct,
        "status": status,
        "is_abusive_overprice": is_abusive_overprice,
        "sources": sources[:3],
    }
