"""Image preprocessing, dual-pass OCR (Tesseract), and multimodal base64 encoding."""

from __future__ import annotations

import base64
import io
import logging
import re
import shutil
import subprocess
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
    deskew_angle_deg: float = 0.0


def _projection_score(binary_img: Image.Image, angle: float) -> float:
    """Measure horizontal text-line sharpness via row-projection variance at a given rotation."""
    rotated = binary_img.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=0)
    w, h = rotated.size
    data = rotated.tobytes()
    row_sums = [sum(data[y * w : (y + 1) * w]) for y in range(h)]
    return float(sum(s * s for s in row_sums))


def _deskew_image(gray: Image.Image) -> tuple[Image.Image, float]:
    """Estimate and correct document skew angle (-10..+10 deg) strictly in memory."""
    w, h = gray.size
    if min(w, h) < 120:
        return gray, 0.0

    scale = min(1.0, 520.0 / max(w, h))
    small = gray.resize((max(64, int(w * scale)), max(64, int(h * scale))), Image.Resampling.BILINEAR)
    pixels = small.tobytes()
    mean_val = sum(pixels) / max(len(pixels), 1)
    thresh = max(40, min(220, int(mean_val - 15)))
    binary = small.point(lambda p: 1 if p < thresh else 0, mode="L")
    if sum(binary.tobytes()) < 50:
        return gray, 0.0

    base_score = _projection_score(binary, 0.0)
    best_angle = 0.0
    best_score = base_score

    for coarse in range(-10, 11):
        sc = _projection_score(binary, float(coarse))
        if sc > best_score:
            best_score = sc
            best_angle = float(coarse)

    center = best_angle
    for step in (-0.75, -0.5, -0.25, 0.25, 0.5, 0.75):
        cand = center + step
        sc = _projection_score(binary, cand)
        if sc > best_score:
            best_score = sc
            best_angle = cand

    if abs(best_angle) < 0.5 or base_score <= 0 or (best_score / base_score) < 1.08:
        return gray, 0.0

    deskewed = gray.rotate(
        best_angle,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=255,
    )
    return deskewed, round(best_angle, 2)


def is_chat_screenshot_text(text: str, filename: str = "") -> bool:
    """Detect enterprise/messaging chat UI screenshots (Teams, WhatsApp, Slack, Telegram)."""
    low = (text or "").lower()
    fname = (filename or "").lower()
    if any(
        kw in low
        for kw in (
            "microsoft teams",
            "rocket.chat",
            "#licitacion",
            "mensajes sms",
            "whatsapp",
            "telegram",
            "escribiendo...",
            "en línea",
            "en linea",
            "reuniones",
            "chat",
        )
    ):
        return True
    if any(kw in fname for kw in ("teams", "whatsapp", "chat")):
        return True
    timestamps = re.findall(r"\b\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?\b", low)
    return len(timestamps) >= 2


def _preprocess_for_ocr(img: Image.Image) -> tuple[Image.Image, float]:
    """Enhance noisy scans, tilted photos, and lined forms in memory for OCR."""
    img = ImageOps.exif_transpose(img)
    gray = img.convert("L")
    w, h = gray.size
    if max(w, h) < 1400:
        scale = min(2.0, 1600 / max(w, h))
        gray = gray.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray, deskew_angle = _deskew_image(gray)
    gray = ImageEnhance.Sharpness(gray).enhance(1.6)
    return gray, deskew_angle


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


def _tesseract_in_memory(img: Image.Image, lang: str | None, psm: int, timeout: float = 90.0) -> str:
    """Run Tesseract through stdin/stdout so no plaintext image or OCR text touches the disk.

    pytesseract writes the image and the recognized text to temporary files in plaintext, which
    breaks the encryption-at-rest requirement for temporary/OCR artifacts (Sección F).
    """
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    cmd = [shutil.which("tesseract") or "tesseract", "stdin", "stdout", "--psm", str(psm)]
    if lang:
        cmd += ["-l", lang]
    proc = subprocess.run(cmd, input=buf.getvalue(), capture_output=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip()[:300] or "tesseract failed")
    return proc.stdout.decode("utf-8", "replace")


def extract_image(content: bytes) -> ImageExtractionResult:
    """Run local dual-pass Tesseract OCR + prepare crisp PNG base64 for Vision LLM."""
    img = Image.open(io.BytesIO(content))
    orig_w, orig_h = img.size
    vision_b64, mime = _prepare_for_vision(img)

    ocr_text = ""
    engine = "none"
    deskew_angle = 0.0
    try:
        processed, deskew_angle = _preprocess_for_ocr(img)
        if abs(deskew_angle) >= 0.5:
            vision_b64, mime = _prepare_for_vision(processed)
        try:
            pass_block = _tesseract_in_memory(processed, lang="spa+eng", psm=6)
            pass_auto = _tesseract_in_memory(processed, lang="spa+eng", psm=3)
            ocr_text = _merge_ocr_passes(pass_block, pass_auto)
            engine = "tesseract:spa+eng"
        except Exception:
            pass_block = _tesseract_in_memory(processed, lang=None, psm=6)
            pass_auto = _tesseract_in_memory(processed, lang=None, psm=3)
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
        deskew_angle_deg=deskew_angle,
    )
