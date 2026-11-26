"""Agentic Tool Registry and deterministic proposal parser fallback."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Supplier, SupplierAlert
from app.services.agent.technical_audit import audit_proposal_technically
from app.services.finance.bcv import get_active_bcv_rate
from app.services.finance.tco import compute_tco_breakdown, verify_arithmetic
from app.services.market.search import search_market_price


def _parse_money(raw: str) -> float:
    cleaned = raw.replace("$", "").replace(",", "").replace(" ", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


_CHAT_APP_PREFIX_RE = re.compile(
    r"^\s*(?:microsoft\s+teams|rocket\.?chat|whatsapp(?:\s+business)?|slack|telegram|mensajes?\s+sms|sms)"
    r"\s*(?:#\S+)?\s*[•·|:-]?\s*",
    re.I,
)
_RIF_SUFFIX_RE = re.compile(r"\s*[+•·|,]?\s*\bRIF\b.*$", re.I)
_COMPANY_SUFFIX_RE = re.compile(r"\b(?:C\.\s?A\.?|S\.\s?A\.?|S\.R\.L\.?)\s*$", re.I)


def clean_supplier_name(raw: str | None) -> str | None:
    """Normalize supplier names extracted from headers of chats, scans or spreadsheets.

    Removes chat application banners ("Microsoft Teams #canal", "Rocket.Chat #canal"),
    trailing RIF fragments ("+ RIF J-..."), and the contact person when the header
    follows the "Persona — Empresa C.A." pattern. All-caps names are title-cased.
    """
    if not raw:
        return raw
    name = re.sub(r"\s+", " ", str(raw)).strip()
    name = _CHAT_APP_PREFIX_RE.sub("", name)
    name = _RIF_SUFFIX_RE.sub("", name).strip(" -—–|•·+,")
    segments = [seg.strip() for seg in re.split(r"\s+[—–]\s+|\s+-\s+", name) if seg.strip()]
    if len(segments) > 1:
        company = [seg for seg in segments if _COMPANY_SUFFIX_RE.search(seg)]
        if company:
            name = company[-1]
    if name.isupper():
        name = re.sub(r"\bC\.a\.", "C.A.", name.title())
        name = re.sub(r"\bS\.a\.", "S.A.", name)
    return name or raw


def extract_proposal_structured_heuristic(identifier: str, text: str) -> dict[str, Any]:
    """Deterministic fallback parser extracting supplier, items, shipping, install, and declared total."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Supplier name: prefer explicit text, fallback to filename identifier
    supplier_name = identifier.replace("_", " ")
    m_emp = re.search(r"Empresa:\s*([^\n(]+)", text, re.I)
    if m_emp:
        supplier_name = m_emp.group(1).strip()
    elif lines:
        m_xlsx = re.search(r"COTIZACI[ÓO]N\s*[—–-]\s*([^(\n|]+)", lines[0], re.I)
        if m_xlsx:
            supplier_name = m_xlsx.group(1).strip()
        elif "C.A." in lines[0] or "S.A." in lines[0]:
            supplier_name = re.sub(r"COTIZACI[ÓO]N.*$", "", lines[0], flags=re.I).strip(" —–-|•")
        else:
            m_ca = re.search(r"([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9&×\s\.]{3,60}C\.A\.)", text)
            if m_ca:
                supplier_name = m_ca.group(1).strip()

    supplier_name = clean_supplier_name(supplier_name) or supplier_name

    rif_match = re.search(r"\b([JVEGP]-\d{6,9}-\d)\b", text, re.I)
    supplier_rif = rif_match.group(1).upper() if rif_match else None

    rep_match = re.search(r"(?:Rep\.|Representante)[:\s]*([^\n|]{3,60})", text, re.I)
    representative = rep_match.group(1).strip(" |") if rep_match else None

    phone_match = re.search(r"(\+58\s*\d{3}[-\s]?\d{7}|\+58\d{10})", text)
    phone = phone_match.group(1).strip() if phone_match else None

    email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", text)
    email = email_match.group(1).strip() if email_match else None

    # Currency detection
    currency = "USD"
    if re.search(r"total\s*(?:general)?\s*\(?bs\.?|bol[ií]vares|ves\)?", text, re.I) and "USD" not in text.upper():
        currency = "VES"

    # Declared Total extraction
    declared_total = 0.0
    total_patterns = [
        r"TOTAL\s+GENERAL\s*(?:\(USD\))?\s*[:\|]?\s*(?:USD\s*)?\$?\s*([0-9][0-9,\.]+)",
        r"TOTAL\s*[:\|]\s*(?:USD\s*)?\$?\s*([0-9][0-9,\.]+)",
        r"E15:\s*([0-9]+(?:\.[0-9]+)?)",
    ]
    for pat in total_patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = _parse_money(m.group(1))
            if val > 100:
                declared_total = val
                break

    # Extract key line items (Students, Teacher, Shipping, Installation, Optional Services)
    line_items: list[dict[str, Any]] = []

    # 1. Student workstations (10x)
    student_unit = 0.0
    student_sub = None
    student_spec = "Estación Estudiantes (10x)"
    m_st_xlsx = re.search(r"A8:\s*(.*?)\s*\|\s*B8:\s*(.*?)\s*\|\s*C8:\s*(\d+)\s*\|\s*D8:\s*([0-9\.]+)", text)
    if m_st_xlsx:
        student_spec = f"{m_st_xlsx.group(1).strip()} — {m_st_xlsx.group(2).strip()}"
        qty_s = float(m_st_xlsx.group(3))
        student_unit = float(m_st_xlsx.group(4))
        student_sub = qty_s * student_unit
        line_items.append(
            {
                "description": student_spec[:180],
                "quantity": qty_s,
                "unit_price": student_unit,
                "declared_subtotal": student_sub,
                "category": "estaciones_estudiantes",
            }
        )
    else:
        m_st_pdf = re.search(
            r"Estaci[oó]n\s+Estudiantes.*?\b10\s+\$([0-9,\.]+)\s+\$([0-9,\.]+)", text, re.I | re.S
        )
        m_st_chat = re.search(
            r"(?:Estudiantes\s*\(10x\)|10\s*PCs?\s*Estudiantes)[^\$]{0,300}\$\s*([0-9,\.]+)", text, re.I | re.S
        )
        if m_st_pdf:
            student_unit = _parse_money(m_st_pdf.group(1))
            student_sub = _parse_money(m_st_pdf.group(2))
            line_items.append(
                {
                    "description": "Estación Estudiantes (10x)",
                    "quantity": 10,
                    "unit_price": student_unit,
                    "declared_subtotal": student_sub,
                    "category": "estaciones_estudiantes",
                }
            )
        elif m_st_chat:
            student_unit = _parse_money(m_st_chat.group(1))
            line_items.append(
                {
                    "description": "Estación Estudiantes (10x)",
                    "quantity": 10,
                    "unit_price": student_unit,
                    "declared_subtotal": None,
                    "category": "estaciones_estudiantes",
                }
            )

    # 2. Teacher workstation (1x)
    m_doc_xlsx = re.search(r"A9:\s*(.*?)\s*\|\s*B9:\s*(.*?)\s*\|\s*C9:\s*(\d+)\s*\|\s*D9:\s*([0-9\.]+)", text)
    if m_doc_xlsx:
        qty_d = float(m_doc_xlsx.group(3))
        unit_d = float(m_doc_xlsx.group(4))
        line_items.append(
            {
                "description": f"{m_doc_xlsx.group(1).strip()} — {m_doc_xlsx.group(2).strip()}"[:180],
                "quantity": qty_d,
                "unit_price": unit_d,
                "declared_subtotal": qty_d * unit_d,
                "category": "estacion_docente",
            }
        )
    else:
        m_doc_pdf = re.search(
            r"Estaci[oó]n\s+Docente.*?\b1\s+\$([0-9,\.]+)\s+\$([0-9,\.]+)", text, re.I | re.S
        )
        m_doc_chat = re.search(
            r"(?:Docente\s*\(1x\)|1\s*PC\s*Docente)[^\$]{0,260}\$\s*([0-9,\.]+)", text, re.I | re.S
        )
        if m_doc_pdf:
            line_items.append(
                {
                    "description": "Estación Docente (1x)",
                    "quantity": 1,
                    "unit_price": _parse_money(m_doc_pdf.group(1)),
                    "declared_subtotal": _parse_money(m_doc_pdf.group(2)),
                    "category": "estacion_docente",
                }
            )
        elif m_doc_chat:
            line_items.append(
                {
                    "description": "Estación Docente (1x)",
                    "quantity": 1,
                    "unit_price": _parse_money(m_doc_chat.group(1)),
                    "declared_subtotal": None,
                    "category": "estacion_docente",
                }
            )

    # 3. Shipping / Envío
    shipping_cost = 0.0
    m_ship_xlsx = re.search(r"Env[ií]o[^\n]*?\|\s*C\d+:\s*1\s*\|\s*D\d+:\s*([0-9\.]+)", text, re.I)
    m_ship_gen = re.search(r"Env[ií]o(?:\s+y\s+Log[ií]stica)?[^\$]{0,90}\$\s*([0-9,\.]+)", text, re.I)
    if m_ship_xlsx:
        shipping_cost = float(m_ship_xlsx.group(1))
    elif m_ship_gen:
        shipping_cost = _parse_money(m_ship_gen.group(1))
    if shipping_cost > 0:
        line_items.append(
            {
                "description": "Envío y Logística",
                "quantity": 1,
                "unit_price": shipping_cost,
                "declared_subtotal": shipping_cost,
                "category": "envio",
            }
        )

    # 4. Installation / Instalación
    install_cost = 0.0
    m_inst_xlsx = re.search(r"Instalaci[oóeé]n[^\n]*?\|\s*C\d+:\s*1\s*\|\s*D\d+:\s*([0-9\.]+)", text, re.I)
    m_inst_gen = re.search(
        r"(?:Instalaci[oóeé]n(?:\s+y\s+Verificaci[oó]n)?|Inst\.)[^\$]{0,90}\$\s*([0-9,\.]+)", text, re.I
    )
    if m_inst_xlsx:
        install_cost = float(m_inst_xlsx.group(1))
    elif m_inst_gen:
        install_cost = _parse_money(m_inst_gen.group(1))
    if install_cost > 0:
        line_items.append(
            {
                "description": "Instalación y Verificación en sitio",
                "quantity": 1,
                "unit_price": install_cost,
                "declared_subtotal": install_cost,
                "category": "instalacion",
            }
        )

    # 5. Optional services (e.g., Capacitación docente $550)
    m_opt = re.search(r"Servicios\s+Opcionales[^\$]{0,100}\$\s*([0-9,\.]+)", text, re.I)
    if m_opt:
        opt_val = _parse_money(m_opt.group(1))
        if opt_val > 0:
            line_items.append(
                {
                    "description": "Servicios Opcionales",
                    "quantity": 1,
                    "unit_price": opt_val,
                    "declared_subtotal": opt_val,
                    "category": "opcional",
                }
            )

    # Detect hidden shipping surcharge percentage or excluded shipping
    shipping_included = not bool(re.search(r"no\s+incluye\s+(flete|env[ií]o|traslado)", text, re.I))
    hidden_pct = 0.0
    m_pct = re.search(r"(?:recargo|env[ií]o\s+especializado|flete)[^\n\.]{0,50}?(\d{2,3})\s*%", text, re.I)
    if m_pct:
        hidden_pct = float(m_pct.group(1))

    payment_surcharge_pct = 4.0 if re.search(r"\+\s*4\s*%", text) else 0.0
    iva_applies = bool(re.search(r"no\s+incluye\s+iva|\+\s*iva|iva\s*\(16%\)\s*no\s+incluido", text, re.I))

    return {
        "supplier_name": supplier_name,
        "supplier_rif": supplier_rif,
        "representative": representative,
        "phone": phone,
        "email": email,
        "currency": currency,
        "declared_total": declared_total,
        "shipping_cost": shipping_cost,
        "shipping_included_in_total": shipping_included,
        "installation_cost": install_cost,
        "installation_included_in_total": True,
        "hidden_surcharge_flat": 0.0,
        "hidden_surcharge_pct": hidden_pct,
        "payment_surcharge_pct": payment_surcharge_pct,
        "iva_applies": iva_applies,
        "iva_included": not iva_applies,
        "line_items": line_items,
        "student_pc_count": 10 if any(i["category"] == "estaciones_estudiantes" for i in line_items) else 0,
        "teacher_pc_count": 1 if any(i["category"] == "estacion_docente" for i in line_items) else 0,
    }


class AgentToolbox:
    """Structured tool-calling dispatcher for the autonomous procurement evaluation agent."""

    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db

    async def tool_get_bcv_exchange_rate(self) -> dict[str, Any]:
        info = await get_active_bcv_rate(self.db)
        return {
            "usd_to_ves": info.usd_to_ves,
            "source": info.source,
            "fetched_at": info.fetched_at.isoformat(),
            "is_manual_override": info.is_manual_override,
        }

    def tool_verify_arithmetic(
        self, line_items: list[dict[str, Any]], declared_total: float
    ) -> dict[str, Any]:
        res = verify_arithmetic(line_items=line_items, declared_total=declared_total)
        return {
            "is_valid": res.is_valid,
            "declared_total": res.declared_total,
            "computed_total": res.computed_total,
            "discrepancy": res.discrepancy,
            "errors": res.errors,
            "items": [
                {
                    "description": a.description,
                    "quantity": a.quantity,
                    "unit_price": a.unit_price,
                    "declared_subtotal": a.declared_subtotal,
                    "computed_subtotal": a.computed_subtotal,
                    "is_consistent": a.is_consistent,
                    "discrepancy": a.discrepancy,
                    "category": a.category,
                }
                for a in res.item_audits
            ],
        }

    def tool_compute_tco(self, **kwargs: Any) -> dict[str, Any]:
        return compute_tco_breakdown(**kwargs)

    def tool_check_hardware_compatibility(
        self,
        raw_text: str,
        structured: dict[str, Any],
        project_requirements_text: str,
    ) -> dict[str, Any]:
        res = audit_proposal_technically(
            raw_text=raw_text,
            structured=structured,
            project_requirements_text=project_requirements_text,
        )
        return {
            "is_technically_valid": res.is_technically_valid,
            "discard_reasons": res.discard_reasons,
            "technical_findings": res.technical_findings,
            "fine_print_findings": res.fine_print_findings,
            "technical_score": res.technical_score,
            "score_breakdown": res.score_breakdown,
        }

    async def tool_web_search_market_prices(
        self,
        item_description: str,
        proposed_unit_price_usd: float,
        enable_web: bool | None = None,
    ) -> dict[str, Any]:
        return await search_market_price(
            item_description=item_description,
            proposed_unit_price_usd=proposed_unit_price_usd,
            enable_web=enable_web,
        )

    async def tool_check_supplier_history(
        self, supplier_name: str | None, supplier_rif: str | None
    ) -> dict[str, Any]:
        if self.db is None or (not supplier_name and not supplier_rif):
            return {"found": False, "alerts": []}

        supplier = None
        if supplier_rif:
            res = await self.db.execute(select(Supplier).where(Supplier.rif == supplier_rif))
            supplier = res.scalar_one_or_none()
        if supplier is None and supplier_name:
            res = await self.db.execute(select(Supplier).where(Supplier.name == supplier_name))
            supplier = res.scalar_one_or_none()

        if supplier is None:
            return {"found": False, "alerts": []}

        alerts_res = await self.db.execute(
            select(SupplierAlert).where(SupplierAlert.supplier_id == supplier.id)
        )
        alerts = alerts_res.scalars().all()
        return {
            "found": True,
            "supplier_id": supplier.id,
            "supplier_name": supplier.name,
            "rif": supplier.rif,
            "alerts_count": len(alerts),
            "alerts": [
                {
                    "severity": a.severity,
                    "reason_code": a.reason_code,
                    "summary": a.summary,
                    "created_at": a.created_at.isoformat(),
                }
                for a in alerts
            ],
        }
