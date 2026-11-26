"""Database engine, async session factory, and AES-256-GCM encrypted column types."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from sqlalchemy import Text, TypeDecorator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.core.crypto import ENVELOPE_PREFIX, get_cipher


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


class EncryptedText(TypeDecorator):
    """SQLAlchemy Text column transparently encrypted at rest with AES-256-GCM."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return value
        return get_cipher().encrypt_text(str(value))

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return get_cipher().decrypt_text(value)
        return value


class EncryptedJSON(TypeDecorator):
    """SQLAlchemy JSON-like column stored encrypted at rest with AES-256-GCM."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_cipher().encrypt_json(value)

    def process_result_value(self, value: str | None, dialect: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return get_cipher().decrypt_json(value)
        return json.loads(value)


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _ensure_sqlite_dir(database_url: str) -> None:
    if database_url.startswith("sqlite"):
        raw_path = database_url.split(":///")[-1]
        if raw_path and raw_path != ":memory:":
            Path(raw_path).parent.mkdir(parents=True, exist_ok=True)


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        _ensure_sqlite_dir(settings.database_url)
        connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            future=True,
            connect_args=connect_args,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


def reset_engine() -> None:
    """Reset cached engine/session factory (useful in tests)."""
    global _engine, _session_factory
    _engine = None
    _session_factory = None


async def init_db() -> None:
    from app.db import models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session
