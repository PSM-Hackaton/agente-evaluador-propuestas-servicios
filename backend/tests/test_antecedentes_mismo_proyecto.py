"""Reevaluar un proyecto no convierte sus propias alertas en antecedentes del proveedor."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient

PROPUESTAS_DIR = Path(__file__).resolve().parents[2] / "docs" / "reto" / "propuestas"


async def _login(client: AsyncClient, email: str, password: str) -> dict[str, str]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_reevaluar_mismo_proyecto_no_repite_antecedentes(app_client: AsyncClient) -> None:
    cargador = await _login(app_client, "cargador@evaluador.ve", "Cargador2026!")
    revisor = await _login(app_client, "revisor@evaluador.ve", "Revisor2026!")
    proyecto = await app_client.post(
        "/api/v1/projects", json={"name": "Reevaluación sin antecedentes propios"}, headers=cargador
    )
    assert proyecto.status_code == 201, proyecto.text
    pid = proyecto.json()["id"]
    nombres = [
        "Propuesta_131_ReTech_Outlet_Venezuela_CA.pdf",
        "Propuesta_923_Grupo_Digital_Miranda_CA.pdf",
        "Propuesta_638_TecnoAndes_Soluciones_CA.xlsx",
    ]
    files = [("files", (n, (PROPUESTAS_DIR / n).read_bytes(), "application/octet-stream")) for n in nombres]
    assert (await app_client.post(f"/api/v1/projects/{pid}/proposals", files=files, headers=cargador)).status_code == 201

    puntajes = []
    for _ in range(2):
        r = await app_client.post(
            f"/api/v1/projects/{pid}/evaluate",
            json={"enable_web_search": False, "bcv_rate_override": 50.0, "run_in_background": False},
            headers=revisor,
        )
        assert r.status_code == 201, r.text
        detalle = (await app_client.get(f"/api/v1/evaluations/{r.json()['id']}", headers=revisor)).json()
        p131 = next(p for p in (detalle.get("proposal_evaluations") or detalle.get("proposals") or detalle.get("results") or []) if "131" in p["proposal_identifier"])
        puntajes.append(p131["overall_score"])
        texto = p131.get("discard_verdict_text") or ""
        antecedentes = texto.split("Antecedentes previos registrados:", 1)[1] if "Antecedentes previos" in texto else ""
        # Puede haber antecedentes de otros proyectos, pero nunca de este mismo.
        assert "Reevaluación sin antecedentes propios" not in antecedentes, texto

    assert puntajes[0] == puntajes[1], "la segunda evaluación no debe penalizar por alertas del mismo proyecto"
