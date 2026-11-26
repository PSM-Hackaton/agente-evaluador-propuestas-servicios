"""Autonomous Web Search & Market Price Benchmarking (Section 2.C — Issue #11 R3-B3)."""

from __future__ import annotations

import asyncio
import logging
import re
import ssl
import time
from datetime import UTC, datetime
from statistics import median
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PRICE_RE = re.compile(r"\$\s*([0-9]{2,5}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)")

# In-memory TTL cache for web searches (query -> (timestamp, sources, provider))
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]], str]] = {}
_CACHE_TTL_SECONDS = 1800.0

# Last-resort baseline reference ranges (USD) used ONLY when web search is disabled or yields 0 priced sources
BASELINE_MARKET_REFERENCES: list[tuple[str, tuple[float, float], str]] = [
    ("rtx 4070 super", (1800.0, 2900.0), "Workstation gama alta RTX 4070 Super completa + periféricos"),
    ("rtx 4070", (1600.0, 2650.0), "Workstation gama alta RTX 4070 completa + periféricos"),
    ("rtx 4060 ti", (1350.0, 2250.0), "Workstation media-alta RTX 4060 Ti completa + periféricos"),
    ("rtx 4060", (1050.0, 1850.0), "PC media-alta RTX 4060 completa + monitor + protección"),
    ("rtx 3060", (950.0, 1750.0), "PC media-alta RTX 3060 12GB completa + monitor + UPS"),
    ("rx 7600", (950.0, 1750.0), "PC media-alta RX 7600 completa + monitor + protección"),
    ("xeon e5", (350.0, 650.0), "Kit Xeon E5-2680/2690 v4 (arquitectura 2016 reciclada) mercado secundario"),
]

_SENSITIVE_PATTERNS = (
    re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),  # emails
    re.compile(r"\b[JVEGP]-?\d{6,9}-?\d\b", re.I),  # RIF / ID
    re.compile(r"\+?\d[\d\s().-]{8,}\d"),  # phones & accounts
    re.compile(r"\b(?:RIF|Rep\.?|Representante|Cliente|Destino|Fecha|Validez|REF|COT)[^|\n]*", re.I),
)


def _strip_sensitive_data(text: str) -> str:
    """Remove supplier/client identifiers before sending a query to an external search engine (Section F)."""
    clean = text
    for pat in _SENSITIVE_PATTERNS:
        clean = pat.sub(" ", clean)
    return re.sub(r"\s+", " ", clean).strip()


def _build_focused_query(item_description: str) -> str:
    """Extract clean hardware/component/service terms for precision web pricing queries."""
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

    # Standalone peripherals / UPS / monitors / components
    for pat, suffix in (
        (r"(?:asus\s+proart|lg\s+ultragear|aoc|samsung)[^\n|,]{0,45}?\d{2}\"?[^\n|,]{0,20}", "monitor price USD"),
        (r"(?:cyberpower|apc|forza|tripp\s*lite)[^\n|,]{0,45}?\d{3,4}\s*va", "UPS price USD"),
        (r"(?:monitor|ups|regulador)[^\n|,]{0,45}", "price USD"),
    ):
        m = re.search(pat, item_description, re.I)
        if m:
            clean_tok = _strip_sensitive_data(m.group(0))
            return f"{clean_tok[:70]} {suffix}".strip()

    clean = _strip_sensitive_data(item_description)
    return f"{clean[:80]} price USD"


def _extract_prices_from_text(text: str) -> list[float]:
    prices: list[float] = []
    for m in _PRICE_RE.findall(text):
        try:
            val = float(m.replace(",", ""))
            if 20.0 <= val <= 20000.0:
                prices.append(round(val, 2))
        except ValueError:
            continue
    return prices


async def _search_tavily(query: str, api_key: str) -> list[dict[str, Any]]:
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()
    async with httpx.AsyncClient(timeout=12.0, verify=ctx) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": 5,
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            out: list[dict[str, Any]] = []
            for r in data.get("results", []):
                title = str(r.get("title", ""))
                snippet = str(r.get("content", ""))[:300]
                prices = _extract_prices_from_text(f"{title} {snippet}")
                out.append(
                    {
                        "title": title,
                        "url": str(r.get("url", "")),
                        "snippet": snippet,
                        "extracted_price_usd": median(prices) if prices else None,
                        "retrieved_at": now_iso,
                    }
                )
            return out
    return []


async def _search_ddgs(query: str) -> list[dict[str, Any]]:
    now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()

    def _run() -> list[dict[str, Any]]:
        from ddgs import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
            out: list[dict[str, Any]] = []
            for r in results:
                title = str(r.get("title", ""))
                snippet = str(r.get("body", ""))[:300]
                prices = _extract_prices_from_text(f"{title} {snippet}")
                out.append(
                    {
                        "title": title,
                        "url": str(r.get("href", "")),
                        "snippet": snippet,
                        "extracted_price_usd": median(prices) if prices else None,
                        "retrieved_at": now_iso,
                    }
                )
            return out

    return await asyncio.wait_for(asyncio.to_thread(_run), timeout=20.0)


def _baseline_reference(item_spec: str) -> tuple[float, float, str] | None:
    low = item_spec.lower()
    for keyword, (lo, hi), label in BASELINE_MARKET_REFERENCES:
        if keyword in low:
            return lo, hi, label
    return None


def extract_market_searchable_items(
    raw_text: str,
    line_items: list[dict[str, Any]],
    spec_context_fn: Any = None,
    max_items: int = 4,
) -> list[dict[str, Any]]:
    """Select primary workstations plus priced peripherals/components/services for market benchmarking."""
    candidates: list[dict[str, Any]] = []
    seen_queries: set[str] = set()

    prioritized = [
        it
        for it in line_items
        if it.get("category") in ("estaciones_estudiantes", "estacion_docente")
        and float(it.get("unit_price") or 0) > 0
    ]
    secondary = [
        it
        for it in line_items
        if it.get("category") not in ("estaciones_estudiantes", "estacion_docente", "envio", "instalacion", "opcional", "software")
        and float(it.get("unit_price") or 0) > 40
    ]
    logistics = [
        it
        for it in line_items
        if it.get("category") in ("envio", "instalacion")
        and float(it.get("unit_price") or 0) > 50
    ]

    for item in [*prioritized, *secondary, *logistics]:
        unit_p = float(item.get("unit_price") or 0)
        desc = str(item.get("description") or "")
        if len(desc) < 35 and spec_context_fn is not None:
            ctx = spec_context_fn(raw_text, unit_p)
            if ctx:
                desc = f"{desc} {ctx}".strip()
        q = _build_focused_query(desc).lower()
        if q in seen_queries:
            continue
        seen_queries.add(q)
        candidates.append({"description": desc, "unit_price": unit_p, "category": item.get("category", "item")})
        if len(candidates) >= max_items:
            break

    # If peripherals/UPS were bundled into "$0.00 Incluido", still run informational component checks
    if len(candidates) < max_items and raw_text:
        for pat in (
            r"(?:monitor\s*[:\-]?\s*[^\n|]{8,80})",
            r"(?:protecci[oó]n|ups|regulador)\s*[:\-]?\s*[^\n|]{8,80}",
        ):
            if len(candidates) >= max_items:
                break
            m = re.search(pat, raw_text, re.I)
            if m:
                desc = m.group(0).strip()
                q = _build_focused_query(desc).lower()
                if q not in seen_queries:
                    seen_queries.add(q)
                    candidates.append({"description": desc, "unit_price": 0.0, "category": "componente_referencia"})

    return candidates


async def search_market_price(
    item_description: str,
    proposed_unit_price_usd: float,
    enable_web: bool | None = None,
) -> dict[str, Any]:
    """Web-first market price benchmarking; uses static baseline strictly as last-resort fallback."""
    settings = get_settings()
    do_web = settings.web_search_enabled if enable_web is None else enable_web

    query = _build_focused_query(item_description)
    sources: list[dict[str, Any]] = []
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
            p = src.get("extracted_price_usd")
            if isinstance(p, (int, float)) and p > 0:
                web_prices.append(float(p))

    # Filter out extreme single-component noise if a baseline range exists and web_prices mix parts & full PCs
    baseline = _baseline_reference(item_description)
    if web_prices and baseline:
        b_lo, b_hi, _ = baseline
        plausible_web = [p for p in web_prices if b_lo * 0.45 <= p <= b_hi * 3.0]
        if plausible_web:
            web_prices = plausible_web

    # Web-first pricing: web sources take precedence over fixed baseline
    if web_prices:
        ref_mid = round(median(web_prices), 2)
        ref_low = round(min(web_prices), 2)
        ref_high = round(max(web_prices), 2)
        reference_source_type = "web_market_sources"
        ref_label = f"Promedio/mediana de {len(web_prices)} fuente(s) web consultadas ({search_provider})"
    elif baseline:
        ref_low, ref_high, b_label = baseline
        ref_mid = round((ref_low + ref_high) / 2.0, 2)
        reference_source_type = "baseline_fallback_only"
        ref_label = f"[Respaldo catálogo local — sin precios web] {b_label}"
    else:
        ref_mid = proposed_unit_price_usd if proposed_unit_price_usd > 0 else 0.0
        ref_low = round(ref_mid * 0.75, 2)
        ref_high = round(ref_mid * 1.25, 2)
        reference_source_type = "sin_referencia"
        ref_label = "Sin referencia de mercado verificable (no se identificó el producto ni hubo precios web)"

    variance_pct = 0.0
    if ref_mid > 0 and proposed_unit_price_usd > 0:
        variance_pct = round(((proposed_unit_price_usd - ref_mid) / ref_mid) * 100.0, 1)

    status = "acorde_al_mercado"
    is_abusive_overprice = False
    if reference_source_type == "sin_referencia" or proposed_unit_price_usd <= 0:
        status = "sin_referencia"
    elif variance_pct >= 85.0 or (ref_high > 0 and proposed_unit_price_usd > ref_high * 1.65 and variance_pct >= 50.0):
        status = "sobrecosto_abusivo"
        is_abusive_overprice = True
    elif variance_pct >= 35.0 or (ref_high > 0 and proposed_unit_price_usd > ref_high * 1.20):
        status = "precio_elevado"
    elif ref_low > 0 and proposed_unit_price_usd < ref_low * 0.65:
        status = "sospechosamente_bajo"

    cited_sources = [
        {
            "title": s.get("title", ""),
            "url": s.get("url", ""),
            "extracted_price_usd": s.get("extracted_price_usd"),
            "retrieved_at": s.get("retrieved_at", ""),
            "snippet": s.get("snippet", "")[:180],
        }
        for s in sources[:4]
    ]

    return {
        "item": item_description[:140],
        "query": query,
        "provider": search_provider,
        "reference_source_type": reference_source_type,
        "proposed_unit_price_usd": round(proposed_unit_price_usd, 2),
        "market_reference_low_usd": ref_low,
        "market_reference_mid_usd": ref_mid,
        "market_reference_high_usd": ref_high,
        "reference_label": ref_label,
        "variance_pct": variance_pct,
        "status": status,
        "is_abusive_overprice": is_abusive_overprice,
        "sources": cited_sources,
    }
