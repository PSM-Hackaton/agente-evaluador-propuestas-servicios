"""Pytest configuration with isolated encrypted PostgreSQL DB and storage per test session."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
# Guarantee offline deterministic test isolation even when local backend/.env enables Ollama or live web search
os.environ["LLM_PROVIDER"] = "heuristic"
os.environ["WEB_SEARCH_ENABLED"] = "false"


@pytest.fixture(scope="session")
def test_tmp_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("evaluador_test")


async def _reset_postgres_schema(sqlalchemy_url: str) -> None:
    from app.db.base import normalize_database_url

    normalized_url, connect_args = normalize_database_url(sqlalchemy_url, default_ssl_mode="disable")
    raw_dsn = normalized_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = await asyncpg.connect(raw_dsn, ssl=connect_args.get("ssl", False))
    try:
        await conn.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session")
async def app_client(test_tmp_dir: Path):
    test_db_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://postgres@127.0.0.1:5432/evaluador_test",
    )
    storage_dir = test_tmp_dir / "storage"
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = test_db_url
    os.environ["DB_SSL_MODE"] = os.environ.get("TEST_DB_SSL_MODE", "disable")
    os.environ["DB_AUTO_CREATE_TABLES"] = "false"
    os.environ["STORAGE_DIR"] = str(storage_dir)
    os.environ["LLM_PROVIDER"] = "heuristic"
    os.environ["WEB_SEARCH_ENABLED"] = "false"
    os.environ["MASTER_ENCRYPTION_KEY"] = "test-master-encryption-key-256-bits-strong"
    os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-super-strong-2026"

    from app.core.config import get_settings
    from app.db.base import dispose_engine, get_session_factory, reset_engine
    from app.db.seed import seed_default_users
    from app.main import create_app

    get_settings.cache_clear()
    await dispose_engine()
    await _reset_postgres_schema(test_db_url)

    alembic_bin = str(Path(sys.executable).parent / "alembic")
    mig = subprocess.run(
        [alembic_bin, "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env={**os.environ, "DATABASE_URL": test_db_url},
        capture_output=True,
        text=True,
    )
    assert mig.returncode == 0, f"Alembic migration failed for test DB:\n{mig.stdout}\n{mig.stderr}"

    reset_engine()
    factory = get_session_factory()
    async with factory() as db:
        await seed_default_users(db)

    app = create_app()
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="https://testserver") as client:
            yield client
    finally:
        await dispose_engine()


@pytest.fixture(autouse=True)
def _reset_rate_limit_between_tests():
    from app.api.v1.auth import reset_login_rate_limiter

    reset_login_rate_limiter()
    yield
    reset_login_rate_limiter()
