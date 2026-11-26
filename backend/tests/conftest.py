"""Pytest configuration with isolated encrypted DB and storage per test session."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def test_tmp_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("evaluador_test")


@pytest_asyncio.fixture(scope="session")
async def app_client(test_tmp_dir: Path):
    db_file = test_tmp_dir / "test.db"
    storage_dir = test_tmp_dir / "storage"
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_file}"
    os.environ["STORAGE_DIR"] = str(storage_dir)
    os.environ["LLM_PROVIDER"] = "heuristic"
    os.environ["WEB_SEARCH_ENABLED"] = "false"
    os.environ["MASTER_ENCRYPTION_KEY"] = "test-master-encryption-key-256-bits-strong"
    os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-super-strong-2026"

    from app.core.config import get_settings
    from app.db.base import get_session_factory, init_db, reset_engine
    from app.db.seed import seed_default_users
    from app.main import create_app

    get_settings.cache_clear()
    reset_engine()
    await init_db()
    factory = get_session_factory()
    async with factory() as db:
        await seed_default_users(db)

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        yield client


@pytest.fixture(autouse=True)
def _reset_rate_limit_between_tests():
    from app.api.v1.auth import reset_login_rate_limiter

    reset_login_rate_limiter()
    yield
    reset_login_rate_limiter()
