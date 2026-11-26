"""Regresiones de la revisión técnica del backend (Reto 1).

Cubren: normalización de nombres de proveedor en capturas de chat, falsos positivos de la auditoría
técnica, confidencialidad de las consultas web, robustez ante JSON mal tipado del LLM, validación de la
adjudicación, desglose del costo real en los informes y guarda de secretos inseguros.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.services.agent import orchestrator
from app.services.agent.orchestrator import (
    _normalize_structured,
    _spec_context_for_price,
    _to_float,
    evaluate_proposals_core,
)
from app.services.agent.technical_audit import audit_proposal_technically
from app.services.agent.tools import clean_supplier_name, extract_proposal_structured_heuristic
from app.services.market.search import _build_focused_query, search_market_price

RETO_DIR = Path(__file__).resolve().parents[2] / "docs" / "reto"


# ---------------------------------------------------------------------------
# Nombres de proveedor (directorio E.3 e informe)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "Microsoft Teams #licitacion-bicentenario Krypton Ingeniería C.A. + RIF J-41223344-9",
            "Krypton Ingeniería C.A.",
        ),
        ("Rocket.Chat #compras-lab Mayorista Sin Fronteras C.A. + RIF J-50990011-7", "Mayorista Sin Fronteras C.A."),
        ("Ing. Luisana Pérez — Ávila Hardware & Redes C.A.", "Ávila Hardware & Redes C.A."),
        ("Elena Vargas — Distribuidora 10x10 Tech C.A.", "Distribuidora 10x10 Tech C.A."),
        ("TECNOANDES SOLUCIONES C.A.", "Tecnoandes Soluciones C.A."),
        ("Grupo Digital Miranda C.A.", "Grupo Digital Miranda C.A."),
    ],
)
def test_clean_supplier_name_removes_chat_banners_rif_and_contact(raw: str, expected: str) -> None:
    assert clean_supplier_name(raw) == expected


def test_heuristic_extraction_uses_clean_supplier_name_for_chat_capture() -> None:
    text = (
        "Microsoft Teams #licitacion-bicentenario Krypton Ingeniería C.A. + RIF J-41223344-9\n"
        "Estudiantes (10x): Intel Core i7-13700F | RTX 4070 12GB — $1,980.00 c/u\n"
        "TOTAL GENERAL: USD $23,020.00"
    )
    st = extract_proposal_structured_heuristic("Propuesta_602_Krypton_Ingenieria_CA", text)
    assert st["supplier_name"] == "Krypton Ingeniería C.A."
    assert st["supplier_rif"] == "J-41223344-9"


# ---------------------------------------------------------------------------
# Auditoría técnica: falsos positivos
# ---------------------------------------------------------------------------
_VALID_BASE = (
    "Estación Estudiantes 10 x $1,200.00 | CPU: AMD Ryzen 5 7600 | RAM: 32GB DDR5 (4x8GB, 2 slots libres) | "
    "Expansión: B650M, 4xDIMM | GPU RTX 4060 | Monitor 24\" IPS | Teclado y ratón | Regulador AVR 1200VA | "
    "Instalación en sitio | Estación Docente 1 x $1,500.00 | SO: Ubuntu 24.04 LTS | Garantía: 12 meses."
)
_PROJECT_REQ = "Diez (10) computadoras para estudiantes y una (1) para el docente; once (11) equipos."


def test_word_evaluacion_alone_is_not_a_trial_license() -> None:
    text = _VALID_BASE + " Quedamos atentos a la evaluación del comité; propuesta para su evaluación."
    res = audit_proposal_technically(text, {"student_pc_count": 10, "teacher_pc_count": 1}, _PROJECT_REQ)
    codes = {r["code"] for r in res.discard_reasons}
    assert "costos_condiciones_abusivas" not in codes


def test_free_slots_are_not_read_as_board_slots() -> None:
    res = audit_proposal_technically(_VALID_BASE, {"student_pc_count": 10, "teacher_pc_count": 1}, _PROJECT_REQ)
    assert not any("ranuras DIMM" in r["detail"] for r in res.discard_reasons)
    assert res.is_technically_valid is True


def test_windows_evaluation_license_is_abusive_and_not_reported_as_open_source() -> None:
    text = _VALID_BASE.replace(
        "SO: Ubuntu 24.04 LTS",
        "Software: Windows 11 Pro (Evaluación) (requiere compra de licencias al vencer 30 días). Ubuntu opcional",
    )
    res = audit_proposal_technically(text, {"student_pc_count": 10, "teacher_pc_count": 1}, _PROJECT_REQ)
    assert any(r["code"] == "costos_condiciones_abusivas" for r in res.discard_reasons)
    assert not any("open source" in f for f in res.technical_findings)


# ---------------------------------------------------------------------------
# Contraste de mercado: confidencialidad y honestidad del resultado
# ---------------------------------------------------------------------------
def test_market_query_never_leaks_supplier_identifiers() -> None:
    q = _build_focused_query(
        "Envío y Logística Express Digital, C.A. COTIZACIÓN RIF J-50112200-1, ExpDig@gmail.com +584228002020"
    )
    assert "J-50112200-1" not in q
    assert "@" not in q
    assert "584228002020" not in q


@pytest.mark.asyncio
async def test_market_comparison_without_reference_is_not_reported_as_fair() -> None:
    res = await search_market_price("Servicio genérico sin modelo", 300.0, enable_web=False)
    assert res["status"] == "sin_referencia"
    assert res["is_abusive_overprice"] is False


def test_spec_context_for_price_returns_item_specs() -> None:
    text = (
        "Krypton Ingeniería C.A. RIF J-41223344-9\n"
        "Estudiantes (10x): Krypton Studio | Intel Core i7-13700F | 32GB RAM | RTX 4070 12GB — $1,980.00 c/u\n"
    )
    ctx = _spec_context_for_price(text, 1980.0)
    assert "RTX 4070" in ctx
    assert _build_focused_query(f"Estación Estudiantes {ctx}").lower().startswith("intel core i7-13700f rtx 4070")


# ---------------------------------------------------------------------------
# Robustez ante salidas del LLM con tipos inesperados
# ---------------------------------------------------------------------------
def test_to_float_parses_money_and_percent_strings() -> None:
    assert _to_float("$15,550.00") == 15550.0
    assert _to_float("50%") == 50.0
    assert _to_float("1.234,50") == 1234.5
    assert _to_float(None, 7.0) == 7.0
    assert _to_float("n/a", 3.0) == 3.0


def test_normalize_structured_coerces_llm_types() -> None:
    llm = {
        "declared_total": "$15,550.00",
        "hidden_surcharge_pct": "50%",
        "shipping_included_in_total": "no",
        "student_pc_count": "10",
        "line_items": [{"description": "PC", "quantity": "10", "unit_price": "$1,340.00"}, "basura"],
        "fine_print_notes": "No incluye flete",
        "llm_detected_issues": ["texto suelto", {"code": "error_aritmetico", "detail": "x"}],
    }
    out = _normalize_structured(llm, {"line_items": []})
    assert out["declared_total"] == 15550.0
    assert out["hidden_surcharge_pct"] == 50.0
    assert out["shipping_included_in_total"] is False
    assert out["student_pc_count"] == 10
    assert out["line_items"] == [
        {"description": "PC", "quantity": 10.0, "unit_price": 1340.0, "declared_subtotal": None, "category": "item"}
    ]
    assert out["fine_print_notes"] == ["No incluye flete"]
    assert out["llm_detected_issues"] == [{"code": "error_aritmetico", "detail": "x"}]


class _FakeLLM:
    """LLM simulado: responde JSON con montos como texto (respuesta grabada típica de un modelo)."""

    provider = "simulado"
    is_available = True

    async def extract_from_image(self, *_: Any, **__: Any) -> str | None:
        return None

    async def generate_json(self, system_prompt: str, user_prompt: str, images_b64: Any = None) -> dict | None:
        if "ordered_ids" in system_prompt:
            return {"ordered_ids": "no-es-lista"}
        return {
            "supplier_name": "WhatsApp #ventas Ávila Hardware & Redes C.A. + RIF J-40556677-8",
            "declared_total": "$15,550.00",
            "currency": "USD",
            "shipping_cost": "180",
            "shipping_included_in_total": "true",
            "hidden_surcharge_pct": None,
            "line_items": [
                {"description": "PC estudiante", "quantity": "10", "unit_price": "$1,340.00", "category": "estaciones_estudiantes"},
                {"description": "PC docente", "quantity": 1, "unit_price": "1650", "category": "estacion_docente"},
                {"description": "Envío", "quantity": 1, "unit_price": "180", "category": "envio"},
                {"description": "Instalación", "quantity": 1, "unit_price": "320", "category": "instalacion"},
            ],
            "llm_detected_issues": ["sin estructura"],
        }

    async def generate_text(self, *_: Any, **__: Any) -> str | None:
        return None


@pytest.mark.asyncio
async def test_evaluation_survives_string_typed_llm_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orchestrator, "UnifiedLLMClient", _FakeLLM)
    body = (
        "Ávila Hardware & Redes C.A. RIF J-40556677-8\n"
        "1) Estudiantes (10x): AMD Ryzen 5 7600X | 16GB RAM | 1TB NVMe | RTX 3060 12GB — $1,340.00 c/u\n"
        "2) Docente (1x): AMD Ryzen 7 7700X | 32GB | RTX 4060 8GB — $1,650.00\n"
        "3) Periféricos: Monitor LG 24\" IPS | teclado y ratón | UPS Interactivo APC 1000VA/600W\n"
        "Software: Linux Mint | Envío: $180.00 | Instalación: $320.00 | Garantía: 24 meses\n"
        "TOTAL: USD $15,550.00\n"
    ).encode()
    out = await evaluate_proposals_core(
        project_name="Prueba",
        project_location="La Hoyada, Caracas",
        project_requirements_text=_PROJECT_REQ,
        proposal_files=[(None, "Propuesta_841_Avila_CA.txt", body)],
        enable_web_search=False,
        bcv_rate_override=50.0,
    )
    res = out.results[0]
    assert res.supplier_name == "Ávila Hardware & Redes C.A."
    assert res.arithmetic_valid is True
    assert res.adjusted_tco_usd == 15550.0
    assert out.ranking_identifiers == ["Propuesta_841_Avila_CA"]


# ---------------------------------------------------------------------------
# API: adjudicación y desglose del costo real en informes
# ---------------------------------------------------------------------------
async def _login(client: AsyncClient, email: str, password: str) -> dict[str, str]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_adjudication_rejects_foreign_proposal_and_reports_include_cost_breakdown(
    app_client: AsyncClient,
) -> None:
    cargador = await _login(app_client, "cargador@evaluador.ve", "Cargador2026!")
    revisor = await _login(app_client, "revisor@evaluador.ve", "Revisor2026!")
    aprobador = await _login(app_client, "aprobador@evaluador.ve", "Aprobador2026!")

    created = await app_client.post(
        "/api/v1/projects",
        json={"name": "Proyecto <Lab> & Co", "execution_location": "La Hoyada, Caracas"},
        headers=cargador,
    )
    project_id = created.json()["id"]
    name = "Propuesta_923_Grupo_Digital_Miranda_CA.pdf"
    up = await app_client.post(
        f"/api/v1/projects/{project_id}/proposals",
        files=[("files", (name, (RETO_DIR / "propuestas" / name).read_bytes(), "application/pdf"))],
        headers=cargador,
    )
    assert up.status_code == 201, up.text
    proposal_id = up.json()[0]["id"]

    ev = await app_client.post(
        f"/api/v1/projects/{project_id}/evaluate",
        json={"enable_web_search": False, "run_in_background": False, "bcv_rate_override": 50.0},
        headers=revisor,
    )
    assert ev.status_code == 201, ev.text
    eval_id = ev.json()["id"]

    review = await app_client.post(
        f"/api/v1/evaluations/{eval_id}/reviews",
        json={"decision": "observed", "notes": "Verificar costo < mercado & garantía <24m>"},
        headers=revisor,
    )
    assert review.status_code == 201, review.text

    md = await app_client.get(f"/api/v1/evaluations/{eval_id}/export/markdown", headers=revisor)
    assert md.status_code == 200
    assert "Desglose del Costo Real" in md.text
    assert "Monto declarado" in md.text

    pdf = await app_client.get(f"/api/v1/evaluations/{eval_id}/export/pdf", headers=revisor)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")

    to_committee = await app_client.post(
        f"/api/v1/projects/{project_id}/status", json={"target_status": "en_revision_comite"}, headers=revisor
    )
    assert to_committee.status_code == 200, to_committee.text

    bogus = await app_client.post(
        f"/api/v1/projects/{project_id}/status",
        json={"target_status": "adjudicado", "adjudicated_proposal_id": "no-existe"},
        headers=aprobador,
    )
    assert bogus.status_code == 400

    ok = await app_client.post(
        f"/api/v1/projects/{project_id}/status",
        json={"target_status": "adjudicado", "adjudicated_proposal_id": proposal_id},
        headers=aprobador,
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "adjudicado"


# ---------------------------------------------------------------------------
# Seguridad: secretos por defecto
# ---------------------------------------------------------------------------
def test_insecure_secret_settings_detects_placeholders() -> None:
    from app.core.config import Settings

    weak = Settings(
        master_encryption_key="CHANGE_ME_GENERATE_32_BYTE_BASE64_KEY_FOR_PRODUCTION",
        jwt_secret_key="corto",
    ).insecure_secret_settings()
    assert weak == ["MASTER_ENCRYPTION_KEY", "JWT_SECRET_KEY"]

    strong = Settings(
        master_encryption_key="1PqDxv6XUj3WGF0X0Wq5Y0m3nH5o8l7aZgk1V4kq6aE=",
        jwt_secret_key="b3c1f0e9a8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1",
    ).insecure_secret_settings()
    assert strong == []
