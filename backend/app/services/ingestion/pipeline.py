"""Unified multimodal document ingestion router (PDF, Word, Excel, CSV/TSV, Images, TXT/MD)."""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.services.agent.security_guard import InjectionScanResult, scan_for_prompt_injection
from app.services.ingestion.docx_parser import extract_docx
from app.services.ingestion.image_parser import extract_image, is_chat_screenshot_text
from app.services.ingestion.pdf_parser import extract_pdf
from app.services.ingestion.tabular_parser import decode_text_safely, extract_csv_or_tsv, extract_xls
from app.services.ingestion.xlsx_parser import extract_xlsx
from app.services.llm.client import UnifiedLLMClient

# Single source of truth for supported document extensions across API, uploads, and batch mode
SUPPORTED_DOCUMENT_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".pdf",
        ".docx",
        ".xlsx",
        ".xlsm",
        ".xls",
        ".csv",
        ".tsv",
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".tiff",
        ".tif",
        ".txt",
        ".md",
    }
)

VISION_TRANSCRIPTION_PROMPT = """Transcribe de forma fiel, completa y estructurada TODO el contenido de esta imagen de cotización/presupuesto (puede ser manuscrita, escaneada o captura de chat).
Incluye literalmente:
- Nombre de la empresa/proveedor, RIF, ciudad, representante, teléfono/correo y número de referencia.
- Todos los ítems con cantidades, especificaciones técnicas exactas (CPU, socket, RAM tipo/capacidad/módulos, placa base/modelo/slots, almacenamiento, GPU, monitor, teclado, ratón, UPS/regulador/fuente, software/licencia), precios unitarios y subtotales.
- Envío/flete, instalación, servicios opcionales, impuestos (IVA), recargos por método de pago, condiciones en letra pequeña, garantía, moneda y TOTAL GENERAL declarado.
No omitas ningún número ni nota marginal."""

CHAT_SCREENSHOT_VISION_PROMPT = """Analiza esta captura de pantalla de conversación/chat empresarial (Microsoft Teams, WhatsApp, Telegram o Slack) y transcribe cronológicamente CADA mensaje:
- Identifica explícitamente quién habla y a qué hora envía cada mensaje (canal/hilo, remitente, destinatario).
- Separa saludos o comentarios informales de las especificaciones reales de cada ítem ofertado (estación estudiantes, estación docente, periféricos, UPS/fuente, software, garantía).
- Extrae cada precio unitario, subtotal, flete, instalación, condición en mensajes posteriores o correcciones/aclaratorias del hilo (incluyendo recargos en cuotas, % de envío o gestión cambiaria) y el TOTAL GENERAL confirmado.
No inventes valores ni mezcles mensajes de interlocutores distintos."""


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
    is_chat_screenshot: bool = False


async def ingest_document(
    filename: str,
    content: bytes,
    llm_client: UnifiedLLMClient | None = None,
) -> IngestedDocument:
    """Ingest any supported document format (PDF, DOCX, XLSX/XLS, CSV/TSV, Images, TXT/MD)."""
    path = Path(filename)
    ext = path.suffix.lower()
    identifier = path.stem
    hidden_findings: list[dict[str, str]] = []
    images_b64: list[tuple[str, str]] = []
    visible_text = ""
    ingestion_method = "unknown"
    used_vision_llm = False
    is_chat = False

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
                img_res = extract_image(base64.b64decode(img_b64))
                if img_res.ocr_text:
                    ocr_chunks.append(img_res.ocr_text)
            if ocr_chunks:
                visible_text = "\n\n".join(ocr_chunks)

    elif ext == ".docx":
        docx_res = extract_docx(content)
        visible_text = docx_res.text
        hidden_findings = docx_res.hidden_findings
        ingestion_method = "docx_xml_parser"

    elif ext in (".xlsx", ".xlsm"):
        xlsx_res = extract_xlsx(content)
        visible_text = xlsx_res.text
        hidden_findings = xlsx_res.hidden_findings
        ingestion_method = "openpyxl_formula_eval"

    elif ext == ".xls":
        xls_res = extract_xls(content)
        visible_text = xls_res.text
        hidden_findings = xls_res.hidden_findings
        ingestion_method = "xlrd_legacy_excel"

    elif ext in (".csv", ".tsv"):
        tab_res = extract_csv_or_tsv(content, is_tsv=(ext == ".tsv"))
        visible_text = tab_res.text
        ingestion_method = f"tabular_{ext.lstrip('.')}"

    elif ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"):
        img_res = extract_image(content)
        images_b64.append((img_res.image_b64, img_res.mime_type))
        ocr_text = img_res.ocr_text
        is_chat = is_chat_screenshot_text(ocr_text, filename)
        ingestion_method = f"image_{img_res.ocr_engine}"

        if llm_client and llm_client.is_available:
            is_local_llm = bool(getattr(getattr(llm_client, "settings", None), "is_local_llm", False))
            has_hw_signal = bool(
                re.search(r"(?:ryzen|core\s*i[3579]|rtx\s*\d{4}|rx\s*\d{4}|xeon)", ocr_text, re.I)
            )
            has_price_signal = bool(re.search(r"\$\s*\d{2,5}", ocr_text))
            ocr_looks_complete = len(ocr_text.strip()) >= 900 and has_hw_signal and has_price_signal
            if is_local_llm and ocr_looks_complete:
                visible_text = ocr_text
            else:
                prompt = CHAT_SCREENSHOT_VISION_PROMPT if is_chat else VISION_TRANSCRIPTION_PROMPT
                transcribed = await llm_client.extract_from_image(
                    img_res.image_b64, img_res.mime_type, prompt
                )
                if transcribed:
                    visible_text = (
                        f"{transcribed}\n\n{ocr_text}"
                        if len(ocr_text.strip()) >= 80
                        else transcribed
                    )
                    used_vision_llm = True
                    ingestion_method = f"vision_llm_{llm_client.provider}" + ("_chat" if is_chat else "")
                else:
                    visible_text = ocr_text
        else:
            visible_text = ocr_text

    elif ext in (".txt", ".md"):
        visible_text = decode_text_safely(content)
        ingestion_method = f"plain_{ext.lstrip('.')}"
    else:
        raise ValueError(
            f"Formato de archivo no soportado: '{ext}'. "
            f"Permitidos: {', '.join(sorted(SUPPORTED_DOCUMENT_EXTENSIONS))}"
        )

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
        is_chat_screenshot=is_chat,
    )
