"""Deterministic Technical, Scope, Hardware Compatibility, Obsolescence, and Abusive-Clause Audit Engine."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

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


def audit_proposal_technically(
    raw_text: str,
    structured: dict[str, Any],
    project_requirements_text: str = "",
) -> TechnicalAuditResult:
    """Audit a proposal against all 7 Section 3.B discard causes and compute technical quality score."""
    text = raw_text or ""
    low = text.lower()
    reasons: list[dict[str, str]] = []
    findings: list[str] = []
    fine_print: list[str] = []

    # -------------------------------------------------------------------------
    # 1. INCOMPATIBILIDAD TÉCNICA (CPU Socket, DDR4 vs DDR5, DIMM slots/max RAM)
    # -------------------------------------------------------------------------
    has_am5_cpu = bool(re.search(r"ryzen\s*[579]\s*[789]\d{3}|socket\s*am5|\bam5\b", low))
    has_am4_board = bool(re.search(r"socket\s*am4|\bb[45]50m?\b|\ba520m?\b|\bx570\b|\ba320\b", low))
    if has_am5_cpu and has_am4_board:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad física de socket: CPU AMD Ryzen serie 7000/8000/9000 (Socket AM5) "
            "combinada con placa base Socket AM4 (B550/B450/A520).",
        )

    has_ddr5_ram = bool(re.search(r"\bddr5\b", low))
    has_ddr4_ram = bool(re.search(r"\bddr4\b", low))
    # Explicit DDR4 motherboard detection (e.g., B760M-A D4, H610M-K D4, "(DDR4)", B550M)
    has_ddr4_board = bool(
        re.search(
            r"(b760|b660|h610|z690|z790)[^\n|]{0,25}(\bd4\b|\(ddr4\)|ddr4)|socket\s*am4|\bb550m?\b",
            low,
        )
    )
    if has_ddr5_ram and has_ddr4_board:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad de memoria RAM: se cotizan módulos DDR5 con una placa base que solo soporta DDR4.",
        )

    if has_am5_cpu and has_ddr4_ram and not has_ddr5_ram:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad de memoria RAM: la plataforma AMD Socket AM5 solo soporta memoria DDR5, no DDR4.",
        )

    # Intel LGA1700 CPU vs LGA1200/AM4 board
    has_lga1700_cpu = bool(re.search(r"core\s*i[3579]-1[234]\d{3}", low))
    has_lga1200_board = bool(re.search(r"\b(h410|b460|h510|b560|z490|z590)\b|lga\s*1200", low))
    if has_lga1700_cpu and (has_lga1200_board or has_am4_board):
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad física de socket: procesador Intel 12va/13va/14va Gen (LGA1700) con placa incompatible.",
        )

    # DIMM slots & max RAM overflow (e.g., 4x16GB or 64GB on 2xDIMM / max 32GB board like H610M-K)
    ram_sticks_match = re.search(r"(\d)\s*x\s*(\d+)\s*gb", low)
    board_slots_match = re.search(r"(\d)\s*x\s*dimm|(\d)\s*slots?\b(?!\s*libres)", low)
    board_max_ram_match = re.search(r"m[aá]x\.?\s*(\d+)\s*gb", low)
    ram_total_match = re.search(r"ram[:\s]*(\d+)\s*gb|(\d+)\s*gb\s*(?:\(\s*)?ddr[45]", low)

    sticks_count = int(ram_sticks_match.group(1)) if ram_sticks_match else None
    board_slots = None
    if board_slots_match:
        board_slots = int(board_slots_match.group(1) or board_slots_match.group(2))
    board_max_ram = int(board_max_ram_match.group(1)) if board_max_ram_match else None
    ram_total_gb = None
    if ram_total_match:
        ram_total_gb = int(ram_total_match.group(1) or ram_total_match.group(2))

    if sticks_count and board_slots and sticks_count > board_slots:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de ranuras DIMM: la propuesta incluye {sticks_count} módulos de RAM "
            f"en una placa base con solo {board_slots} ranuras DIMM.",
        )
    if ram_total_gb and board_max_ram and ram_total_gb > board_max_ram:
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            f"Incompatibilidad de capacidad de RAM: se cotizan {ram_total_gb}GB de RAM en una placa base "
            f"que soporta un máximo de {board_max_ram}GB.",
        )

    # GPU vs Mini-ITX / Low-Profile case
    if re.search(r"rtx\s*40[6789]0|rx\s*7[6789]00", low) and re.search(
        r"gabinete\s*(slim|low\s*profile|mini-?itx\s*compacto|sff)", low
    ):
        _add_discard(
            reasons,
            DiscardReasonCode.INCOMPATIBILIDAD_TECNICA,
            "Incompatibilidad física de gabinete: tarjeta gráfica dedicada de tamaño completo no cabe en gabinete slim/SFF.",
        )

    # -------------------------------------------------------------------------
    # 2. CAPACIDAD INSUFICIENTE (Fuente de poder o UPS subdimensionados)
    # -------------------------------------------------------------------------
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

    ups_va_match = re.search(r"(?:ups|regulador)[^\n|]{0,35}?(\d{3,4})\s*va", low)
    ups_w_match = re.search(r"(?:ups|regulador)[^\n|]{0,40}?/\s*(\d{3,4})\s*w", low)
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

    # -------------------------------------------------------------------------
    # 3. EQUIPOS OBSOLETOS, RECICLADOS O DE CALIDAD INFERIOR
    # -------------------------------------------------------------------------
    obsolete_patterns = [
        (r"xeon\s*e5[- ]?\d{4}\s*v[1234]|\bx99\b|\bx79\b", "Plataforma Xeon E5 / X99 obsoleta (arquitectura servidor 2012-2016 reciclada) comercializada como equipo nuevo."),
        (r"arquitectura\s*201[0-8]|core\s*i[357]-[2-8]\d{3}\b|ddr3\b", "Hardware obsoleto de generaciones descontinuadas no apto para equipos nuevos de gama media-alta."),
        (r"\b(reacondicionado|refurbished|usado|seminuevo|reciclado|segunda\s+mano)\b", "Equipos usados, reciclados o reacondicionados cuando el proyecto exige equipos nuevos sin uso previo."),
    ]
    for pat, msg in obsolete_patterns:
        if re.search(pat, low):
            _add_discard(reasons, DiscardReasonCode.EQUIPOS_OBSOLETOS_RECICLADOS, msg)

    # -------------------------------------------------------------------------
    # 4. COSTOS O CONDICIONES ABUSIVAS (Software de prueba pago, flete abusivo, garantía exterior)
    # -------------------------------------------------------------------------
    # "Evaluación" alone is a common word in proposals ("para su evaluación", "comité de evaluación"),
    # so it only counts as a trial license when it qualifies a software/license/edition.
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

    surcharge_pct_match = re.search(
        r"(?:recargo|flete|env[ií]o\s+especializado|traslado)[^\n\.]{0,50}?(\d{2,3})\s*%",
        low,
    )
    if surcharge_pct_match:
        pct = float(surcharge_pct_match.group(1))
        fine_print.append(f"Cláusula de recargo por envío/traslado detectada: +{pct:.0f}% sobre la factura.")
        if pct >= 30.0:
            _add_discard(
                reasons,
                DiscardReasonCode.COSTOS_CONDICIONES_ABUSIVAS,
                f"Recargo de envío/logística desmedido en letra pequeña (+{pct:.0f}% del valor de la factura).",
            )

    if re.search(r"no\s+incluye\s+(flete|env[ií]o|traslado)", low):
        fine_print.append("Nota marginal detectada: 'No incluye flete/envío'.")

    if re.search(r"\+\s*4\s*%\s*(?:gesti[oó]n|por\s+gesti[oó]n)", low):
        fine_print.append("Condición comercial: pagos en Bolívares a tasa BCV aplican +4% por gestión cambiaria.")

    # -------------------------------------------------------------------------
    # 5. CUMPLIMIENTO DEL ALCANCE DEL PROYECTO
    # -------------------------------------------------------------------------
    req_low = (project_requirements_text or "").lower()
    expects_10_plus_1 = ("10" in req_low or "diez" in req_low) and ("11" in req_low or "once" in req_low)
    if expects_10_plus_1:
        student_qty = int(structured.get("student_pc_count") or 0)
        teacher_qty = int(structured.get("teacher_pc_count") or 0)
        if student_qty == 0:
            if re.search(r"10\s*(?:x|pcs?|computadoras?|equipos?|estaci)|estudiantes?\s*\(?10x?\)?", low):
                student_qty = 10
        if teacher_qty == 0:
            if re.search(r"1\s*(?:x|pc|computadora|equipo|estaci)|docente\s*\(?1x?\)?", low):
                teacher_qty = 1

        if student_qty < 10 or teacher_qty < 1:
            _add_discard(
                reasons,
                DiscardReasonCode.ALCANCE_INCOMPLETO,
                f"Alcance incompleto en cantidad de equipos: se requieren 10 estaciones de estudiantes y 1 de docente "
                f"(detectadas: {student_qty} estudiantes, {teacher_qty} docente).",
            )

        # Check required peripherals & electrical protection & installation
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

    # -------------------------------------------------------------------------
    # 6. PUNTUACIÓN DE CALIDAD TÉCNICA (Section 3.B Ranking Criteria)
    # -------------------------------------------------------------------------
    # Components: CPU + GPU/VRAM (3D & video editing), RAM/NVMe, Monitor & Peripherals,
    # Electrical Protection (UPS > AVR), Warranty & Support, Open Source Stack
    score_cpu_gpu = 0.0
    score_ram_storage = 0.0
    score_peripherals = 0.0
    score_protection = 0.0
    score_warranty_support = 0.0

    # CPU & GPU (max 40 pts)
    if re.search(r"rtx\s*4070\s*super|rtx\s*4070\b", low) and re.search(r"i7-1[34]700|ryzen\s*9", low):
        score_cpu_gpu = 39.5 if re.search(r"rtx\s*4070\s*super", low) else 37.0
        findings.append("Alto rendimiento para 3D y edición de video (CPU i7/Ryzen 9 + GPU RTX 4070/Super 12GB).")
    elif re.search(r"rtx\s*4060\s*ti\s*16\s*gb", low):
        score_cpu_gpu = 36.5
        findings.append("Excelente capacidad 3D/video con RTX 4060 Ti 16GB VRAM + Ryzen 7/9.")
    elif re.search(r"rtx\s*4060\s*ti", low):
        score_cpu_gpu = 33.0
    elif re.search(r"rtx\s*4060", low):
        score_cpu_gpu = 29.0
        findings.append("GPU NVIDIA RTX 4060 8GB adecuada para programación, 3D y video con aceleración CUDA.")
    elif re.search(r"rtx\s*3060\s*12\s*gb", low):
        score_cpu_gpu = 29.5
        findings.append("GPU NVIDIA RTX 3060 12GB VRAM (ventaja en VRAM y CUDA para Blender/3D).")
    elif re.search(r"rx\s*7600", low):
        score_cpu_gpu = 25.0
        findings.append("GPU AMD RX 7600 8GB (menor ecosistema CUDA frente a NVIDIA en renderizado 3D).")
    else:
        score_cpu_gpu = 18.0

    # RAM & Storage (max 20 pts)
    if re.search(r"64\s*gb", low) and re.search(r"32\s*gb", low):
        score_ram_storage += 12.0
    elif re.search(r"32\s*gb", low) and not re.search(r"estudiantes[^\n]{0,120}16\s*gb", low):
        score_ram_storage += 10.5
    elif re.search(r"16\s*gb", low):
        score_ram_storage += 7.0
    else:
        score_ram_storage += 5.0

    if re.search(r"2\s*tb\s*nvme", low):
        score_ram_storage += 8.0
    elif re.search(r"1\s*tb\s*nvme", low):
        score_ram_storage += 7.0
    elif re.search(r"512\s*gb\s*nvme", low):
        score_ram_storage += 4.5
    else:
        score_ram_storage += 3.0

    # Monitor & Peripherals (max 15 pts)
    if re.search(r"27\"?\s*qhd|1440p|ultragear", low):
        score_peripherals = 15.0
        findings.append("Monitores 27\" QHD IPS + periféricos mecánicos/ergonómicos de gama superior.")
    elif re.search(r"proart|100%\s*srgb", low):
        score_peripherals = 14.5
        findings.append("Monitores ASUS ProArt calibrados 100% sRGB + periféricos mecánicos Logitech.")
    elif re.search(r"redragon|mec[aá]nico", low):
        score_peripherals = 10.5
    elif re.search(r"aoc|lg|samsung", low):
        score_peripherals = 8.5
    else:
        score_peripherals = 6.0

    # Electrical Protection (max 13 pts)
    if re.search(r"onda\s*pura|1500\s*va|cyberpower", low):
        score_protection = 13.0
        findings.append("Protección eléctrica superior: UPS Interactivo 1500VA de Onda Pura.")
    elif re.search(r"ups\s*interactivo\s*apc\s*1200\s*va|1200\s*va\s*/\s*650\s*w", low):
        score_protection = 11.5
        findings.append("Protección eléctrica robusta: UPS Interactivo APC 1200VA/650W con AVR.")
    elif re.search(r"ups\s*interactivo|1000\s*va\s*/\s*600\s*w|back-?ups", low):
        score_protection = 10.0
        findings.append("Protección eléctrica con respaldo de batería: UPS Interactivo APC 1000VA/600W.")
    elif re.search(r"isobar", low):
        score_protection = 7.5
        findings.append("Supresor Tripp Lite Isobar + AVR (sin respaldo de batería ante cortes eléctricos).")
    elif re.search(r"regulador\s*avr|forza", low):
        score_protection = 6.5
        findings.append("Regulador AVR 1200VA (cumple protección básica, sin respaldo de batería UPS).")
    else:
        score_protection = 3.0

    # Warranty & Support (max 12 pts)
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
