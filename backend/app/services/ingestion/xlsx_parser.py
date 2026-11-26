"""XLSX parser with safe formula evaluation and hidden row/col/sheet/comment inspection."""

from __future__ import annotations

import ast
import io
import operator
import re
from dataclasses import dataclass, field
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string, get_column_letter


@dataclass
class XlsxExtractionResult:
    text: str
    sheets: dict[str, list[list[Any]]] = field(default_factory=dict)
    hidden_findings: list[dict[str, str]] = field(default_factory=list)


_CELL_REF_RE = re.compile(r"\b([A-Z]{1,3})(\d+)\b")
_SUM_RANGE_RE = re.compile(r"SUM\(\s*([A-Z]{1,3})(\d+)\s*:\s*([A-Z]{1,3})(\d+)\s*\)", re.IGNORECASE)
_ALLOWED_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval_arithmetic(expr: str) -> float | None:
    try:
        node = ast.parse(expr, mode="eval").body

        def _eval(n: ast.AST) -> float:
            if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
                return float(n.value)
            if isinstance(n, ast.BinOp) and type(n.op) in _ALLOWED_OPS:
                return _ALLOWED_OPS[type(n.op)](_eval(n.left), _eval(n.right))
            if isinstance(n, ast.UnaryOp) and type(n.op) in _ALLOWED_OPS:
                return _ALLOWED_OPS[type(n.op)](_eval(n.operand))
            raise ValueError("Unsupported AST node")

        return round(_eval(node), 4)
    except Exception:
        return None


def _evaluate_formula(formula: str, cell_values: dict[str, Any], depth: int = 0) -> float | None:
    if depth > 6 or not isinstance(formula, str) or not formula.startswith("="):
        return None
    expr = formula[1:].strip()

    def _resolve_cell(ref: str) -> float:
        val = cell_values.get(ref.upper())
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str) and val.startswith("="):
            evaluated = _evaluate_formula(val, cell_values, depth + 1)
            return evaluated if evaluated is not None else 0.0
        try:
            return float(str(val).replace(",", "").replace("$", "").strip())
        except Exception:
            return 0.0

    # Replace SUM(A1:A10)
    def _replace_sum(match: re.Match[str]) -> str:
        c1, r1, c2, r2 = match.group(1), int(match.group(2)), match.group(3), int(match.group(4))
        idx1, idx2 = column_index_from_string(c1), column_index_from_string(c2)
        total = 0.0
        for col_idx in range(min(idx1, idx2), max(idx1, idx2) + 1):
            col_letter = get_column_letter(col_idx)
            for row_idx in range(min(r1, r2), max(r1, r2) + 1):
                total += _resolve_cell(f"{col_letter}{row_idx}")
        return str(total)

    expr = _SUM_RANGE_RE.sub(_replace_sum, expr)

    # Replace individual cell references
    def _replace_ref(match: re.Match[str]) -> str:
        return str(_resolve_cell(f"{match.group(1)}{match.group(2)}"))

    expr = _CELL_REF_RE.sub(_replace_ref, expr)
    return _safe_eval_arithmetic(expr)


def extract_xlsx(content: bytes) -> XlsxExtractionResult:
    """Extract all visible tables, evaluated formulas, and hidden cells/comments from XLSX."""
    wb_formulas = load_workbook(io.BytesIO(content), data_only=False)
    wb_values = load_workbook(io.BytesIO(content), data_only=True)

    text_blocks: list[str] = []
    sheets_data: dict[str, list[list[Any]]] = {}
    hidden_findings: list[dict[str, str]] = []

    for sheet_name in wb_formulas.sheetnames:
        ws_f = wb_formulas[sheet_name]
        ws_v = wb_values[sheet_name]
        sheet_hidden = ws_f.sheet_state != "visible"

        # Build raw cell map for formula evaluation
        raw_map: dict[str, Any] = {}
        for row in ws_f.iter_rows():
            for cell in row:
                cached = ws_v[cell.coordinate].value
                raw_map[cell.coordinate.upper()] = cached if cached is not None else cell.value

        # Resolve any unevaluated formulas
        resolved_map: dict[str, Any] = {}
        for coord, val in raw_map.items():
            if isinstance(val, str) and val.startswith("="):
                computed = _evaluate_formula(val, raw_map)
                resolved_map[coord] = computed if computed is not None else val
            else:
                resolved_map[coord] = val

        rows_out: list[list[Any]] = []
        lines: list[str] = [f"=== Hoja: {sheet_name} ==="]

        for row in ws_f.iter_rows():
            row_idx = row[0].row
            row_hidden = bool(ws_f.row_dimensions[row_idx].hidden)
            row_vals: list[Any] = []
            row_strs: list[str] = []

            for cell in row:
                col_letter = get_column_letter(cell.column)
                col_hidden = bool(ws_f.column_dimensions[col_letter].hidden)
                val = resolved_map.get(cell.coordinate.upper())
                formula_orig = cell.value

                # Inspect cell comment
                comment = getattr(cell, "comment", None)
                if comment and comment.text:
                    hidden_findings.append(
                        {
                            "source": f"xlsx:{sheet_name}!{cell.coordinate}_comment",
                            "text": str(comment.text),
                        }
                    )

                # Inspect white font color ONLY when cell background is white/transparent (not dark header)
                font_color = getattr(getattr(getattr(cell, "font", None), "color", None), "rgb", None)
                fill = getattr(cell, "fill", None)
                fill_type = getattr(fill, "fill_type", None)
                fg_rgb = getattr(getattr(fill, "fgColor", None), "rgb", None)
                has_dark_fill = (
                    fill_type == "solid"
                    and isinstance(fg_rgb, str)
                    and not fg_rgb.upper().endswith(("FFFFFF", "00000000"))
                )
                is_white_font = (
                    isinstance(font_color, str)
                    and font_color.upper().endswith("FFFFFF")
                    and not has_dark_fill
                )

                if val is not None and str(val).strip() != "":
                    if sheet_hidden or row_hidden or col_hidden or is_white_font:
                        hidden_findings.append(
                            {
                                "source": f"xlsx:{sheet_name}!{cell.coordinate}_hidden",
                                "text": str(val),
                            }
                        )
                    else:
                        display = str(val)
                        if isinstance(formula_orig, str) and formula_orig.startswith("=") and isinstance(val, (int, float)):
                            display = f"{val:g} [fórmula: {formula_orig}]"
                        row_strs.append(f"{cell.coordinate}: {display}")
                row_vals.append(val)

            if any(v is not None for v in row_vals):
                rows_out.append(row_vals)
            if row_strs:
                lines.append(" | ".join(row_strs))

        sheets_data[sheet_name] = rows_out
        if not sheet_hidden:
            text_blocks.append("\n".join(lines))

    wb_formulas.close()
    wb_values.close()

    return XlsxExtractionResult(
        text="\n\n".join(text_blocks).strip(),
        sheets=sheets_data,
        hidden_findings=hidden_findings,
    )
