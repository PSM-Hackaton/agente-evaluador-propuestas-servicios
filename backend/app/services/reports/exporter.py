"""Committee Report Exporters: Executive PDF (ReportLab), Markdown, Excel (.xlsx), and CSV."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.db.models import EvaluationRun, HumanReview, Project, ProposalEvaluation


def tco_breakdown_steps(p: ProposalEvaluation) -> list[dict[str, Any]]:
    """Step-by-step real cost (declared + freight + surcharges + taxes) for Section 2.E.4."""
    steps = (p.tco_breakdown or {}).get("steps") if isinstance(p.tco_breakdown, dict) else None
    if not steps:
        steps = [
            {"step": "Monto declarado", "amount_usd": p.declared_total_usd, "note": p.declared_currency},
            {"step": "Costo Total Real Ajustado (TCO)", "amount_usd": p.adjusted_tco_usd, "note": ""},
        ]
    out: list[dict[str, Any]] = []
    for st in steps:
        note = str(st.get("note") or "")
        if st.get("original_currency") and st.get("original_currency") != "USD":
            note = f"{st.get('original_amount', 0):,.2f} {st['original_currency']} — {note}"
        if st.get("amount_ves") is not None:
            note = f"Bs. {float(st['amount_ves']):,.2f} — {note}"
        out.append(
            {
                "step": str(st.get("step") or ""),
                "amount_usd": float(st.get("amount_usd") or 0.0),
                "note": note.replace("|", "/"),
            }
        )
    return out


def generate_markdown_report(
    project: Project,
    run: EvaluationRun,
    prop_evals: list[ProposalEvaluation],
    reviews: list[HumanReview] | None = None,
) -> str:
    """Generate structured Markdown Feasibility & Audit Report (Section 2.D.4)."""
    ordered = sorted(prop_evals, key=lambda x: x.rank_position)
    valids = [p for p in ordered if p.is_valid]
    discards = [p for p in ordered if not p.is_valid]

    lines: list[str] = [
        f"# Informe de Análisis y Factibilidad Financiera — {project.name}",
        "",
        f"- **Ubicación de ejecución:** {project.execution_location}",
        f"- **Estado del proceso:** `{project.status}`",
        f"- **Tasa oficial BCV aplicada:** {run.bcv_rate_used:.4f} Bs/USD (`{run.bcv_rate_source}`)",
        f"- **IVA de referencia:** {run.iva_rate_used * 100:.0f}%",
        f"- **Fecha de evaluación:** {run.finished_at.isoformat() if run.finished_at else run.started_at.isoformat()}",
        f"- **Propuestas evaluadas:** {len(ordered)} ({len(valids)} válidas / {len(discards)} descartadas)",
        "",
        "## 1. Propuesta Recomendada y Resumen Ejecutivo",
        "",
        run.executive_summary or "Sin resumen disponible.",
        "",
        "## 2. Tabla Comparativa (Montos Declarados vs. Costo Total Real TCO)",
        "",
        "| Puesto | Propuesta | Proveedor | Estado | Declarado (USD) | Flete/Inst. (USD) | Recargos/IVA (USD) | TCO Real (USD) | TCO Real (Bs.) | Técnica |",
        "|---:|---|---|---|---:|---:|---:|---:|---:|---:|",
    ]

    for p in ordered:
        estado = "VÁLIDA" if p.is_valid else "DESCARTADA"
        logistica = p.shipping_cost_usd + p.installation_cost_usd
        recargos = p.hidden_surcharges_usd + p.taxes_iva_usd
        lines.append(
            f"| #{p.rank_position} | `{p.proposal_identifier}` | {p.supplier_name or '-'} | **{estado}** | "
            f"${p.declared_total_usd:,.2f} | ${logistica:,.2f} | ${recargos:,.2f} | "
            f"**${p.adjusted_tco_usd:,.2f}** | Bs. {p.adjusted_tco_ves:,.2f} | {p.technical_score:.1f}/100 |"
        )

    lines.extend(["", "## 3. Análisis Técnico de Propuestas Válidas", ""])
    if valids:
        for p in valids:
            lines.append(f"### #{p.rank_position} — {p.supplier_name} (`{p.proposal_identifier}`)")
            lines.append(f"- **TCO Real Ajustado:** ${p.adjusted_tco_usd:,.2f} USD (Bs. {p.adjusted_tco_ves:,.2f})")
            lines.append(f"- **Justificación:** {p.recommendation_rationale or ''}")
            if p.fine_print_findings:
                lines.append(f"- **Letra pequeña / condiciones:** {'; '.join(p.fine_print_findings)}")
            if p.market_comparison:
                for mc in p.market_comparison:
                    src_tag = mc.get("reference_source_type") or mc.get("provider") or "n/a"
                    lines.append(
                        f"- **Contraste de mercado ({mc.get('item', '')}):** "
                        f"${mc.get('proposed_unit_price_usd', 0):,.2f} vs ref. "
                        f"${mc.get('market_reference_mid_usd', 0):,.2f} ({mc.get('variance_pct', 0):+.1f}% — "
                        f"{mc.get('status')}, origen: `{src_tag}`)"
                    )
                    for src in (mc.get("sources") or [])[:3]:
                        price_txt = (
                            f" (${src['extracted_price_usd']:,.2f})"
                            if src.get("extracted_price_usd") is not None
                            else ""
                        )
                        date_txt = f" [{src['retrieved_at'][:10]}]" if src.get("retrieved_at") else ""
                        lines.append(f"  - Fuente: [{src.get('title') or src.get('url')}]({src.get('url', '')}){price_txt}{date_txt}")
            lines.append("")
    else:
        lines.append("_Ninguna propuesta superó los criterios de validez._\n")

    lines.extend(["## 4. Dictamen de Descarte", ""])
    if discards:
        for p in discards:
            lines.append(f"- **{p.proposal_identifier}** ({p.supplier_name}): {p.discard_verdict_text}")
            for mc in (p.market_comparison or [])[:2]:
                for src in (mc.get("sources") or [])[:3]:
                    price_txt = (
                        f" (${src['extracted_price_usd']:,.2f})"
                        if src.get("extracted_price_usd") is not None
                        else ""
                    )
                    lines.append(f"  - Fuente mercado ({mc.get('item', '')}): [{src.get('title') or src.get('url')}]({src.get('url', '')}){price_txt}")
    else:
        lines.append("_No hubo propuestas descartadas._")

    lines.extend(["", "## 5. Desglose del Costo Real (paso a paso)", ""])
    for p in ordered:
        lines.append(f"### #{p.rank_position} — `{p.proposal_identifier}`")
        lines.append("")
        lines.append("| Paso | Monto (USD) | Detalle |")
        lines.append("|---|---:|---|")
        for step in tco_breakdown_steps(p):
            lines.append(f"| {step['step']} | ${step['amount_usd']:,.2f} | {step['note']} |")
        lines.append("")

    if reviews:
        lines.extend(["", "## 6. Revisión Humana y Actas de Comité", ""])
        for rv in reviews:
            lines.append(
                f"- **{rv.created_at.strftime('%Y-%m-%d %H:%M')}** — {rv.reviewer_name} (`{rv.reviewer_role}`) "
                f"**[{rv.decision.upper()}]**: {rv.notes}"
            )

    return "\n".join(lines).strip() + "\n"


def generate_csv_report(prop_evals: list[ProposalEvaluation]) -> bytes:
    """Generate detailed comparative CSV table (Section 2.E.5)."""
    ordered = sorted(prop_evals, key=lambda x: x.rank_position)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Puesto",
            "Identificador",
            "Proveedor",
            "RIF",
            "Estado",
            "Moneda Declarada",
            "Monto Declarado Original",
            "Monto Declarado USD",
            "Subtotal Verificado USD",
            "Aritmetica Valida",
            "Flete USD",
            "Instalacion USD",
            "Recargos Ocultos USD",
            "IVA USD",
            "TCO Real Ajustado USD",
            "TCO Real Ajustado VES",
            "Puntaje Tecnico",
            "Puntaje Global",
            "Inyeccion Prompt",
            "Dictamen / Justificacion",
        ]
    )
    for p in ordered:
        writer.writerow(
            [
                p.rank_position,
                p.proposal_identifier,
                p.supplier_name or "",
                p.supplier_rif or "",
                "VALIDA" if p.is_valid else "DESCARTADA",
                p.declared_currency,
                f"{p.declared_total_original:.2f}",
                f"{p.declared_total_usd:.2f}",
                f"{p.computed_subtotal_usd:.2f}",
                "SI" if p.arithmetic_valid else "NO",
                f"{p.shipping_cost_usd:.2f}",
                f"{p.installation_cost_usd:.2f}",
                f"{p.hidden_surcharges_usd:.2f}",
                f"{p.taxes_iva_usd:.2f}",
                f"{p.adjusted_tco_usd:.2f}",
                f"{p.adjusted_tco_ves:.2f}",
                f"{p.technical_score:.2f}",
                f"{p.overall_score:.2f}",
                "SI" if p.prompt_injection_detected else "NO",
                p.recommendation_rationale if p.is_valid else (p.discard_verdict_text or ""),
            ]
        )
    return buf.getvalue().encode("utf-8-sig")


def generate_xlsx_report(
    project: Project,
    run: EvaluationRun,
    prop_evals: list[ProposalEvaluation],
) -> bytes:
    """Generate multi-sheet Executive Excel workbook for Committee review (Section 2.E.5)."""
    ordered = sorted(prop_evals, key=lambda x: x.rank_position)
    wb = Workbook()

    header_fill = PatternFill("solid", fgColor="1E3A5F")
    header_font = Font(color="FFFFFF", bold=True)
    valid_fill = PatternFill("solid", fgColor="E6F4EA")
    discard_fill = PatternFill("solid", fgColor="FCE8E6")

    # Sheet 1: Tabla Comparativa TCO
    ws = wb.active
    ws.title = "Tabla Comparativa TCO"
    ws.append([f"Proyecto: {project.name}", f"Ubicación: {project.execution_location}", f"Tasa BCV: {run.bcv_rate_used:.4f} Bs/USD"])
    ws.append([])
    headers = [
        "Puesto",
        "Propuesta",
        "Proveedor",
        "RIF",
        "Estado",
        "Declarado (USD)",
        "Verificado (USD)",
        "Flete (USD)",
        "Instalación (USD)",
        "Recargos Ocultos (USD)",
        "IVA (USD)",
        "TCO Real (USD)",
        "TCO Real (Bs.)",
        "Puntaje Técnico",
        "Aritmética",
        "Dictamen",
    ]
    ws.append(headers)
    for cell in ws[3]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for p in ordered:
        row_data = [
            p.rank_position,
            p.proposal_identifier,
            p.supplier_name or "",
            p.supplier_rif or "",
            "VÁLIDA" if p.is_valid else "DESCARTADA",
            p.declared_total_usd,
            p.computed_subtotal_usd,
            p.shipping_cost_usd,
            p.installation_cost_usd,
            p.hidden_surcharges_usd,
            p.taxes_iva_usd,
            p.adjusted_tco_usd,
            p.adjusted_tco_ves,
            p.technical_score,
            "OK" if p.arithmetic_valid else f"ERROR (${p.arithmetic_discrepancy_usd:.2f})",
            p.recommendation_rationale if p.is_valid else (p.discard_verdict_text or ""),
        ]
        ws.append(row_data)
        fill = valid_fill if p.is_valid else discard_fill
        ws.cell(row=ws.max_row, column=5).fill = fill

    # Sheet 2: Dictamen de Descarte
    ws_disc = wb.create_sheet("Dictamen de Descarte")
    ws_disc.append(["Propuesta", "Proveedor", "Código Causal", "Detalle del Descarte"])
    for cell in ws_disc[1]:
        cell.fill = header_fill
        cell.font = header_font
    for p in ordered:
        if not p.is_valid:
            for r in p.discard_reasons or []:
                ws_disc.append([p.proposal_identifier, p.supplier_name or "", r.get("code", ""), r.get("detail", "")])

    # Sheet 3: Contraste de Mercado
    ws_mkt = wb.create_sheet("Contraste de Mercado")
    ws_mkt.append(
        [
            "Propuesta",
            "Ítem",
            "Precio Propuesto (USD)",
            "Ref. Mercado Media (USD)",
            "Variación %",
            "Estatus",
            "Tipo Referencia",
            "Proveedor Búsqueda",
            "Fuentes Citadas (URL / Precio)",
        ]
    )
    for cell in ws_mkt[1]:
        cell.fill = header_fill
        cell.font = header_font
    for p in ordered:
        for mc in p.market_comparison or []:
            sources_str = " | ".join(
                f"{s.get('url', '')} (${s['extracted_price_usd']:,.2f})"
                if s.get("extracted_price_usd") is not None
                else str(s.get("url", ""))
                for s in (mc.get("sources") or [])[:3]
            )
            ws_mkt.append(
                [
                    p.proposal_identifier,
                    mc.get("item", ""),
                    mc.get("proposed_unit_price_usd", 0),
                    mc.get("market_reference_mid_usd", 0),
                    mc.get("variance_pct", 0),
                    mc.get("status", ""),
                    mc.get("reference_source_type", ""),
                    mc.get("provider", ""),
                    sources_str,
                ]
            )

    # Auto-fit reasonable column widths
    for sheet in wb.worksheets:
        for col in sheet.columns:
            max_len = max((len(str(c.value or "")) for c in col), default=10)
            sheet.column_dimensions[col[0].column_letter].width = min(max(max_len + 3, 12), 45)

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _x(value: object) -> str:
    """Escape untrusted text (supplier data, reviewer notes) for ReportLab paragraph markup."""
    return xml_escape(str(value if value is not None else ""))


def generate_pdf_report(
    project: Project,
    run: EvaluationRun,
    prop_evals: list[ProposalEvaluation],
    reviews: list[HumanReview] | None = None,
) -> bytes:
    """Generate signature-ready Executive Committee PDF report (Section 2.D.4 & 2.E.5)."""
    ordered = sorted(prop_evals, key=lambda x: x.rank_position)
    valids = [p for p in ordered if p.is_valid]
    discards = [p for p in ordered if not p.is_valid]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.65 * inch,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ExecTitle",
        parent=styles["Heading1"],
        fontSize=15,
        textColor=colors.HexColor("#1E3A5F"),
        spaceAfter=6,
    )
    h2_style = ParagraphStyle(
        "ExecH2",
        parent=styles["Heading2"],
        fontSize=11.5,
        textColor=colors.HexColor("#1E3A5F"),
        spaceBefore=12,
        spaceAfter=5,
    )
    body_style = ParagraphStyle("ExecBody", parent=styles["BodyText"], fontSize=9, leading=12.5)
    small_style = ParagraphStyle("ExecSmall", parent=styles["BodyText"], fontSize=8, leading=10.5)

    story = [
        Paragraph("INFORME EJECUTIVO DE ANÁLISIS Y FACTIBILIDAD FINANCIERA", title_style),
        Paragraph(f"<b>Proyecto:</b> {_x(project.name)}", body_style),
        Paragraph(
            f"<b>Ubicación:</b> {_x(project.execution_location)} | "
            f"<b>Estado:</b> {project.status} | "
            f"<b>Tasa Oficial BCV:</b> {run.bcv_rate_used:.4f} Bs/USD ({run.bcv_rate_source})",
            body_style,
        ),
        Paragraph(
            f"<b>Fecha de emisión:</b> {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} | "
            f"<b>Evaluadas:</b> {len(ordered)} ({len(valids)} válidas, {len(discards)} descartadas)",
            body_style,
        ),
        Spacer(1, 8),
        Paragraph("1. Propuesta Recomendada y Dictamen Ejecutivo", h2_style),
        Paragraph(_x((run.executive_summary or "Sin resumen.").replace("**", "")), body_style),
        Spacer(1, 8),
        Paragraph("2. Tabla Comparativa: Monto Declarado vs. Costo Total Real (TCO)", h2_style),
    ]

    table_data = [["#", "Propuesta / Proveedor", "Estado", "Decl. USD", "TCO USD", "TCO Bs.", "Téc."]]
    for p in ordered:
        table_data.append(
            [
                str(p.rank_position),
                Paragraph(f"<b>{_x(p.proposal_identifier)}</b><br/>{_x(p.supplier_name or '')}", small_style),
                "VÁLIDA" if p.is_valid else "DESCARTADA",
                f"${p.declared_total_usd:,.2f}",
                f"${p.adjusted_tco_usd:,.2f}",
                f"Bs. {p.adjusted_tco_ves:,.0f}",
                f"{p.technical_score:.1f}",
            ]
        )

    tbl = Table(table_data, colWidths=[0.32 * inch, 2.55 * inch, 0.9 * inch, 0.85 * inch, 0.88 * inch, 1.15 * inch, 0.5 * inch])
    tbl_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
    ]
    for idx, p in enumerate(ordered, start=1):
        bg = colors.HexColor("#ECFDF5") if p.is_valid else colors.HexColor("#FEF2F2")
        tbl_style.append(("BACKGROUND", (2, idx), (2, idx), bg))
    tbl.setStyle(TableStyle(tbl_style))
    story.append(tbl)

    story.append(Spacer(1, 10))
    story.append(Paragraph("3. Dictamen Explícito de Descarte", h2_style))
    if discards:
        for p in discards:
            story.append(
                Paragraph(
                    f"• <b>{_x(p.proposal_identifier)}</b> ({_x(p.supplier_name)}): {_x(p.discard_verdict_text)}",
                    small_style,
                )
            )
            story.append(Spacer(1, 3))
    else:
        story.append(Paragraph("No se registraron propuestas descartadas.", body_style))

    story.append(Spacer(1, 8))
    story.append(Paragraph("4. Desglose del Costo Real (paso a paso)", h2_style))
    for p in ordered:
        story.append(Paragraph(f"<b>#{p.rank_position} — {_x(p.proposal_identifier)}</b>", small_style))
        rows = [["Paso", "Monto USD", "Detalle"]]
        for step in tco_breakdown_steps(p):
            rows.append(
                [
                    Paragraph(_x(step["step"]), small_style),
                    f"${step['amount_usd']:,.2f}",
                    Paragraph(_x(step["note"]), small_style),
                ]
            )
        bd = Table(rows, colWidths=[2.3 * inch, 0.95 * inch, 3.85 * inch])
        bd.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                    ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
                    ("ALIGN", (1, 1), (1, -1), "RIGHT"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]
            )
        )
        story.append(bd)
        if p.market_comparison:
            for mc in p.market_comparison[:2]:
                srcs = ", ".join(
                    f"{s.get('title') or s.get('url')} (${s['extracted_price_usd']:,.2f})"
                    if s.get("extracted_price_usd") is not None
                    else str(s.get("title") or s.get("url"))
                    for s in (mc.get("sources") or [])[:2]
                )
                src_note = srcs if srcs else str(mc.get("reference_label") or mc.get("reference_source_type") or "")
                story.append(
                    Paragraph(
                        f"<i>Mercado ({_x(mc.get('item', ''))}): "
                        f"${mc.get('proposed_unit_price_usd', 0):,.2f} vs ref. "
                        f"${mc.get('market_reference_mid_usd', 0):,.2f} ({mc.get('variance_pct', 0):+.1f}%) — "
                        f"{_x(src_note)}</i>",
                        small_style,
                    )
                )
        story.append(Spacer(1, 4))

    if reviews:
        story.append(Spacer(1, 8))
        story.append(Paragraph("5. Validación y Revisión Humana del Comité", h2_style))
        for rv in reviews:
            story.append(
                Paragraph(
                    f"• <b>{_x(rv.reviewer_name)}</b> ({_x(rv.reviewer_role)}) "
                    f"[{_x(rv.decision.upper())}]: {_x(rv.notes)}",
                    small_style,
                )
            )

    story.append(Spacer(1, 22))
    sig_table = Table(
        [
            ["_______________________________", "_______________________________", "_______________________________"],
            ["Revisor Técnico / Financiero", "Comité de Contrataciones", "Aprobador Final / Dirección"],
        ],
        colWidths=[2.35 * inch, 2.35 * inch, 2.35 * inch],
    )
    sig_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 1), (-1, 1), 4),
            ]
        )
    )
    story.append(sig_table)

    doc.build(story)
    return buf.getvalue()
