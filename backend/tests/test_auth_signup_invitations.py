"""Integration tests for Issue #70: public signup (/auth/signup) and invitation codes (/auth/invitations)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.v1.auth import reset_login_rate_limiter
from app.core.crypto import blind_index
from app.db.base import get_session_factory
from app.db.models import AuditLog, InvitationCode, utcnow


async def _auth_headers(client: AsyncClient, email: str, password: str) -> dict[str, str]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_invitations_crud_and_security(app_client: AsyncClient) -> None:
    admin_hdr = await _auth_headers(app_client, "admin@evaluador.ve", "Admin2026!")
    cargador_hdr = await _auth_headers(app_client, "cargador@evaluador.ve", "Cargador2026!")

    # Non-admin cannot create or list invitations
    r_forbid = await app_client.post("/api/v1/auth/invitations", json={"role": "revisor"}, headers=cargador_hdr)
    assert r_forbid.status_code == 403
    r_list_forbid = await app_client.get("/api/v1/auth/invitations", headers=cargador_hdr)
    assert r_list_forbid.status_code == 403

    # Admin creates an invitation
    r_create = await app_client.post(
        "/api/v1/auth/invitations",
        json={"role": "revisor", "email": "nuevo.revisor@evaluador.ve", "max_uses": 2, "expires_in_hours": 48},
        headers=admin_hdr,
    )
    assert r_create.status_code == 201
    created = r_create.json()
    assert created["code"].startswith("INV-")
    assert created["code_prefix"] == created["code"][:8]
    assert created["role"] == "revisor"
    assert created["email"] == "nuevo.revisor@evaluador.ve"
    assert created["max_uses"] == 2
    assert created["uses_count"] == 0
    assert created["revoked_at"] is None

    # List returns invitations WITHOUT plaintext code
    r_list = await app_client.get("/api/v1/auth/invitations", headers=admin_hdr)
    assert r_list.status_code == 200
    items = r_list.json()
    match = next(i for i in items if i["id"] == created["id"])
    assert "code" not in match
    assert match["code_prefix"] == created["code_prefix"]

    # Validate returns 200 with role & email_locked (case-insensitive)
    r_val = await app_client.post("/api/v1/auth/invitations/validate", json={"code": created["code"].lower()})
    assert r_val.status_code == 200
    vbody = r_val.json()
    assert vbody["valid"] is True
    assert vbody["role"] == "revisor"
    assert vbody["email_locked"] == "nuevo.revisor@evaluador.ve"

    # Revoke invitation (204) -> subsequent validate returns 404
    r_rev = await app_client.delete(f"/api/v1/auth/invitations/{created['id']}", headers=admin_hdr)
    assert r_rev.status_code == 204
    r_val_after = await app_client.post("/api/v1/auth/invitations/validate", json={"code": created["code"]})
    assert r_val_after.status_code == 404

    # Audit logs recorded invitation.create and invitation.revoke
    async with get_session_factory()() as db:
        audit_rows = (
            await db.execute(select(AuditLog.action).where(AuditLog.resource_id == created["id"]))
        ).scalars().all()
    assert "invitation.create" in audit_rows
    assert "invitation.revoke" in audit_rows


@pytest.mark.asyncio
async def test_invitation_validate_invalid_expired_and_exhausted(app_client: AsyncClient) -> None:
    admin_hdr = await _auth_headers(app_client, "admin@evaluador.ve", "Admin2026!")

    # Unknown code -> 404
    r_missing = await app_client.post("/api/v1/auth/invitations/validate", json={"code": "INV-ZZZZ-9999"})
    assert r_missing.status_code == 404

    # Expired code -> 410
    r_exp = await app_client.post(
        "/api/v1/auth/invitations",
        json={"role": "auditor", "max_uses": 1, "expires_in_hours": 1},
        headers=admin_hdr,
    )
    assert r_exp.status_code == 201
    exp_data = r_exp.json()
    async with get_session_factory()() as db:
        inv_row = await db.get(InvitationCode, exp_data["id"])
        assert inv_row is not None
        inv_row.expires_at = utcnow() - timedelta(minutes=5)
        await db.commit()

    r_val_exp = await app_client.post("/api/v1/auth/invitations/validate", json={"code": exp_data["code"]})
    assert r_val_exp.status_code == 410

    # Exhausted code -> 410
    r_exh = await app_client.post(
        "/api/v1/auth/invitations",
        json={"role": "aprobador", "max_uses": 1, "expires_in_hours": 24},
        headers=admin_hdr,
    )
    exh_data = r_exh.json()
    async with get_session_factory()() as db:
        exh_row = await db.get(InvitationCode, exh_data["id"])
        assert exh_row is not None
        exh_row.uses_count = 1
        await db.commit()

    r_val_exh = await app_client.post("/api/v1/auth/invitations/validate", json={"code": exh_data["code"]})
    assert r_val_exh.status_code == 410


@pytest.mark.asyncio
async def test_public_signup_open_and_with_invitation(app_client: AsyncClient) -> None:
    admin_hdr = await _auth_headers(app_client, "admin@evaluador.ve", "Admin2026!")

    # 1. Open signup without invitation assigns minimum role 'cargador'
    r_open = await app_client.post(
        "/api/v1/auth/signup",
        json={
            "full_name": "Usuario Abierto",
            "email": "abierto.issue70@evaluador.ve",
            "password": "PasswordSegura2026!",
        },
    )
    assert r_open.status_code == 201
    open_tok = r_open.json()
    assert open_tok["role"] == "cargador"
    assert open_tok["access_token"]
    assert open_tok["refresh_token"]

    # Duplicate email -> 409
    r_dup = await app_client.post(
        "/api/v1/auth/signup",
        json={
            "full_name": "Otro",
            "email": "abierto.issue70@evaluador.ve",
            "password": "PasswordSegura2026!",
        },
    )
    assert r_dup.status_code == 409

    # 2. Signup with email-locked invitation
    r_inv = await app_client.post(
        "/api/v1/auth/invitations",
        json={"role": "aprobador", "email": "invitado.issue70@evaluador.ve", "max_uses": 1, "expires_in_hours": 24},
        headers=admin_hdr,
    )
    code = r_inv.json()["code"]
    inv_id = r_inv.json()["id"]

    # Wrong email -> 403
    r_wrong = await app_client.post(
        "/api/v1/auth/signup",
        json={
            "full_name": "Intruso",
            "email": "otro.issue70@evaluador.ve",
            "password": "PasswordSegura2026!",
            "invitation_code": code,
        },
    )
    assert r_wrong.status_code == 403

    # Matching email -> 201 with invited role 'aprobador', uses_count incremented
    r_ok = await app_client.post(
        "/api/v1/auth/signup",
        json={
            "full_name": "Comité Invitado",
            "email": "invitado.issue70@evaluador.ve",
            "password": "PasswordSegura2026!",
            "invitation_code": code,
        },
    )
    assert r_ok.status_code == 201
    tok = r_ok.json()
    assert tok["role"] == "aprobador"
    assert tok["full_name"] == "Comité Invitado"

    # Second use of exhausted single-use invitation -> 410
    r_second = await app_client.post(
        "/api/v1/auth/signup",
        json={
            "full_name": "Segundo Intento",
            "email": "segundo.issue70@evaluador.ve",
            "password": "PasswordSegura2026!",
            "invitation_code": code,
        },
    )
    assert r_second.status_code == 410

    # Verify uses_count and audit log recorded auth.signup
    async with get_session_factory()() as db:
        inv_row = await db.get(InvitationCode, inv_id)
        assert inv_row is not None
        assert inv_row.uses_count == 1
        signup_audits = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action_hash == blind_index("auth.signup"),
                    AuditLog.resource_id == tok["user_id"],
                )
            )
        ).scalars().all()
    assert len(signup_audits) == 1
    assert signup_audits[0].action == "auth.signup"


@pytest.mark.asyncio
async def test_invitation_validate_rate_limit(app_client: AsyncClient) -> None:
    reset_login_rate_limiter()
    last_status = 0
    for _ in range(21):
        resp = await app_client.post("/api/v1/auth/invitations/validate", json={"code": "INV-TEST-0000"})
        last_status = resp.status_code
    assert last_status == 429
    reset_login_rate_limiter()
