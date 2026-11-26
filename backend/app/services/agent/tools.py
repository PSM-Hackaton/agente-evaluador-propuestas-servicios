"""Agentic Tool Registry and generalized deterministic proposal parser fallback."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import blind_index
from app.db.models import DiscardReasonCode, Project, Supplier, SupplierAlert
from app.services.agent.technical_audit import audit_proposal_technically
from app.services.finance.bcv import get_active_bcv_rate
from app.services.finance.tco import compute_tco_breakdown, verify_arithmetic
from app.services.market.search import search_market_price


def _parse_money(raw: str) -> float:
    cleaned = re.sub(r"[^0-9.,-]", "", str(raw or ""))
    if cleaned.count(",") and cleaned.count("."):
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(",") == 1 and len(cleaned.split(",")[1]) in (1, 2):
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
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
_XLSX_COORD_RE = re.compile(r"^[A-Z]{1,3}\d+:\s*")
_XLSX_FORMULA_RE = re.compile(r"\s*\[f[oó]rmula:[^\]]+\]", re.I)


def clean_supplier_name(raw: str | None) -> str | None:
    """Normalize supplier names extracted from headers of chats, scans or spreadsheets."""
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


def _extract_single_charge(pattern: str, text: str) -> float:
    """Match a shipping/installation/optional fee without crossing into a TOTAL line."""
    for m in re.finditer(pattern, text, re.I | re.S):
        between = m.group(0)[: -len(m.group(1)) - 1]
        if re.search(r"\btotal\b", between, re.I):
            continue
        val = _parse_money(m.group(1))
        if val > 0:
            return val
    return 0.0


def _categorize_item(description: str) -> str:
    low = description.lower()
    if any(k in low for k in ("estudiante", "alumno", "laboratorio", "station", "estación")):
        if "docente" not in low and "profesor" not in low:
            return "estaciones_estudiantes"
    if any(k in low for k in ("docente", "profesor", "instructor")):
        return "estacion_docente"
    if any(k in low for k in ("envío", "envio", "flete", "logística", "logistica", "traslado")):
        return "envio"
    if any(k in low for k in ("instalación", "instalacion", "puesta en marcha", "montaje")):
        return "instalacion"
    if any(k in low for k in ("opcional", "capacitación", "capacitacion", "manual")):
        return "opcional"
    if any(k in low for k in ("software", "sistema operativo", "ubuntu", "linux", "windows")):
        return "software"
    if any(k in low for k in ("periférico", "periferico", "monitor", "teclado", "ups", "regulador")):
        return "perifericos"
    return "item"


def _extract_generic_tabular_items(text: str) -> tuple[list[dict[str, Any]], float]:
    """Parse arbitrary pipe-delimited tables (any XLSX layout, CSV, TSV, DOCX table) into line items."""
    items: list[dict[str, Any]] = []
    detected_total = 0.0

    for raw_line in text.splitlines():
        if "|" not in raw_line:
            continue
        cells = [
            _XLSX_FORMULA_RE.sub("", _XLSX_COORD_RE.sub("", c.strip())).strip()
            for c in raw_line.split("|")
        ]
        cells = [c for c in cells if c]
        if not cells:
            continue

        joined = " ".join(cells)
        joined_low = joined.lower()

        # Total row detection (any cell layout)
        if re.search(r"\btotal\s*(?:general|usd|bs\.?|a\s+pagar)?\b", joined_low) and not re.search(
            r"subtotal|precio\s+unit", joined_low
        ):
            nums = [_parse_money(c) for c in cells if re.fullmatch(r"[\$USD\s]*[0-9][0-9,\.]*", c, re.I)]
            nums = [n for n in nums if n > 0]
            if nums:
                detected_total = max(nums)
            continue

        # Skip header/metadata rows
        if any(h in joined_low for h in ("precio unit", "cant.", "cantidad", "subtotal", "especificación", "descripción")):
            if sum(1 for c in cells if re.fullmatch(r"[\$\s]*[0-9][0-9,\.]*", c)) == 0:
                continue

        # Identify numeric cells and text description cells
        text_cells: list[str] = []
        numeric_vals: list[float] = []
        for c in cells:
            clean_c = c.replace("$", "").replace("USD", "").strip()
            if re.fullmatch(r"-?[0-9][0-9,\.]*", clean_c):
                numeric_vals.append(_parse_money(c))
            elif len(c) > 2:
                text_cells.append(c)

        if not text_cells or len(numeric_vals) < 2:
            continue

        desc = " — ".join(text_cells)[:220]
        cat = _categorize_item(desc)
        # Convention: (qty, unit_price, [subtotal])
        qty = numeric_vals[0]
        unit_p = numeric_vals[1]
        sub_p = numeric_vals[2] if len(numeric_vals) >= 3 else None

        # Guard against metadata rows where first number is not a reasonable quantity
        if qty <= 0 or qty > 500 or unit_p < 0:
            continue
        if unit_p == 0 and (sub_p is None or sub_p == 0):
            continue

        items.append(
            {
                "description": desc,
                "quantity": qty,
                "unit_price": unit_p,
                "declared_subtotal": sub_p,
                "category": cat,
            }
        )

    return items, detected_total


def _extract_generic_line_items(text: str) -> list[dict[str, Any]]:
    """Fallback line parser for free-form PDF/TXT/chat quotes with `<qty> ... $<unit>` patterns."""
    items: list[dict[str, Any]] = []
    # Match lines or clauses like: "10 equipos ... $1,200 c/u" or "10 x Estación ... $1,200.00 | $12,000.00"
    pattern = re.compile(
        r"(?:^|\n)\s*(?:[-•*\d\)]+\s*)?(?P<label>[^\n\$]{4,140}?)\b(?P<qty>\d{1,3})\s*(?:x|pcs?|equipos?|estaciones?|unidades?)?"
        r"[^\n\$]{0,180}?\$\s*(?P<unit>[0-9][0-9,\.]+)(?:\s*(?:c/u|cada\s+uno|unit\.?))?"
        r"(?:\s*[|\s]+\$\s*(?P<sub>[0-9][0-9,\.]+))?",
        re.I,
    )
    for m in pattern.finditer(text):
        label = re.sub(r"\s+", " ", m.group("label")).strip(" :-—–•")
        if re.search(r"total\s*general|rif|fecha|validez|garant[ií]a", label, re.I):
            continue
        qty = float(m.group("qty"))
        unit_p = _parse_money(m.group("unit"))
        sub_raw = m.group("sub")
        sub_p = _parse_money(sub_raw) if sub_raw else None
        if qty <= 0 or qty > 200 or unit_p <= 0:
            continue
        items.append(
            {
                "description": label[:180],
                "quantity": qty,
                "unit_price": unit_p,
                "declared_subtotal": sub_p,
                "category": _categorize_item(label),
            }
        )
    return items


def extract_proposal_structured_heuristic(identifier: str, text: str) -> dict[str, Any]:
    """Generalized deterministic fallback parser extracting supplier, items, shipping, install, and total."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Supplier name: prefer explicit text, fallback to filename identifier
    supplier_name = identifier.replace("_", " ")
    m_emp = re.search(r"(?:Empresa|Proveedor|Raz[oó]n\s+Social)\s*:\s*([^\n(]+)", text, re.I)
    if m_emp:
        supplier_name = m_emp.group(1).strip()
    elif lines:
        m_xlsx = re.search(r"COTIZACI[ÓO]N\s*[—–-]\s*([^(\n|]+)", lines[0], re.I)
        if m_xlsx:
            supplier_name = m_xlsx.group(1).strip()
        elif any(sfx in lines[0].upper() for sfx in ("C.A.", "S.A.", "S.R.L.")):
            supplier_name = re.sub(r"COTIZACI[ÓO]N.*$", "", lines[0], flags=re.I).strip(" —–-|•")
        else:
            m_ca = re.search(r"([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9&×\s\.]{3,60}(?:C\.A\.|S\.A\.|S\.R\.L\.))", text)
            if m_ca:
                supplier_name = m_ca.group(1).strip()

    supplier_name = clean_supplier_name(supplier_name) or supplier_name

    rif_match = re.search(r"\b([JVEGP]-\d{6,9}-\d)\b", text, re.I)
    supplier_rif = rif_match.group(1).upper() if rif_match else None

    rep_match = re.search(r"(?:Rep\.|Representante|Contacto)\s*[:\s]*([^\n|]{3,60})", text, re.I)
    representative = rep_match.group(1).strip(" |") if rep_match else None

    phone_match = re.search(r"(\+58\s*\d{3}[-\s]?\d{7}|\+58\d{10})", text)
    phone = phone_match.group(1).strip() if phone_match else None

    email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", text)
    email = email_match.group(1).strip() if email_match else None

    # Currency detection
    currency = "USD"
    if re.search(r"total\s*(?:general)?\s*\(?bs\.?|bol[ií]vares|ves\)?", text, re.I) and "USD" not in text.upper():
        currency = "VES"

    # Generic tabular parser first (works for any XLSX/CSV/TSV/DOCX layout)
    tabular_items, tabular_total = _extract_generic_tabular_items(text)

    # Declared Total extraction
    declared_total = tabular_total
    if declared_total <= 0:
        for pat in (
            r"TOTAL\s+GENERAL\s*(?:\((?:USD|VES|Bs\.?)\))?\s*[:\|]?\s*(?:USD\s*|Bs\.?\s*)?\$?\s*([0-9][0-9,\.]+)",
            r"TOTAL\s*(?:A\s+PAGAR)?\s*[:\|]\s*(?:USD\s*|Bs\.?\s*)?\$?\s*([0-9][0-9,\.]+)",
        ):
            m = re.search(pat, text, re.I)
            if m:
                val = _parse_money(m.group(1))
                if val > 50:
                    declared_total = val
                    break

    # Extract line items: prefer tabular extraction when it captured stations; otherwise merge/parse prose & chats
    line_items: list[dict[str, Any]] = list(tabular_items)
    if not any(i["category"] in ("estaciones_estudiantes", "estacion_docente") for i in line_items):
        # Structured prose / PDF / chat extraction
        m_st_pdf = re.search(
            r"Estaci[oó]n\s+Estudiantes.*?\b(\d{1,3})\s+\$([0-9,\.]+)\s+\$([0-9,\.]+)", text, re.I | re.S
        )
        m_st_chat = re.search(
            r"(?:Estudiantes\s*\((\d{1,3})x?\)|(\d{1,3})\s*(?:PCs?|equipos?|computadoras?)\s*Estudiantes?)[^\$]{0,300}\$\s*([0-9,\.]+)",
            text,
            re.I | re.S,
        )
        if m_st_pdf:
            qty_s = float(m_st_pdf.group(1))
            unit_s = _parse_money(m_st_pdf.group(2))
            sub_s = _parse_money(m_st_pdf.group(3))
            line_items.append(
                {
                    "description": f"Estación Estudiantes ({int(qty_s)}x)",
                    "quantity": qty_s,
                    "unit_price": unit_s,
                    "declared_subtotal": sub_s,
                    "category": "estaciones_estudiantes",
                }
            )
        elif m_st_chat:
            qty_s = float(m_st_chat.group(1) or m_st_chat.group(2) or 10)
            unit_s = _parse_money(m_st_chat.group(3))
            line_items.append(
                {
                    "description": f"Estación Estudiantes ({int(qty_s)}x)",
                    "quantity": qty_s,
                    "unit_price": unit_s,
                    "declared_subtotal": None,
                    "category": "estaciones_estudiantes",
                }
            )

        m_doc_pdf = re.search(
            r"Estaci[oó]n\s+Docente.*?\b(\d{1,2})\s+\$([0-9,\.]+)\s+\$([0-9,\.]+)", text, re.I | re.S
        )
        m_doc_chat = re.search(
            r"(?:Docente\s*\((\d{1,2})x?\)|(\d{1,2})\s*(?:PC|equipo|computadora)\s*Docente)[^\$]{0,260}\$\s*([0-9,\.]+)",
            text,
            re.I | re.S,
        )
        if m_doc_pdf:
            qty_d = float(m_doc_pdf.group(1))
            line_items.append(
                {
                    "description": f"Estación Docente ({int(qty_d)}x)",
                    "quantity": qty_d,
                    "unit_price": _parse_money(m_doc_pdf.group(2)),
                    "declared_subtotal": _parse_money(m_doc_pdf.group(3)),
                    "category": "estacion_docente",
                }
            )
        elif m_doc_chat:
            qty_d = float(m_doc_chat.group(1) or m_doc_chat.group(2) or 1)
            line_items.append(
                {
                    "description": f"Estación Docente ({int(qty_d)}x)",
                    "quantity": qty_d,
                    "unit_price": _parse_money(m_doc_chat.group(3)),
                    "declared_subtotal": None,
                    "category": "estacion_docente",
                }
            )

        # Generic fallback if still empty
        if not line_items:
            line_items = _extract_generic_line_items(text)

    # Extract shipping, installation, optional if not already captured by tabular parser
    shipping_cost = sum(float(i["unit_price"]) * float(i["quantity"]) for i in line_items if i["category"] == "envio")
    if shipping_cost == 0.0:
        shipping_cost = _extract_single_charge(
            r"(?:Env[ií]o(?:\s+y\s+Log[ií]stica)?|Flete|Traslado)[^\$\n|]{0,40}:\s*\$\s*([0-9,\.]+)",
            text,
        ) or _extract_single_charge(
            r"(?:Env[ií]o(?:\s+y\s+Log[ií]stica)?|Flete|Traslado)[^\$]{0,80}?\$\s*([0-9,\.]+)",
            text,
        )
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

    install_cost = sum(float(i["unit_price"]) * float(i["quantity"]) for i in line_items if i["category"] == "instalacion")
    if install_cost == 0.0:
        install_cost = _extract_single_charge(
            r"(?:Instalaci[oóeé]n(?:\s+y\s+Verificaci[oó]n)?|Inst\.)[^\$\n|]{0,40}:\s*\$\s*([0-9,\.]+)",
            text,
        ) or _extract_single_charge(
            r"(?:Instalaci[oóeé]n(?:\s+y\s+Verificaci[oó]n)?|Inst\.)[^\$]{0,80}?\$\s*([0-9,\.]+)",
            text,
        )
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

    if not any(i["category"] == "opcional" for i in line_items):
        opt_val = _extract_single_charge(r"Servicios\s+Opcionales[^\$]{0,90}?\$\s*([0-9,\.]+)", text)
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

    shipping_included = not bool(re.search(r"no\s+incluye\s+(flete|env[ií]o|traslado)", text, re.I))
    hidden_pct = 0.0
    m_pct = re.search(r"(?:recargo|env[ií]o\s+especializado|flete)[^\n\.]{0,50}?(\d{2,3})\s*%", text, re.I)
    if m_pct:
        hidden_pct = float(m_pct.group(1))

    payment_surcharge_pct = 4.0 if re.search(r"\+\s*4\s*%", text) else 0.0
    iva_applies = bool(re.search(r"no\s+incluye\s+iva|\+\s*iva|iva\s*\(16%\)\s*no\s+incluido", text, re.I))

    student_count = int(
        sum(float(i["quantity"]) for i in line_items if i["category"] == "estaciones_estudiantes")
    )
    teacher_count = int(
        sum(float(i["quantity"]) for i in line_items if i["category"] == "estacion_docente")
    )

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
        "student_pc_count": student_count,
        "teacher_pc_count": teacher_count,
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
            return {"found": False, "alerts": [], "has_prior_prompt_injection": False}

        supplier = None
        rif_h = blind_index(supplier_rif)
        name_h = blind_index(supplier_name)
        if rif_h:
            res = await self.db.execute(select(Supplier).where(Supplier.rif_hash == rif_h))
            supplier = res.scalar_one_or_none()
        if supplier is None and name_h:
            res = await self.db.execute(select(Supplier).where(Supplier.name_hash == name_h))
            supplier = res.scalar_one_or_none()

        if supplier is None:
            return {"found": False, "alerts": [], "has_prior_prompt_injection": False}

        alerts_res = await self.db.execute(
            select(SupplierAlert, Project.name)
            .outerjoin(Project, SupplierAlert.project_id == Project.id)
            .where(SupplierAlert.supplier_id == supplier.id)
            .order_by(SupplierAlert.created_at.desc())
        )
        rows = alerts_res.all()
        formatted_alerts = []
        has_prior_injection = False
        for alert, proj_name in rows:
            if not alert.is_resolved and alert.reason_code == DiscardReasonCode.INYECCION_PROMPT.value:
                has_prior_injection = True
            created_iso = alert.created_at.isoformat()
            formatted_alerts.append(
                {
                    "id": alert.id,
                    "severity": alert.severity,
                    "reason_code": alert.reason_code,
                    "summary": alert.summary,
                    "project_id": alert.project_id,
                    "project_name": proj_name or "Proyecto anterior",
                    "is_resolved": bool(alert.is_resolved),
                    "created_at": created_iso,
                    "date": created_iso[:10],
                }
            )
        return {
            "found": True,
            "supplier_id": supplier.id,
            "supplier_name": supplier.name,
            "rif": supplier.rif,
            "alerts_count": len(formatted_alerts),
            "has_prior_prompt_injection": has_prior_injection,
            "alerts": formatted_alerts,
        }
