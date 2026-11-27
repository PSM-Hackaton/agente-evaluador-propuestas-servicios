"""Parsers for legacy Excel (.xls), CSV/TSV tabular files, and plain text (.txt/.md)."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field


@dataclass
class TabularExtractionResult:
    text: str
    hidden_findings: list[dict[str, str]] = field(default_factory=list)


def decode_text_safely(content: bytes) -> str:
    """Decode UTF-8 (with or without BOM) falling back cleanly to Latin-1/CP1252."""
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def extract_csv_or_tsv(content: bytes, is_tsv: bool = False) -> TabularExtractionResult:
    """Parse CSV/TSV preserving structured columns so downstream arithmetic & specs extraction works cleanly."""
    raw = decode_text_safely(content)
    delimiter = "\t" if is_tsv else ","
    if not is_tsv:
        try:
            dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;|\t")
            delimiter = dialect.delimiter
        except csv.Error:
            if raw.count(";") > raw.count(","):
                delimiter = ";"

    reader = csv.reader(io.StringIO(raw), delimiter=delimiter)
    lines: list[str] = []
    for row in reader:
        cleaned = [cell.strip() for cell in row]
        if any(cleaned):
            lines.append(" | ".join(cleaned))

    return TabularExtractionResult(text="\n".join(lines).strip())


def extract_xls(content: bytes) -> TabularExtractionResult:
    """Parse legacy Excel 97-2003 (.xls) files using xlrd, flagging hidden sheets."""
    import xlrd

    wb = xlrd.open_workbook(file_contents=content)
    blocks: list[str] = []
    hidden_findings: list[dict[str, str]] = []

    for sheet in wb.sheets():
        is_hidden = getattr(sheet, "visibility", 0) != 0
        lines: list[str] = [f"=== Hoja: {sheet.name} ==="]
        for r_idx in range(sheet.nrows):
            row_vals: list[str] = []
            for c_idx in range(sheet.ncols):
                val = sheet.cell_value(r_idx, c_idx)
                if val is not None and str(val).strip() != "":
                    if isinstance(val, float) and val.is_integer():
                        row_vals.append(str(int(val)))
                    else:
                        row_vals.append(str(val).strip())
            if row_vals:
                joined = " | ".join(row_vals)
                if is_hidden:
                    hidden_findings.append({"source": f"xls:{sheet.name}_hidden_sheet", "text": joined})
                else:
                    lines.append(joined)
        if not is_hidden:
            blocks.append("\n".join(lines))

    return TabularExtractionResult(text="\n\n".join(blocks).strip(), hidden_findings=hidden_findings)
