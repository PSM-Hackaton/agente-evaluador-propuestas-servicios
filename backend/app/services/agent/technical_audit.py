"""Station-Scoped Technical, Compatibility, Obsolescence, and Abusive-Clause Audit Engine (Issue #10 R3-B2)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings
from app.db.models import DiscardReasonCode


@dataclass
class TechnicalAuditResult:
    is_technically_valid: bool
    discard_reasons: list[dict[str, str]] = field(default_factory=list)
    technical_findings: list[str] = field(default_factory=list)
    fine_print_findings: list[str] = field(default_factory=list)
    technical_score: float = 0.0
    score_breakdown: dict[str, float] = field(default_factory=dict)


def _add_discard(
    reasons: list[dict[str, str]],
    code: DiscardReasonCode,
    detail: str,
) -> None:
    if not any(r["code"] == code.value and r["detail"] == detail for r in reasons):
        reasons.append({"code": code.value, "detail": detail})


def _extract_station_sections(text: str) -> dict[str, str]:
    """Isolate student vs. teacher workstation specs, skipping chat-header request lines."""
    low = (text or "").lower()

    def _pick_best_section(start_pat: str, end_pat: str) -> str:
        candidates: list[str] = []
        for m in re.finditer(start_pat, low, re.I):
            tail = low[m.start() :]
            end_m = re.search(end_pat, tail[len(m.group(0)) :], re.I)
            seg = tail[: len(m.group(0)) + end_m.start()] if end_m else tail
            candidates.append(seg.strip())
        if not candidates:
            return low
        # Prefer the segment that actually specifies CPU/RAM/GPU/Price rather than a greeting/summary line
        scored = sorted(
            candidates,
            key=lambda s: (
                sum(1 for kw in ("ryzen", "core i", "xeon", "rtx", "rx ", "nvme", "ram", "ddr", "$") if kw in s),
                len(s),
            ),
            reverse=True,
        )
        return scored[0] if scored[0] else low

    student_txt = _pick_best_section(
        r"(?:estaci[oó]n\s+estudiantes?|estudiantes?\s*\(\d+x?\)|\d+\s*(?:pcs?|equipos?|computadoras?)\s+estudiantes?)",
        r"(?:estaci[oó]n\s+docente|docente\s*\(\d+x?\)|\d+\s*(?:pc|equipo|computadora)\s+docente|perif[eé]ricos|software|env[ií]o|garant[ií]a|total\b)",
    )
    teacher_txt = _pick_best_section(
        r"(?:estaci[oó]n\s+docente|docente\s*\(\d+x?\)|\d+\s*(?:pc|equipo|computadora)\s+docente)",
        r"(?:perif[eé]ricos|software|env[ií]o|garant[ií]a|total\b)",
    )
    return {
        "student": student_txt,
        "teacher": teacher_txt,
        "full": low,
    }


def _check_station_compatibility(section_label: str, seg: str, reasons: list[dict[str, str]]) -> None:
    """Validate CPU socket, RAM generation, DIMM slots/capacity, and chassis fit within a single station."""
    has_am5_cpu = bool(re.search(r"ryzen\s*[579]\s*[789]\d{3}|socket\s*am5|\bam5\b", seg))
    has_am4_board = bool(re.search(r"socket\s*am4|\bb[45]50m?\b|\ba520m?\b|\bx570\b|\ba320\b", seg))
    if has_am5_cpu and has_am4_board:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad física de socket en {section_label}: CPU AMD Ryzen AM5 combinada con placa base Socket AM4.",
        )

    has_ddr5_ram = bool(re.search(r"\bddr5\b", seg))
    has_ddr4_ram = bool(re.search(r"\bddr4\b", seg))
    has_ddr4_board = bool(
        re.search(
            r"(b760|b660|h610|z690|z790)[^\n|]{0,25}(\bd4\b|\(ddr4\)|ddr4)|socket\s*am4|\bb550m?\b",
            seg,
        )
    )
    if has_ddr5_ram and has_ddr4_board:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de memoria RAM en {section_label}: se cotizan módulos DDR5 con placa base solo DDR4.",
        )

    if has_am5_cpu and has_ddr4_ram and not has_ddr5_ram:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de memoria RAM en {section_label}: plataforma AMD Socket AM5 requiere DDR5 (no soporta DDR4).",
        )

    has_lga1700_cpu = bool(re.search(r"core\s*i[3579]-1[234]\d{3}", seg))
    has_lga1200_board = bool(re.search(r"\b(h410|b460|h510|b560|z490|z590)\b|lga\s*1200", seg))
    if has_lga1700_cpu and (has_lga1200_board or has_am4_board):
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad física de socket en {section_label}: procesador Intel LGA1700 con placa incompatible.",
        )

    ram_sticks_match = re.search(r"(\d)\s*x\s*(\d+)\s*gb", seg)
    board_slots_match = re.search(r"(\d)\s*x\s*dimm|(\d)\s*slots?\b(?!\s*libres)", seg)
    board_max_ram_match = re.search(r"m[aá]x\.?\s*(\d+)\s*gb", seg)
    ram_total_match = re.search(r"ram[:\s]*(\d+)\s*gb|(\d+)\s*gb\s*(?:\(\s*)?ddr[45]", seg)

    sticks_count = int(ram_sticks_match.group(1)) if ram_sticks_match else None
    board_slots = int(board_slots_match.group(1) or board_slots_match.group(2)) if board_slots_match else None
    board_max_ram = int(board_max_ram_match.group(1)) if board_max_ram_match else None
    ram_total_gb = int(ram_total_match.group(1) or ram_total_match.group(2)) if ram_total_match else None

    if sticks_count and board_slots and sticks_count > board_slots:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de ranuras DIMM en {section_label}: incluye {sticks_count} módulos RAM "
            f"en placa base con {board_slots} ranuras DIMM.",
        )
    if ram_total_gb and board_max_ram and ram_total_gb > board_max_ram:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de capacidad RAM en {section_label}: cotiza {ram_total_gb}GB RAM "
            f"en placa base con máximo {board_max_ram}GB.",
        )


def _score_gpu_cpu(seg: str) -> tuple[float, str | None]:
    """Score CPU+GPU combination for a station and extract actual GPU label dynamically."""
    gpu_m = re.search(
        r"(?:nvidia\s+geforce\s+)?(rtx\s*40[789]0\s*(?:super|ti)?(?:\s*\d+\s*gb)?|"
        r"rtx\s*4060\s*ti(?:\s*\d+\s*gb)?|rtx\s*4060(?:\s*\d+\s*gb)?|"
        r"rtx\s*3060(?:\s*\d+\s*gb)?|rx\s*7[678]00(?:\s*\d+\s*gb)?)",
        seg,
        re.I,
    )
    gpu_label = re.sub(r"\s+", " ", gpu_m.group(1)).upper() if gpu_m else None

    if re.search(r"rtx\s*4070\s*super", seg, re.I):
        return 39.5, gpu_label
    if re.search(r"rtx\s*4070\b", seg, re.I):
        return 37.0, gpu_label
    if re.search(r"rtx\s*4060\s*ti\s*16\s*gb", seg, re.I):
        return 36.5, gpu_label
    if re.search(r"rtx\s*4060\s*ti", seg, re.I):
        return 33.0, gpu_label
    if re.search(r"rtx\s*3060\s*12\s*gb", seg, re.I):
        return 29.5, gpu_label
    if re.search(r"rtx\s*4060", seg, re.I):
        return 29.0, gpu_label
    if re.search(r"rx\s*7600", seg, re.I):
        return 25.0, gpu_label
    return 18.0, gpu_label


def audit_proposal_technically(
    raw_text: str,
    structured: dict[str, Any],
    project_requirements_text: str = "",
) -> TechnicalAuditResult:
    """Audit a proposal against all 7 Section 3.B discard causes using station-scoped rules and dynamic findings."""
    text = raw_text or ""
    sections = _extract_station_sections(text)
    student_seg = sections["student"]
    teacher_seg = sections["teacher"]
    low = sections["full"]

    reasons: list[dict[str, str]] = []
    findings: list[str] = []
    fine_print: list[str] = []

    # 1. Station-scoped compatibility checks
    _check_station_compatibility("Estación Estudiantes", student_seg, reasons)
    if teacher_seg != student_seg:
        _check_station_compatibility("Estación Docente", teacher_seg, reasons)

    # GPU vs Mini-ITX / Slim chassis
    if re.search(r"rtx\s*40[6789]0|rx\s*7[6789]00", low) and re.search(
        r"gabinete\s*(slim|low\s*profile|mini-?itx\s*compacto|sff)", low
    ):
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad física de gabinete: tarjeta gráfica dedicada de tamaño completo no cabe en gabinete slim/SFF.",
        )

    # 2. Insufficient capacity (PSU / UPS)
    psu_match = re.search(r"(?:fuente|psu)[^\n|]{0,30}?(\d{3,4})\s*w", low)
    has_dedicated_gpu = bool(re.search(r"rtx\s*\d{4}|gtx\s*\d{4}|rx\s*\d{4}", low))
    if psu_match and has_dedicated_gpu:
        psu_watts = int(psu_match.group(1))
        if psu_watts < 450:
            _add_discard(
                reasons,
                DiscardReasonCode.CAPACIDAD_INSUFICIENTE,
                f"Fuente de poder insuficiente ({psu_watts}W) para alimentar estación con GPU dedicada.",
            )

    ups_va_match = re.search(r"(?:ups|regulador)[^\n|]{0,45}?(\d{3,4})\s*va", low)
    ups_w_match = re.search(r"(?:ups|regulador)[^\n|]{0,50}?/\s*(\d{3,4})\s*w", low)
    if ups_va_match and has_dedicated_gpu:
        ups_va = int(ups_va_match.group(1))
        if ups_va < 600:
            _add_discard(
                reasons,
                DiscardReasonCode.CAPACIDAD_INSUFICIENTE,
                f"Protección eléctrica/UPS insuficiente ({ups_va}VA) para soportar estación de gama media-alta.",
            )
    if ups_w_match and has_dedicated_gpu:
        ups_w = int(ups_w_match.group(1))
        if ups_w < 360:
            _add_discard(
                reasons,
                DiscardReasonCode.CAPACIDAD_INSUFICIENTE,
                f"Capacidad real del UPS insuficiente ({ups_w}W) para la carga del equipo.",
            )

    # 3. Obsolete / recycled hardware
    obsolete_patterns = [
        (r"xeon\s*e5[- ]?\d{4}\s*v[1234]|\bx99\b|\bx79\b", "Plataforma Xeon E5 / X99 obsoleta (arquitectura servidor 2012-2016 reciclada) comercializada como equipo nuevo."),
        (r"arquitectura\s*201[0-8]|core\s*i[357]-[2-8]\d{3}\b|ddr3\b", "Hardware obsoleto de generaciones descontinuadas no apto para equipos nuevos de gama media-alta."),
        (r"\b(reacondicionado|refurbished|usado|seminuevo|reciclado|segunda\s+mano)\b", "Equipos usados, reciclados o reacondicionados cuando el proyecto exige equipos nuevos sin uso previo."),
    ]
    for pat, msg in obsolete_patterns:
        if re.search(pat, low):
            _add_discard(reasons, DiscardReasonCode.EQUIPOS_OBSOLETOS_RECICLADOS, msg)

    # 4. Abusive conditions / trial software / excessive shipping surcharge
    has_trial_software = bool(
        re.search(
            r"(?:windows|office|licencia|software|edici[oó]n|versi[oó]n|so:)[^\n|]{0,40}\((?:evaluaci[oó]n|trial|prueba)\)|"
            r"(?:windows|office|licencia|software)[^\n|]{0,40}\b(?:evaluaci[oó]n|trial|de\s+prueba)\b|"
            r"\btrial\b|prueba\s*de\s*\d+\s*d[ií]as|vencer\s*\d+\s*d[ií]as|"
            r"requiere\s+compra\s+de\s+licencias|lic\.?\s*anual[:\s]*\$?\s*[1-9]\d*",
            low,
        )
    )
    if has_trial_software:
        _add_discard(
            reasons,
            DiscardReasonCode.COSTOS_CONDICIONES_ABUSIVAS,
            "Condición abusiva de software: incluye licencias de evaluación/prueba que pasan a cobrarse al vencer "
            "(además de incumplir el requerimiento de software open source).",
        )

    if re.search(
        r"garant[ií]a\s*(v[aá]lida\s*)?(solo|únicamente|unicamente)\s*(fuera\s+del\s+pa[ií]s|en\s+ee\.?uu\.?|en\s+usa|internacional\s+sin\s+soporte\s+local)|sin\s+garant[ií]a",
        low,
    ):
        _add_discard(
            reasons,
            DiscardReasonCode.COSTOS_CONDICIONES_ABUSIVAS,
            "Condición abusiva de garantía: garantía válida solo fuera del país o inexistente.",
        )

    # Threshold configurable (default 50%): <50% (e.g. +45% in Section 2.D) is consolidated into TCO and
    # displaces ranking; >=50% (Section 2.B) is discarded as an abusive logistics surcharge.
    threshold_pct = get_settings().abusive_surcharge_pct_threshold
    surcharge_pct_match = re.search(
        r"(?:recargo|flete|env[ií]o\s+especializado|traslado)[^\n\.]{0,50}?(\d{2,3})\s*%",
        low,
    )
    if surcharge_pct_match:
        pct = float(surcharge_pct_match.group(1))
        fine_print.append(f"Cláusula de recargo por envío/traslado detectada: +{pct:.0f}% sobre la factura.")
        if pct >= threshold_pct:
            _add_discard(
                reasons,
                DiscardReasonCode.COSTOS_CONDICIONES_ABUSIVAS,
                f"Recargo de envío/logística desmedido en letra pequeña (+{pct:.0f}% del valor de la factura; "
                f"umbral máximo {threshold_pct:.0f}%).",
            )

    if re.search(r"no\s+incluye\s+(flete|env[ií]o|traslado)", low):
        fine_print.append("Nota marginal detectada: 'No incluye flete/envío'.")

    if re.search(r"\+\s*4\s*%\s*(?:gesti[oó]n|por\s+gesti[oó]n)", low):
        fine_print.append("Condición comercial: pagos en Bolívares a tasa BCV aplican +4% por gestión cambiaria.")

    # 5. Project Scope Compliance
    req_low = (project_requirements_text or "").lower()
    expects_10_plus_1 = ("10" in req_low or "diez" in req_low) and ("11" in req_low or "once" in req_low)
    if expects_10_plus_1:
        student_qty = int(structured.get("student_pc_count") or 0)
        teacher_qty = int(structured.get("teacher_pc_count") or 0)
        if student_qty == 0 and re.search(r"10\s*(?:x|pcs?|computadoras?|equipos?|estaci)|estudiantes?\s*\(?10x?\)?", low):
            student_qty = 10
        if teacher_qty == 0 and re.search(r"1\s*(?:x|pc|computadora|equipo|estaci)|docente\s*\(?1x?\)?", low):
            teacher_qty = 1

        if student_qty < 10 or teacher_qty < 1:
            _add_discard(
                reasons,
                DiscardReasonCode.ALCANCE_INCOMPLETO,
                f"Alcance incompleto en cantidad de equipos: se requieren 10 estaciones de estudiantes y 1 de docente "
                f"(detectadas: {student_qty} estudiantes, {teacher_qty} docente).",
            )

        has_monitor = bool(re.search(r"monitor|ips|proart|ultragear|fhd|qhd|1440p|1080p", low))
        has_protection = bool(re.search(r"ups|avr|regulador|protector|supresor|isobar|cyberpower|apc|forza", low))
        has_install = bool(re.search(r"instalaci[oóeé]n|inst\.?\s*:?\s*\$|en\s+sitio", low))

        if not has_monitor:
            _add_discard(
                reasons,
                DiscardReasonCode.ALCANCE_INCOMPLETO,
                "Alcance incompleto: no incluye monitores para las estaciones de trabajo.",
            )
        if not has_protection:
            _add_discard(
                reasons,
                DiscardReasonCode.ALCANCE_INCOMPLETO,
                "Alcance incompleto: no incluye protectores eléctricos / reguladores AVR / UPS requeridos.",
            )
        if not has_install or re.search(r"no\s+incluye\s+instalaci[oó]n|instalaci[oó]n:\s*no\b", low):
            _add_discard(
                reasons,
                DiscardReasonCode.ALCANCE_INCOMPLETO,
                "Alcance incompleto: no contempla la entrega, instalación y puesta en funcionamiento en sitio.",
            )

    # 6. Station-scoped Technical Quality Scoring & 100% Dynamic Findings
    score_st_gpu, st_gpu_label = _score_gpu_cpu(student_seg)
    score_tc_gpu, tc_gpu_label = _score_gpu_cpu(teacher_seg)
    score_cpu_gpu = round(score_st_gpu * 0.8 + score_tc_gpu * 0.2, 2)

    if st_gpu_label:
        if tc_gpu_label and tc_gpu_label != st_gpu_label:
            findings.append(f"Aceleración gráfica detectada: estudiantes con {st_gpu_label} y docente con {tc_gpu_label}.")
        else:
            findings.append(f"Aceleración gráfica detectada en estaciones: {st_gpu_label}.")

    # RAM & Storage (station-scoped)
    st_ram_m = (
        re.search(r"(\d+)\s*gb\s*(?:\(\s*)?(?:ddr[45]|ram)\b", student_seg)
        or re.search(r"ram[:\s]*(\d+)\s*gb", student_seg)
    )
    st_ram_gb = int(st_ram_m.group(1)) if st_ram_m else 16
    score_ram = 12.0 if st_ram_gb >= 64 else (10.5 if st_ram_gb >= 32 else 7.0)

    st_nvme_m = re.search(r"(\d+)\s*(tb|gb)\s*nvme", student_seg)
    score_storage = 3.0
    if st_nvme_m:
        qty_disk = int(st_nvme_m.group(1))
        unit_disk = st_nvme_m.group(2)
        gb_disk = qty_disk * 1024 if unit_disk == "tb" else qty_disk
        score_storage = 8.0 if gb_disk >= 2048 else (7.0 if gb_disk >= 1024 else 4.5)
    score_ram_storage = score_ram + score_storage

    # Monitor & Peripherals (dynamic label from actual text)
    mon_m = (
        re.search(r"monitor[:\s]+([^\n|]{4,60})", text, re.I)
        or re.search(r"(?:lg\s+ultragear|asus\s+proart|aoc|samsung|viewsonic|msi)\s+[^\n|]{4,50}", text, re.I)
    )
    mon_desc = mon_m.group(1).strip() if (mon_m and mon_m.lastindex) else (mon_m.group(0).strip() if mon_m else None)
    if re.search(r"27\"?\s*qhd|1440p|ultragear", low):
        score_peripherals = 15.0
    elif re.search(r"proart|100%\s*srgb", low):
        score_peripherals = 14.5
    elif re.search(r"mec[aá]nico|redragon|keychron", low):
        score_peripherals = 10.5
    elif re.search(r"monitor|ips|fhd|1080p", low):
        score_peripherals = 8.5
    else:
        score_peripherals = 6.0
    if mon_desc:
        findings.append(f"Monitores especificados: {mon_desc}.")

    # Electrical Protection (dynamic label with actual VA/W model, skipping request phrases)
    prot_m = (
        re.search(r"(?:ups\s+interactivo|regulador\s+avr|supresor\s+tripp\s*lite|ups\s+\w+|regulador\s+\w+)[^\n|]{0,65}", text, re.I)
        or re.search(r"(?:protecci[oó]n|prot\.?)\s*[:\-]\s*([^\n|]{4,70})", text, re.I)
    )
    prot_desc = prot_m.group(1).strip() if (prot_m and prot_m.lastindex) else (prot_m.group(0).strip() if prot_m else None)
    if re.search(r"onda\s*pura|1500\s*va", low):
        score_protection = 13.0
    elif re.search(r"ups\s*interactivo[^\n|]{0,30}1200\s*va|1200\s*va\s*/\s*650\s*w", low):
        score_protection = 11.5
    elif re.search(r"ups\s*interactivo|back-?ups", low):
        score_protection = 10.0
    elif re.search(r"isobar", low):
        score_protection = 7.5
    elif re.search(r"regulador|avr", low):
        score_protection = 6.5
    else:
        score_protection = 3.0
    if prot_desc:
        findings.append(f"Protección eléctrica declarada: {prot_desc}.")

    # Warranty & Support (dynamic)
    warranty_match = re.search(r"garant[ií]a[:\s]*(\d{1,2})\s*(?:meses|m\b)", low)
    warranty_months = int(warranty_match.group(1)) if warranty_match else 12
    if warranty_months >= 24:
        score_warranty_support = 10.0
        if re.search(r"mantenimiento\s+semestral|24h|cuda|capacitaci[oó]n", low):
            score_warranty_support += 2.0
    elif warranty_months >= 18:
        score_warranty_support = 8.0
    else:
        score_warranty_support = 6.0
    if warranty_match:
        findings.append(f"Garantía declarada: {warranty_months} meses.")

    if not has_trial_software and re.search(
        r"ubuntu|pop!_os|fedora|linux\s*mint|open\s*source|software\s*libre", low
    ):
        findings.append("Incluye sistema operativo y herramientas 100% open source ($0/año en licencias).")

    total_tech_score = round(
        score_cpu_gpu + score_ram_storage + score_peripherals + score_protection + score_warranty_support,
        2,
    )

    return TechnicalAuditResult(
        is_technically_valid=(len(reasons) == 0),
        discard_reasons=reasons,
        technical_findings=findings,
        fine_print_findings=fine_print,
        technical_score=total_tech_score,
        score_breakdown={
            "cpu_gpu_rendimiento": score_cpu_gpu,
            "ram_almacenamiento": score_ram_storage,
            "monitores_perifericos": score_peripherals,
            "proteccion_electrica": score_protection,
            "garantia_soporte": score_warranty_support,
        },
    )
