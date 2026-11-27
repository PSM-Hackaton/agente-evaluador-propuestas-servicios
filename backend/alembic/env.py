"""Alembic async environment for PostgreSQL (`asyncpg`) with TLS 1.2+ support."""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.core.config import get_settings
from app.db import models  # noqa: F401
from app.db.base import Base, normalize_database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _resolve_db_url() -> str:
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        return env_url
    get_settings.cache_clear()
    settings = get_settings()
    return settings.database_url or config.get_main_option("sqlalchemy.url")


def run_migrations_offline() -> None:
    url, _ = normalize_database_url(_resolve_db_url())
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    db_url = _resolve_db_url()
    normalized_url, connect_args = normalize_database_url(
        db_url,
        default_ssl_mode=settings.db_ssl_mode,
        ca_file=settings.db_ssl_ca_file,
        statement_cache_size=settings.db_statement_cache_size,
    )
    connectable = create_async_engine(
        normalized_url,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
