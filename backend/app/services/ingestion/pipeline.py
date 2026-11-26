"""Unified multimodal document ingestion router (PDF, XLSX, PNG, JPG)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.services.agent.security_guard import InjectionScanResult, scan_for_prompt_injection
from app.services.ingestion.image_parser import extract_image
from app.services.ingestion.pdf_parser import extract_pdf
from app.services.ingestion.xlsx_parser import extract_xlsx
from app.services.llm.client import UnifiedLLMClient

VISION_TRANSCRIPTION_PROMPT = """Transcribe de forma fiel, completa y estructurada TODO el contenido de esta imagen de cotización/presupuesto (puede ser manuscrita, escaneada o captura de chat).
Incluye literalmente:
- Nombre de la empresa/proveedor, RIF, ciudad, representante, teléfono/correo y número de referencia.
- Todos los ítems con cantidades, especificaciones técnicas exactas (CPU, socket, RAM tipo/capacidad/módulos, placa base/modelo/slots, almacenamiento, GPU, monitor, teclado, ratón, UPS/regulador/fuente, software/licencia), precios unitarios y subtotales.
- Envío/flete, instalación, servicios opcionales, impuestos (IVA), recargos por método de pago, condiciones en letra pequeña, garantía, moneda y TOTAL GENERAL declarado.
No omitas ningún número ni nota marginal."""


@dataclass
class IngestedDocument:
    filename: str
    identifier: str
    extension: str
    ingestion_method: str
    visible_text: str
    sanitized_text: str
    hidden_findings: list[dict[str, str]] = field(default_factory=list)
    injection_scan: InjectionScanResult = field(default_factory=InjectionScanResult)
    images_b64: list[tuple[str, str]] = field(default_factory=list)
    used_vision_llm: bool = False


async def ingest_document(
    filename: str,
    content: bytes,
    llm_client: UnifiedLLMClient | None = None,
) -> IngestedDocument:
    """Ingest any supported document format (PDF, XLSX, PNG, JPG/JPEG) with injection scanning."""
    path = Path(filename)
    ext = path.suffix.lower()
    identifier = path.stem
    hidden_findings: list[dict[str, str]] = []
    images_b64: list[tuple[str, str]] = []
    visible_text = ""
    ingestion_method = "unknown"
    used_vision_llm = False

    if ext == ".pdf":
        pdf_res = extract_pdf(content, render_pages_for_vision=False)
        visible_text = pdf_res.visible_text
        hidden_findings = pdf_res.hidden_findings
        ingestion_method = "pymupdf_digital"

        if pdf_res.is_scanned:
            ingestion_method = "pymupdf_scanned_ocr"
            ocr_chunks: list[str] = []
            for img_b64 in pdf_res.page_images_b64:
                images_b64.append((img_b64, "image/png"))
                if llm_client and llm_client.is_available:
                    transcribed = await llm_client.extract_from_image(
                        img_b64, "image/png", VISION_TRANSCRIPTION_PROMPT
                    )
                    if transcribed:
                        ocr_chunks.append(transcribed)
                        used_vision_llm = True
                        ingestion_method = "pymupdf_scanned_vision_llm"
                        continue
                # Fallback to local Tesseract on rendered page
                import base64

                img_res = extract_image(base64.b64decode(img_b64))
                if img_res.ocr_text:
                    ocr_chunks.append(img_res.ocr_text)
            if ocr_chunks:
                visible_text = "\n\n".join(ocr_chunks)

    elif ext in (".xlsx", ".xlsm"):
        xlsx_res = extract_xlsx(content)
        visible_text = xlsx_res.text
        hidden_findings = xlsx_res.hidden_findings
        ingestion_method = "openpyxl_formula_eval"

    elif ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"):
        img_res = extract_image(content)
        images_b64.append((img_res.image_b64, img_res.mime_type))
        ocr_text = img_res.ocr_text
        ingestion_method = f"image_{img_res.ocr_engine}"

        if llm_client and llm_client.is_available:
            transcribed = await llm_client.extract_from_image(
                img_res.image_b64, img_res.mime_type, VISION_TRANSCRIPTION_PROMPT
            )
            if transcribed:
                visible_text = transcribed
                used_vision_llm = True
                ingestion_method = f"vision_llm_{llm_client.provider}"
            else:
                visible_text = ocr_text
        else:
            visible_text = ocr_text

    elif ext in (".txt", ".md", ".csv"):
        visible_text = content.decode("utf-8", errors="replace")
        ingestion_method = "plain_text"
    else:
        raise ValueError(f"Formato de archivo no soportado: {ext}")

    scan = scan_for_prompt_injection(visible_text, hidden_findings=hidden_findings)

    return IngestedDocument(
        filename=filename,
        identifier=identifier,
        extension=ext,
        ingestion_method=ingestion_method,
        visible_text=visible_text,
        sanitized_text=scan.sanitized_text,
        hidden_findings=hidden_findings,
        injection_scan=scan,
        images_b64=images_b64,
        used_vision_llm=used_vision_llm,
    )
