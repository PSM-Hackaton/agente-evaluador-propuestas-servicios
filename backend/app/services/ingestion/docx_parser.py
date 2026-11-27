"""Word (.docx) parser extracting paragraphs, tables, headers/footers, comments, and hidden text."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from typing import Any

from defusedxml import ElementTree as DefusedET

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@dataclass
class DocxExtractionResult:
    text: str
    hidden_findings: list[dict[str, str]] = field(default_factory=list)


def _parse_xml_safe(xml_bytes: bytes) -> Any:
    """Parse DOCX XML forbidding DTDs, entity expansion, and external entities (XXE)."""
    return DefusedET.fromstring(
        xml_bytes,
        forbid_dtd=True,
        forbid_entities=True,
        forbid_external=True,
    )


def _is_run_hidden(run: Any) -> bool:
    """Detect Word hidden text (`w:vanish`, `w:webHidden`, white font `#FFFFFF`, or micro size <= 3pt)."""
    rpr = run.find(f"{_W_NS}rPr")
    if rpr is None:
        return False
    if rpr.find(f"{_W_NS}vanish") is not None or rpr.find(f"{_W_NS}webHidden") is not None:
        return True
    color = rpr.find(f"{_W_NS}color")
    if color is not None:
        val = (color.attrib.get(f"{_W_NS}val") or "").upper()
        if val in ("FFFFFF", "FEFEFE", "FDFDFD"):
            return True
    sz = rpr.find(f"{_W_NS}sz")
    if sz is not None:
        try:
            # Word w:sz is measured in half-points (e.g. 6 = 3pt)
            if int(sz.attrib.get(f"{_W_NS}val", "20")) <= 6:
                return True
        except ValueError:
            pass
    return False


def _extract_paragraph(p: Any) -> tuple[str, str]:
    visible_parts: list[str] = []
    hidden_parts: list[str] = []
    for run in p.findall(f".//{_W_NS}r"):
        texts = [t.text or "" for t in run.findall(f"{_W_NS}t")]
        chunk = "".join(texts)
        if not chunk:
            continue
        if _is_run_hidden(run):
            hidden_parts.append(chunk)
        else:
            visible_parts.append(chunk)
    return "".join(visible_parts).strip(), "".join(hidden_parts).strip()


def _extract_xml_body(xml_bytes: bytes, source_label: str) -> tuple[list[str], list[dict[str, str]]]:
    root = _parse_xml_safe(xml_bytes)
    lines: list[str] = []
    hidden_findings: list[dict[str, str]] = []

    body = root.find(f"{_W_NS}body")
    container = body if body is not None else root

    for child in container:
        tag = child.tag
        if tag == f"{_W_NS}p":
            vis, hid = _extract_paragraph(child)
            if vis:
                lines.append(vis)
            if hid:
                hidden_findings.append({"source": f"{source_label}_hidden", "text": hid})
        elif tag == f"{_W_NS}tbl":
            for tr in child.findall(f"{_W_NS}tr"):
                row_cells: list[str] = []
                for tc in tr.findall(f"{_W_NS}tc"):
                    cell_vis: list[str] = []
                    for p in tc.findall(f".//{_W_NS}p"):
                        vis, hid = _extract_paragraph(p)
                        if vis:
                            cell_vis.append(vis)
                        if hid:
                            hidden_findings.append({"source": f"{source_label}_table_hidden", "text": hid})
                    row_cells.append(" ".join(cell_vis).strip())
                if any(row_cells):
                    lines.append(" | ".join(row_cells))

    return lines, hidden_findings


def extract_docx(content: bytes) -> DocxExtractionResult:
    """Extract visible text, tables, headers/footers, comments, and hidden text from .docx."""
    all_lines: list[str] = []
    hidden_findings: list[dict[str, str]] = []

    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        names = set(zf.namelist())

        # Headers
        for name in sorted(n for n in names if n.startswith("word/header") and n.endswith(".xml")):
            lines, hid = _extract_xml_body(zf.read(name), name)
            all_lines.extend(lines)
            hidden_findings.extend(hid)

        # Main document body
        if "word/document.xml" in names:
            lines, hid = _extract_xml_body(zf.read("word/document.xml"), "docx:document")
            all_lines.extend(lines)
            hidden_findings.extend(hid)

        # Footers
        for name in sorted(n for n in names if n.startswith("word/footer") and n.endswith(".xml")):
            lines, hid = _extract_xml_body(zf.read(name), name)
            all_lines.extend(lines)
            hidden_findings.extend(hid)

        # Comments (inspect for hidden prompt injections)
        if "word/comments.xml" in names:
            root = _parse_xml_safe(zf.read("word/comments.xml"))
            for comment in root.findall(f".//{_W_NS}comment"):
                ctext = "".join(t.text or "" for t in comment.findall(f".//{_W_NS}t")).strip()
                if ctext:
                    hidden_findings.append({"source": "docx:comment", "text": ctext})

    return DocxExtractionResult(
        text="\n".join(all_lines).strip(),
        hidden_findings=hidden_findings,
    )
