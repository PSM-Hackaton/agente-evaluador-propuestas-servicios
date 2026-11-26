"""Image preprocessing, dual-pass OCR (Tesseract), and multimodal base64 encoding."""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass

from PIL import Image, ImageEnhance, ImageOps

logger = logging.getLogger(__name__)


@dataclass
class ImageExtractionResult:
    ocr_text: str
    image_b64: str
    mime_type: str
    width: int
    height: int
    ocr_engine: str


def _preprocess_for_ocr(img: Image.Image) -> Image.Image:
    """Enhance noisy scans, lined forms, and low-res photos for OCR."""
    img = ImageOps.exif_transpose(img)
    gray = img.convert("L")
    w, h = gray.size
    if max(w, h) < 1400:
        scale = min(2.0, 1600 / max(w, h))
        gray = gray.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray = ImageEnhance.Sharpness(gray).enhance(1.6)
    return gray


def _prepare_for_vision(img: Image.Image, max_dim: int = 1800) -> tuple[str, str]:
    """Normalize image orientation and resize cleanly for multimodal Vision LLM APIs."""
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > max_dim:
        ratio = max_dim / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii"), "image/png"


def _merge_ocr_passes(primary: str, secondary: str) -> str:
    """Merge lines from PSM-6 and PSM-3 passes, recovering lines dropped on lined forms."""
    lines_out: list[str] = []
    seen_norm: set[str] = set()
    for block in (primary, secondary):
        for ln in block.splitlines():
            clean = ln.strip()
            if not clean:
                continue
            norm = " ".join(clean.lower().split())
            if norm not in seen_norm:
                seen_norm.add(norm)
                lines_out.append(clean)
    return "\n".join(lines_out)


def extract_image(content: bytes) -> ImageExtractionResult:
    """Run local dual-pass Tesseract OCR + prepare crisp PNG base64 for Vision LLM."""
    img = Image.open(io.BytesIO(content))
    orig_w, orig_h = img.size
    vision_b64, mime = _prepare_for_vision(img)

    ocr_text = ""
    engine = "none"
    try:
        import pytesseract

        processed = _preprocess_for_ocr(img)
        try:
            pass_block = pytesseract.image_to_string(processed, lang="spa+eng", config="--psm 6")
            pass_auto = pytesseract.image_to_string(processed, lang="spa+eng", config="--psm 3")
            ocr_text = _merge_ocr_passes(pass_block, pass_auto)
            engine = "tesseract:spa+eng"
        except Exception:
            pass_block = pytesseract.image_to_string(processed, config="--psm 6")
            pass_auto = pytesseract.image_to_string(processed, config="--psm 3")
            ocr_text = _merge_ocr_passes(pass_block, pass_auto)
            engine = "tesseract:default"
    except Exception as exc:
        logger.warning("Tesseract OCR unavailable or failed: %s", exc)
        engine = f"ocr_unavailable:{type(exc).__name__}"

    return ImageExtractionResult(
        ocr_text=ocr_text.strip(),
        image_b64=vision_b64,
        mime_type=mime,
        width=orig_w,
        height=orig_h,
        ocr_engine=engine,
    )
