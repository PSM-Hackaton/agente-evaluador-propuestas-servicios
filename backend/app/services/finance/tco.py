"""Deterministic Decimal arithmetic verification and TCO / USD-VES financial normalization."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any


def _d(value: float | int | str | Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        cleaned = str(value).replace("$", "").replace("USD", "").replace("Bs", "").replace(",", "").strip()
        if not cleaned:
            return Decimal("0")
        return Decimal(cleaned)
    except Exception:
        return Decimal("0")


def _r2(val: Decimal) -> float:
    return float(val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


@dataclass
class LineItemAudit:
    description: str
    quantity: float
    unit_price: float
    declared_subtotal: float | None
    computed_subtotal: float
    is_consistent: bool
    discrepancy: float
    category: str = "item"


@dataclass
class ArithmeticAuditResult:
    is_valid: bool
    declared_total: float
    computed_total: float
    discrepancy: float
    item_audits: list[LineItemAudit] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def verify_arithmetic(
    line_items: list[dict[str, Any]],
    declared_total: float,
    tolerance: float = 0.05,
) -> ArithmeticAuditResult:
    """Verify qty * unit_price == subtotal for every item and sum(subtotals) == declared_total."""
    tol = _d(tolerance)
    item_audits: list[LineItemAudit] = []
    errors: list[str] = []
    running_sum = Decimal("0")

    for idx, item in enumerate(line_items, start=1):
        desc = str(item.get("description") or item.get("name") or f"Ítem {idx}")
        qty = _d(item.get("quantity", 1))
        unit_price = _d(item.get("unit_price", 0))
        raw_sub = item.get("declared_subtotal")
        declared_sub = _d(raw_sub) if raw_sub is not None else None
        computed_sub = (qty * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        category = str(item.get("category") or "item")

        # If unit_price is 0 and declared_subtotal > 0 (e.g., lump-sum line), respect declared_subtotal
        if unit_price == 0 and declared_sub is not None and declared_sub > 0:
            computed_sub = declared_sub

        running_sum += computed_sub
        discrepancy = Decimal("0")
        consistent = True
        if declared_sub is not None:
            discrepancy = (computed_sub - declared_sub).copy_abs()
            if discrepancy > tol:
                consistent = False
                errors.append(
                    f"Discrepancia en '{desc}': {qty} x ${unit_price:.2f} = ${computed_sub:.2f}, "
                    f"pero declara ${declared_sub:.2f} (diferencia: ${discrepancy:.2f})."
                )

        item_audits.append(
            LineItemAudit(
                description=desc,
                quantity=float(qty),
                unit_price=_r2(unit_price),
                declared_subtotal=_r2(declared_sub) if declared_sub is not None else None,
                computed_subtotal=_r2(computed_sub),
                is_consistent=consistent,
                discrepancy=_r2(discrepancy),
                category=category,
            )
        )

    decl_total_d = _d(declared_total)
    total_discrepancy = (running_sum - decl_total_d).copy_abs() if decl_total_d > 0 else Decimal("0")
    total_ok = True
    if decl_total_d > 0 and line_items and total_discrepancy > tol:
        total_ok = False
        errors.append(
            f"La suma real de subtotales (${running_sum:.2f}) no coincide con el Total General "
            f"declarado (${decl_total_d:.2f}); diferencia de ${total_discrepancy:.2f}."
        )

    return ArithmeticAuditResult(
        is_valid=(total_ok and all(a.is_consistent for a in item_audits)),
        declared_total=_r2(decl_total_d),
        computed_total=_r2(running_sum),
        discrepancy=_r2(total_discrepancy),
        item_audits=item_audits,
        errors=errors,
    )


def compute_tco_breakdown(
    *,
    declared_total: float,
    currency: str,
    bcv_rate: float,
    shipping_included_in_total: bool = True,
    shipping_cost: float = 0.0,
    installation_included_in_total: bool = True,
    installation_cost: float = 0.0,
    hidden_surcharge_flat: float = 0.0,
    hidden_surcharge_pct: float = 0.0,
    iva_applies: bool = False,
    iva_included: bool = True,
    iva_rate: float = 0.16,
    payment_surcharge_pct: float = 0.0,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    """Normalize currency (USD/VES at BCV rate) and build transparent step-by-step TCO breakdown."""
    curr = (currency or "USD").upper()
    rate_d = _d(bcv_rate) if bcv_rate > 0 else Decimal("1")

    def _to_usd(amount: Decimal) -> Decimal:
        if curr in ("VES", "BS", "BS.", "BOLIVARES"):
            return (amount / rate_d).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    decl_orig_d = _d(declared_total)
    decl_usd_d = _to_usd(decl_orig_d)
    ship_usd_d = _to_usd(_d(shipping_cost))
    inst_usd_d = _to_usd(_d(installation_cost))
    extra_flat_usd_d = _to_usd(_d(hidden_surcharge_flat))

    steps: list[dict[str, Any]] = [
        {
            "step": "Monto declarado",
            "original_amount": _r2(decl_orig_d),
            "original_currency": curr,
            "amount_usd": _r2(decl_usd_d),
            "note": f"Convertido a USD con tasa BCV {bcv_rate:.4f} Bs/USD" if curr != "USD" else "Expresado en USD",
        }
    ]

    adjusted = decl_usd_d

    if not shipping_included_in_total and ship_usd_d > 0:
        adjusted += ship_usd_d
        steps.append(
            {
                "step": "Flete / envío excluido en letra pequeña",
                "amount_usd": _r2(ship_usd_d),
                "note": "No estaba incluido en el total general declarado.",
            }
        )

    if not installation_included_in_total and inst_usd_d > 0:
        adjusted += inst_usd_d
        steps.append(
            {
                "step": "Instalación / puesta en marcha no incluida",
                "amount_usd": _r2(inst_usd_d),
                "note": "Requerida por el alcance del proyecto.",
            }
        )

    pct_surcharge_usd_d = Decimal("0")
    if hidden_surcharge_pct > 0:
        pct_surcharge_usd_d = (decl_usd_d * _d(hidden_surcharge_pct) / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        adjusted += pct_surcharge_usd_d
        steps.append(
            {
                "step": f"Recargo porcentual oculto ({hidden_surcharge_pct:.1f}%)",
                "amount_usd": _r2(pct_surcharge_usd_d),
                "note": "Recargo detectado en cláusulas o letra pequeña.",
            }
        )

    if extra_flat_usd_d > 0:
        adjusted += extra_flat_usd_d
        steps.append(
            {
                "step": "Otros costos/recargos adicionales",
                "amount_usd": _r2(extra_flat_usd_d),
                "note": "Costos adicionales identificados fuera del subtotal.",
            }
        )

    pay_surcharge_usd_d = Decimal("0")
    if payment_surcharge_pct > 0 and curr in ("VES", "BS", "BS.", "BOLIVARES"):
        pay_surcharge_usd_d = (adjusted * _d(payment_surcharge_pct) / Decimal("100")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        adjusted += pay_surcharge_usd_d
        steps.append(
            {
                "step": f"Recargo por gestión cambiaria/pago ({payment_surcharge_pct:.1f}%)",
                "amount_usd": _r2(pay_surcharge_usd_d),
                "note": "Aplicable a pagos en Bolívares según condición comercial.",
            }
        )

    iva_usd_d = Decimal("0")
    if iva_applies and not iva_included:
        iva_usd_d = (adjusted * _d(iva_rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        adjusted += iva_usd_d
        steps.append(
            {
                "step": f"IVA ({iva_rate * 100:.0f}%)",
                "amount_usd": _r2(iva_usd_d),
                "note": "Impuesto no incluido en el monto declarado.",
            }
        )

    hidden_total_usd = pct_surcharge_usd_d + extra_flat_usd_d + pay_surcharge_usd_d
    adjusted_ves_d = (adjusted * rate_d).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    steps.append(
        {
            "step": "Costo Total Real Ajustado (TCO)",
            "amount_usd": _r2(adjusted),
            "amount_ves": _r2(adjusted_ves_d),
            "note": f"Tasa BCV aplicada: {bcv_rate:.4f} Bs/USD",
        }
    )

    return {
        "declared_currency": curr,
        "declared_total_original": _r2(decl_orig_d),
        "declared_total_usd": _r2(decl_usd_d),
        "shipping_cost_usd": _r2(ship_usd_d),
        "installation_cost_usd": _r2(inst_usd_d),
        "hidden_surcharges_usd": _r2(hidden_total_usd),
        "taxes_iva_usd": _r2(iva_usd_d),
        "adjusted_tco_usd": _r2(adjusted),
        "adjusted_tco_ves": _r2(adjusted_ves_d),
        "bcv_rate_used": float(rate_d),
        "steps": steps,
        "notes": notes or [],
    }
