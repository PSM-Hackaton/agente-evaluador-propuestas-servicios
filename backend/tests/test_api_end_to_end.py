"""End-to-end API tests covering RBAC, encrypted uploads, agent evaluation, alerts, chat, exports, and salida.json."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient

from app.services.reports.salida_json import validate_salida_json

RETO_DIR = Path(__file__).resolve().parents[2] / "docs" / "reto"
PROPUESTAS_DIR = RETO_DIR / "propuestas"


async def _login(client: AsyncClient, email: str, password: str) -> dict[str, str]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_full_platform_workflow_and_rbac(app_client: AsyncClient) -> None:
    # 1. Health check
    health = await app_client.get("/health")
    assert health.status_code == 200
    assert health.json()["encryption_at_rest"] == "AES-256-GCM"

    # 2. Authenticate users across all 4 roles
    cargador_hdr = await _login(app_client, "cargador@evaluador.ve", "Cargador2026!")
    revisor_hdr = await _login(app_client, "revisor@evaluador.ve", "Revisor2026!")
    aprobador_hdr = await _login(app_client, "aprobador@evaluador.ve", "Aprobador2026!")
    auditor_hdr = await _login(app_client, "auditor@evaluador.ve", "Auditor2026!")

    # Auditor (read-only) MUST be blocked from creating projects
    denied = await app_client.post(
        "/api/v1/projects",
        json={"name": "No autorizado", "execution_location": "Caracas"},
        headers=auditor_hdr,
    )
    assert denied.status_code == 403

    # 3. Cargador creates project & uploads encrypted proyecto.pdf
    create_resp = await app_client.post(
        "/api/v1/projects",
        json={
            "name": "Dotación de Laboratorio de Computación — Bicentenario",
            "description": "10 equipos estudiantes + 1 docente",
            "execution_location": "La Hoyada, Caracas",
            "reference_budget": 25000.0,
            "reference_currency": "USD",
        },
        headers=cargador_hdr,
    )
    assert create_resp.status_code == 201, create_resp.text
    project_id = create_resp.json()["id"]

    proj_pdf = (RETO_DIR / "proyecto.pdf").read_bytes()
    doc_resp = await app_client.post(
        f"/api/v1/projects/{project_id}/document",
        files={"file": ("proyecto.pdf", proj_pdf, "application/pdf")},
        headers=cargador_hdr,
    )
    assert doc_resp.status_code == 200
    assert doc_resp.json()["document_filename"] == "proyecto.pdf"

    # 4. Bulk upload of 4 diverse real proposals (2 PDFs + 2 XLSX)
    sample_names = [
        "Propuesta_923_Grupo_Digital_Miranda_CA.pdf",
        "Propuesta_131_ReTech_Outlet_Venezuela_CA.pdf",
        "Propuesta_638_TecnoAndes_Soluciones_CA.xlsx",
        "Propuesta_734_Inversiones_Elite_Tech_2026_CA.xlsx",
    ]
    files_param = [
        ("files", (name, (PROPUESTAS_DIR / name).read_bytes(), "application/octet-stream"))
        for name in sample_names
    ]
    up_resp = await app_client.post(
        f"/api/v1/projects/{project_id}/proposals",
        files=files_param,
        headers=cargador_hdr,
    )
    assert up_resp.status_code == 201, up_resp.text
    assert len(up_resp.json()) == 4

    # 5. Revisor triggers autonomous evaluation ("Evaluar Propuestas de Servicios")
    eval_resp = await app_client.post(
        f"/api/v1/projects/{project_id}/evaluate",
        json={"enable_web_search": False, "bcv_rate_override": 52.5},
        headers=revisor_hdr,
    )
    assert eval_resp.status_code == 201, eval_resp.text
    ev = eval_resp.json()
    eval_id = ev["id"]
    assert ev["status"] == "completed"
    assert len(ev["trace_steps"]) >= 10

    # Verify strict filtering: Miranda & TecnoAndes VALID, ReTech (prompt injection + AM5/AM4) & Elite (DIMM overflow) DISCARDED
    evals_by_id = {pe["proposal_identifier"]: pe for pe in ev["proposal_evaluations"]}
    assert evals_by_id["Propuesta_923_Grupo_Digital_Miranda_CA"]["is_valid"] is True
    assert evals_by_id["Propuesta_638_TecnoAndes_Soluciones_CA"]["is_valid"] is True
    assert evals_by_id["Propuesta_131_ReTech_Outlet_Venezuela_CA"]["is_valid"] is False
    assert evals_by_id["Propuesta_131_ReTech_Outlet_Venezuela_CA"]["prompt_injection_detected"] is True
    assert evals_by_id["Propuesta_734_Inversiones_Elite_Tech_2026_CA"]["is_valid"] is False

    # Best valid between Miranda (Ryzen 7 + RTX 4060 Ti 16GB + ProArt + APC UPS + 24m) and TecnoAndes (Ryzen 5 + RTX 4060 + AVR + 12m) is Miranda
    assert ev["recommended_identifier"] == "Propuesta_923_Grupo_Digital_Miranda_CA"
    assert ev["ranking_identifiers"][:2] == [
        "Propuesta_923_Grupo_Digital_Miranda_CA",
        "Propuesta_638_TecnoAndes_Soluciones_CA",
    ]

    # Validate salida.json schema strictly
    ok, errs = validate_salida_json(ev["salida_json_payload"], expected_filenames=sample_names)
    assert ok, errs

    # 6. Supplier directory automatically populated with alerts for discarded suppliers
    sup_resp = await app_client.get("/api/v1/suppliers?only_with_alerts=true", headers=auditor_hdr)
    assert sup_resp.status_code == 200
    alerted_suppliers = sup_resp.json()
    assert len(alerted_suppliers) >= 2

    # 7. Human review & workflow transitions (Revisor -> comité; Aprobador -> adjudicado)
    rev_resp = await app_client.post(
        f"/api/v1/evaluations/{eval_id}/reviews",
        json={"decision": "confirmed", "notes": "Se confirma la recomendación técnica y financiera de la IA."},
        headers=revisor_hdr,
    )
    assert rev_resp.status_code == 201

    t1 = await app_client.post(
        f"/api/v1/projects/{project_id}/status",
        json={"target_status": "en_revision_comite", "notes": "Enviado a comité"},
        headers=revisor_hdr,
    )
    assert t1.status_code == 200

    # Revisor CANNOT adjudicate (requires aprobador/admin)
    t2_denied = await app_client.post(
        f"/api/v1/projects/{project_id}/status",
        json={"target_status": "adjudicado"},
        headers=revisor_hdr,
    )
    assert t2_denied.status_code == 403

    t2_ok = await app_client.post(
        f"/api/v1/projects/{project_id}/status",
        json={
            "target_status": "adjudicado",
            "adjudicated_proposal_id": ev["recommended_proposal_id"],
            "notes": "Adjudicado por comité de compras.",
        },
        headers=aprobador_hdr,
    )
    assert t2_ok.status_code == 200
    assert t2_ok.json()["status"] == "adjudicado"

    # 8. Grounded natural-language Q&A chat
    chat_resp = await app_client.post(
        f"/api/v1/projects/{project_id}/chat",
        json={"question": "¿Por qué se descartó ReTech Outlet?"},
        headers=auditor_hdr,
    )
    assert chat_resp.status_code == 200
    assert "DESCARTADA" in chat_resp.json()["content"]
    assert len(chat_resp.json()["citations"]) >= 1

    # 9. Report exports: PDF, Markdown, XLSX, CSV, salida.json
    for fmt, expected_ct in [
        ("pdf", "application/pdf"),
        ("markdown", "text/markdown"),
        ("xlsx", "spreadsheetml"),
        ("csv", "text/csv"),
        ("salida-json", "application/json"),
    ]:
        exp = await app_client.get(f"/api/v1/evaluations/{eval_id}/export/{fmt}", headers=auditor_hdr)
        assert exp.status_code == 200, f"Export {fmt} failed"
        assert expected_ct in exp.headers["content-type"]
        assert len(exp.content) > 50

    # 10. Audit log recorded all actions
    logs = await app_client.get("/api/v1/audit-logs?limit=50", headers=auditor_hdr)
    assert logs.status_code == 200
    actions = {entry["action"] for entry in logs.json()}
    assert "project.create" in actions
    assert "proposal.bulk_upload" in actions
    assert "evaluation.trigger" in actions
    assert "project.status_transition" in actions

    # 11. Query-param ?token= auth works for browser EventSource (SSE) & direct report downloads
    raw_token = auditor_hdr["Authorization"].split(" ", 1)[1]
    qp_export = await app_client.get(f"/api/v1/evaluations/{eval_id}/export/markdown?token={raw_token}")
    assert qp_export.status_code == 200
    assert "Propuesta Recomendada" in qp_export.text

    # 12. Dashboard aggregate stats & security posture endpoint
    dash = await app_client.get("/api/v1/dashboard/stats", headers=auditor_hdr)
    assert dash.status_code == 200, dash.text
    ddata = dash.json()
    assert ddata["projects_total"] >= 1
    assert ddata["prompt_injections_blocked"] >= 1
    assert ddata["active_supplier_alerts"] >= 2
    assert ddata["security_status"]["encryption_at_rest"] == "AES-256-GCM"

    # 13. Frontend convenience checks: project document download, proposal detail, CORS Content-Disposition, override & chat clear
    proj_dl = await app_client.get(f"/api/v1/projects/{project_id}/document/download?token={raw_token}")
    assert proj_dl.status_code == 200
    assert proj_dl.content == proj_pdf

    first_prop_id = up_resp.json()[0]["id"]
    prop_detail = await app_client.get(f"/api/v1/proposals/{first_prop_id}", headers=auditor_hdr)
    assert prop_detail.status_code == 200
    assert prop_detail.json()["extracted_text_preview"] is not None

    cors_resp = await app_client.get(
        f"/api/v1/evaluations/{eval_id}/export/pdf",
        headers={
            **auditor_hdr,
            "Origin": "http://127.0.0.1:5173",
        },
    )
    assert cors_resp.status_code == 200
    assert cors_resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"
    assert "content-disposition" in cors_resp.headers.get("access-control-expose-headers", "").lower()

    override_target = next(
        p["id"]
        for p in up_resp.json()
        if p["proposal_identifier"] == "Propuesta_638_TecnoAndes_Soluciones_CA"
    )
    ovr_resp = await app_client.post(
        f"/api/v1/evaluations/{eval_id}/reviews",
        json={
            "decision": "overridden",
            "notes": "Ajuste de prueba por comité.",
            "override_recommended_proposal_id": override_target,
        },
        headers=aprobador_hdr,
    )
    assert ovr_resp.status_code == 201
    ev_after = await app_client.get(f"/api/v1/evaluations/{eval_id}", headers=auditor_hdr)
    assert ev_after.json()["recommended_identifier"] == "Propuesta_638_TecnoAndes_Soluciones_CA"

    clr_resp = await app_client.delete(f"/api/v1/projects/{project_id}/chat", headers=revisor_hdr)
    assert clr_resp.status_code == 204
    chat_hist = await app_client.get(f"/api/v1/projects/{project_id}/chat", headers=auditor_hdr)
    assert chat_hist.status_code == 200
    assert chat_hist.json() == []
