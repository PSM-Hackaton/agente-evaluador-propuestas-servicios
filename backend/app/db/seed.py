"""Seed default role-based demo users for immediate hackathon evaluation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import UserRole, hash_password
from app.db.models import User

DEFAULT_USERS = [
    ("admin@evaluador.ve", "Administrador del Sistema", "Admin2026!", UserRole.ADMIN.value),
    ("cargador@evaluador.ve", "Elena Rivas (Carga Documental)", "Cargador2026!", UserRole.CARGADOR.value),
    ("revisor@evaluador.ve", "Carlos Mendoza (Revisor Técnico)", "Revisor2026!", UserRole.REVISOR.value),
    ("aprobador@evaluador.ve", "Dra. María Bolívar (Comité Aprobador)", "Aprobador2026!", UserRole.APROBADOR.value),
    ("auditor@evaluador.ve", "Lic. José Paredes (Auditoría)", "Auditor2026!", UserRole.AUDITOR.value),
]


async def seed_default_users(db: AsyncSession) -> None:
    for email, full_name, password, role in DEFAULT_USERS:
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none() is None:
            db.add(
                User(
                    email=email,
                    full_name=full_name,
                    hashed_password=hash_password(password),
                    role=role,
                    is_active=True,
                )
            )
    await db.commit()
