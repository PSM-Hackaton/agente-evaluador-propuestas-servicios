"""PDF multimodal parser with invisible/white-text prompt-injection detection and scan rendering."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import pymupdf


@dataclass
class PdfExtractionResult:
    visible_text: str
    full_raw_text: str
    hidden_findings: list[dict[str, str]] = field(default_factory=list)
    page_images_b64: list[str] = field(default_factory=list)
    page_count: int = 0
    is_scanned: bool = False
    metadata: dict[str, str] = field(default_factory=dict)


def _is_near_white(color_int: int) -> bool:
    """Check if an sRGB integer color (0xRRGGBB) is white or near-white (invisible on white paper)."""
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    return r >= 240 and g >= 240 and b >= 240


def extract_pdf(content: bytes, render_pages_for_vision: bool = False, max_vision_pages: int | None = None) -> PdfExtractionResult:
    """Extract visible text, hidden/invisible text layers, metadata, and optional PNG renders."""
    doc = pymupdf.open(stream=content, filetype="pdf")
    visible_parts: list[str] = []
    full_parts: list[str] = []
    hidden_findings: list[dict[str, str]] = []
    page_images_b64: list[str] = []

    metadata = {k: str(v) for k, v in (doc.metadata or {}).items() if v}
    # Check PDF metadata for hidden instructions
    for mk, mv in metadata.items():
        if len(mv) > 30 and any(
            kw in mv.lower() for kw in ("system", "ignora", "prompt", "puntaje", "evaluaci", "instrucci")
        ):
            hidden_findings.append({"source": f"pdf_metadata:{mk}", "text": mv})

    total_visible_chars = 0
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        rect = page.rect
        page_raw = page.get_text("text") or ""
        full_parts.append(page_raw)

        # Inspect detailed spans to separate visible text from hidden/white/micro/off-page text
        text_dict = page.get_text("dict")
        page_visible_lines: list[str] = []
        page_hidden_spans: list[str] = []

        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                line_visible_chunks: list[str] = []
                for span in line.get("spans", []):
                    span_text = (span.get("text") or "").strip()
                    if not span_text:
                        continue
                    color = int(span.get("color", 0))
                    size = float(span.get("size", 10.0))
                    bbox = span.get("bbox", (0, 0, 0, 0))
                    off_page = (
                        bbox[2] < rect.x0 - 2
                        or bbox[0] > rect.x1 + 2
                        or bbox[3] < rect.y0 - 2
                        or bbox[1] > rect.y1 + 2
                    )
                    is_hidden = _is_near_white(color) or size <= 3.0 or off_page
                    if is_hidden:
                        page_hidden_spans.append(span_text)
                    else:
                        line_visible_chunks.append(span_text)
                if line_visible_chunks:
                    page_visible_lines.append(" ".join(line_visible_chunks))

        if page_hidden_spans:
            hidden_findings.append(
                {
                    "source": f"pdf_page_{page_idx + 1}_hidden_text",
                    "text": " ".join(page_hidden_spans),
                }
            )

        page_visible_text = "\n".join(page_visible_lines)
        total_visible_chars += len(page_visible_text.strip())
        visible_parts.append(page_visible_text)

    page_count = len(doc)
    is_scanned = page_count > 0 and (total_visible_chars / page_count) < 50

    if render_pages_for_vision or is_scanned:
        limit = page_count if max_vision_pages is None else min(page_count, max_vision_pages)
        for page_idx in range(limit):
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=200)
            png_bytes = pix.tobytes("png")
            page_images_b64.append(base64.b64encode(png_bytes).decode("ascii"))

    doc.close()
    return PdfExtractionResult(
        visible_text="\n\n".join(visible_parts).strip(),
        full_raw_text="\n\n".join(full_parts).strip(),
        hidden_findings=hidden_findings,
        page_images_b64=page_images_b64,
        page_count=page_count,
        is_scanned=is_scanned,
        metadata=metadata,
    )
