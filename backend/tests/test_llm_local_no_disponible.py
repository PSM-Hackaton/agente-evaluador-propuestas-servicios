"""Si la IA local (Ollama) no responde, la ingesta sigue con OCR en lugar de fallar."""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.llm.client import UnifiedLLMClient


@pytest.mark.asyncio
async def test_extract_from_image_sin_servidor_local_devuelve_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:9/v1")  # puerto sin servicio
    monkeypatch.setenv("OPENAI_API_KEY", "local")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "3")
    get_settings.cache_clear()
    try:
        cliente = UnifiedLLMClient()
        assert cliente.is_available
        assert await cliente.extract_from_image("iVBORw0KGgo=", "image/png", "transcribe") is None
        assert await cliente.generate_text("s", "u") is None
    finally:
        get_settings.cache_clear()
