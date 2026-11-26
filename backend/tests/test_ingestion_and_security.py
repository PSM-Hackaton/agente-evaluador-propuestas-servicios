"""Tests for multimodal ingestion, XLSX formula evaluation, and prompt-injection detection on real reto files."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.agent.technical_audit import audit_proposal_technically
from app.services.agent.tools import extract_proposal_structured_heuristic
from app.services.finance.tco import compute_tco_breakdown, verify_arithmetic
from app.services.ingestion.pipeline import ingest_document

RETO_DIR = Path(__file__).resolve().parents[2] / "docs" / "reto"
PROPUESTAS_DIR = RETO_DIR / "propuestas"


@pytest.mark.asyncio
async def test_detects_hidden_white_text_prompt_injection_and_am5_am4_mismatch() -> None:
    pdf_path = PROPUESTAS_DIR / "Propuesta_131_ReTech_Outlet_Venezuela_CA.pdf"
    doc = await ingest_document(pdf_path.name, pdf_path.read_bytes(), llm_client=None)

    assert doc.injection_scan.detected is True
    assert len(doc.hidden_findings) >= 1
    assert "SYSTEM INSTRUCTION" not in doc.sanitized_text or "REDACTADO" in doc.sanitized_text

    structured = extract_proposal_structured_heuristic(doc.identifier, doc.sanitized_text)
    tech = audit_proposal_technically(doc.sanitized_text, structured)
    assert tech.is_technically_valid is False
    codes = {r["code"] for r in tech.discard_reasons}
    assert "incompatibilidad_tecnica" in codes


@pytest.mark.asyncio
async def test_xlsx_formula_evaluation_and_dimm_overflow_detection() -> None:
    # Valid XLSX with formulas C8*D8 and SUM(E8:E14)
    p_valid = PROPUESTAS_DIR / "Propuesta_638_TecnoAndes_Soluciones_CA.xlsx"
    doc_valid = await ingest_document(p_valid.name, p_valid.read_bytes(), llm_client=None)
    st_valid = extract_proposal_structured_heuristic(doc_valid.identifier, doc_valid.sanitized_text)
    assert st_valid["declared_total"] == 13820.0
    arith = verify_arithmetic(st_valid["line_items"], st_valid["declared_total"])
    assert arith.is_valid is True

    # Invalid XLSX: 64GB (4x16GB) on H610M-K (2xDIMM, max 32GB)
    p_bad = PROPUESTAS_DIR / "Propuesta_734_Inversiones_Elite_Tech_2026_CA.xlsx"
    doc_bad = await ingest_document(p_bad.name, p_bad.read_bytes(), llm_client=None)
    st_bad = extract_proposal_structured_heuristic(doc_bad.identifier, doc_bad.sanitized_text)
    tech_bad = audit_proposal_technically(doc_bad.sanitized_text, st_bad)
    assert tech_bad.is_technically_valid is False
    assert any(r["code"] == "incompatibilidad_tecnica" for r in tech_bad.discard_reasons)


def test_arithmetic_and_tco_normalization_with_hidden_freight_and_iva() -> None:
    bad_items = [
        {"description": "PC Estudiante", "quantity": 10, "unit_price": 1000, "declared_subtotal": 10000},
        {"description": "PC Docente", "quantity": 1, "unit_price": 1500, "declared_subtotal": 1500},
    ]
    # Wrong declared total ($11,000 instead of $11,500)
    res = verify_arithmetic(bad_items, declared_total=11000.0)
    assert res.is_valid is False
    assert res.discrepancy == 500.0

    # VES quote with hidden 50% freight surcharge and 16% IVA not included
    tco = compute_tco_breakdown(
        declared_total=525000.0,  # 10,000 USD at 52.50
        currency="VES",
        bcv_rate=52.50,
        hidden_surcharge_pct=50.0,
        iva_applies=True,
        iva_included=False,
        iva_rate=0.16,
    )
    assert tco["declared_total_usd"] == 10000.0
    assert tco["hidden_surcharges_usd"] == 5000.0
    assert tco["taxes_iva_usd"] == 2400.0  # 16% of 15,000
    assert tco["adjusted_tco_usd"] == 17400.0
    assert tco["adjusted_tco_ves"] == 913500.0
