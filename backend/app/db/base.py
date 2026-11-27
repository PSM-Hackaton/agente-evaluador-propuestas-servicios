"""PostgreSQL async database engine, session factory, TLS 1.2+ config, and AES-256-GCM column types."""

from __future__ import annotations

import json
import ssl
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import DateTime, Text, TypeDecorator, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.core.crypto import ENVELOPE_PREFIX, get_db_cipher


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
        return get_db_cipher().encrypt_text(str(value))

    def process_result_value(self, value: str | None, dialect: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return get_db_cipher().decrypt_text(value)
        return value


class EncryptedFloat(TypeDecorator):
    """SQLAlchemy numeric float column stored encrypted at rest as AES-256-GCM text."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: float | int | None, dialect: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return value
        return get_db_cipher().encrypt_text(repr(float(value)))

    def process_result_value(self, value: str | None, dialect: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return float(get_db_cipher().decrypt_text(value))
        return float(value)


class EncryptedJSON(TypeDecorator):
    """SQLAlchemy JSON-like column stored encrypted at rest with AES-256-GCM."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return get_db_cipher().encrypt_json(value)

    def process_result_value(self, value: str | None, dialect: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(ENVELOPE_PREFIX):
            return get_db_cipher().decrypt_json(value)
        return json.loads(value)


class UTCDateTime(TypeDecorator):
    """SQLAlchemy DateTime type enforcing UTC tzinfo on PostgreSQL TIMESTAMPTZ columns."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def build_postgres_ssl_arg(ssl_mode: str, ca_file: str = "") -> ssl.SSLContext | str | bool:
    """Build asyncpg `ssl` argument enforcing TLS 1.2+ whenever certificate verification is enabled."""
    mode = (ssl_mode or "prefer").strip().lower()
    if mode == "disable":
        return False
    if mode == "prefer":
        return "prefer"
    if mode in ("require", "verify-ca", "verify-full"):
        ctx = ssl.create_default_context(cafile=ca_file.strip() or None)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        if mode == "verify-ca":
            ctx.check_hostname = False
        return ctx
    raise ValueError(f"Modo SSL de PostgreSQL no soportado: {ssl_mode!r}")


def normalize_database_url(
    database_url: str,
    *,
    default_ssl_mode: str = "prefer",
    ca_file: str = "",
    statement_cache_size: int | None = None,
) -> tuple[str, dict[str, Any]]:
    """Normalize PostgreSQL URLs to `postgresql+asyncpg://` and extract asyncpg `connect_args`."""
    raw = (database_url or "").strip()
    if not raw:
        raise ValueError("DATABASE_URL no puede estar vacío; debe apuntar a PostgreSQL.")

    parsed = urlsplit(raw)
    scheme = parsed.scheme.lower()
    if scheme == "sqlite" or scheme.startswith("sqlite+"):
        raise ValueError("Solo se admite PostgreSQL (postgresql+asyncpg://...); SQLite no está soportado.")
    if scheme not in (
        "postgres",
        "postgresql",
        "postgresql+asyncpg",
        "postgresql+psycopg",
        "postgresql+psycopg2",
    ):
        raise ValueError(f"Esquema de base de datos no soportado ({parsed.scheme!r}); use postgresql+asyncpg://.")

    query_items = parse_qsl(parsed.query, keep_blank_values=True)
    effective_ssl_mode = default_ssl_mode
    effective_ca_file = ca_file
    kept_query: list[tuple[str, str]] = []
    for key, val in query_items:
        low_key = key.lower()
        if low_key == "sslmode":
            effective_ssl_mode = val
        elif low_key == "sslrootcert":
            effective_ca_file = val
        elif low_key == "channel_binding":
            continue
        else:
            kept_query.append((key, val))

    normalized = urlunsplit(
        ("postgresql+asyncpg", parsed.netloc, parsed.path, urlencode(kept_query), parsed.fragment)
    )
    connect_args: dict[str, Any] = {
        "ssl": build_postgres_ssl_arg(effective_ssl_mode, effective_ca_file),
    }

    host = (parsed.hostname or "").lower()
    if statement_cache_size is not None:
        connect_args["statement_cache_size"] = statement_cache_size
    elif parsed.port == 6543 or "pooler.supabase" in host:
        connect_args["statement_cache_size"] = 0

    return normalized, connect_args


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        normalized_url, connect_args = normalize_database_url(
            settings.database_url,
            default_ssl_mode=settings.db_ssl_mode,
            ca_file=settings.db_ssl_ca_file,
            statement_cache_size=settings.db_statement_cache_size,
        )
        _engine = create_async_engine(
            normalized_url,
            echo=False,
            future=True,
            pool_pre_ping=True,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_recycle=settings.db_pool_recycle,
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
    """Reset cached engine/session factory references (useful in tests)."""
    global _engine, _session_factory
    _engine = None
    _session_factory = None


async def dispose_engine() -> None:
    """Dispose the active async connection pool cleanly and reset references."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def check_db_health() -> bool:
    """Verify live PostgreSQL connectivity using a lightweight SELECT 1 probe."""
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


async def init_db() -> None:
    from app.db import models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session
