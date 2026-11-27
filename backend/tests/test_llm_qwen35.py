"""Unit tests for Issue #65: qwen3.5:4b Ollama support (thinking toggle, <think> sanitization, local max_tokens)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import Settings
from app.services.llm.client import UnifiedLLMClient, _parse_json_safely, _strip_thinking_blocks


def _make_fake_response(content: str | None, tool_calls: list[Any] | None = None) -> Any:
    msg = SimpleNamespace(content=content, tool_calls=tool_calls or [])
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


class _BadRequest400(Exception):
    status_code = 400


class _ConnectionDown(Exception):
    status_code = None


def test_settings_qwen35_defaults_and_overrides() -> None:
    s = Settings(_env_file=None)
    assert s.llm_disable_thinking is True
    assert s.llm_local_max_tokens == 650
    assert s.llm_local_vision_max_tokens == 900
    assert s.openai_model == "qwen3.5:4b"
    assert s.openai_vision_model == "qwen3.5:4b"

    custom = Settings(
        _env_file=None,
        llm_disable_thinking=False,
        llm_local_max_tokens=1200,
        llm_local_vision_max_tokens=1800,
    )
    assert custom.llm_disable_thinking is False
    assert custom.llm_local_max_tokens == 1200
    assert custom.llm_local_vision_max_tokens == 1800


def test_strip_thinking_blocks_variants() -> None:
    assert _strip_thinking_blocks("<think>razonando paso a paso</think>\nRespuesta final") == "Respuesta final"
    assert _strip_thinking_blocks("<THINK>A</THINK>Hola<think>B</think> mundo") == "Hola mundo"
    assert _strip_thinking_blocks("<think>razonamiento truncado por max_tokens") == ""
    assert _strip_thinking_blocks("Texto normal sin etiquetas") == "Texto normal sin etiquetas"
    assert _strip_thinking_blocks("") == ""


def test_parse_json_safely_strips_thinking_blocks() -> None:
    raw = '<think>Calculando totales...\n{"falso": 1}</think>\n```json\n{"total": 1250.5, "valido": true}\n```'
    assert _parse_json_safely(raw) == {"total": 1250.5, "valido": True}
    assert _parse_json_safely("<think>solo pensamiento sin cierre") is None


@pytest.mark.asyncio
async def test_local_generate_passes_think_false_and_configurable_max_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_calls: list[dict[str, Any]] = []

    class _FakeCompletions:
        async def create(self, **kwargs: Any) -> Any:
            captured_calls.append(dict(kwargs))
            return _make_fake_response("<think>oculto</think>\nRespuesta limpia")

    class _FakeAsyncOpenAI:
        def __init__(self, **_kwargs: Any) -> None:
            self.chat = SimpleNamespace(completions=_FakeCompletions())

        async def __aenter__(self) -> _FakeAsyncOpenAI:
            return self

        async def __aexit__(self, *_args: Any) -> None:
            return None

    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", _FakeAsyncOpenAI)

    settings = Settings(
        _env_file=None,
        llm_provider="openai",
        openai_base_url="http://127.0.0.1:11434/v1",
        openai_api_key="local",
        openai_model="qwen3.5:4b",
        openai_vision_model="qwen3.5:4b",
        llm_disable_thinking=True,
        llm_local_max_tokens=777,
        llm_local_vision_max_tokens=1111,
    )
    client = UnifiedLLMClient.__new__(UnifiedLLMClient)
    client.settings = settings
    client.provider = "openai"

    text = await client.generate_text("sys", "usr")
    assert text == "Respuesta limpia"
    assert captured_calls[0]["max_tokens"] == 777
    assert captured_calls[0]["reasoning_effort"] == "none"
    assert captured_calls[0]["extra_body"] == {"think": False}
    assert captured_calls[0]["model"] == "qwen3.5:4b"

    vision = await client.extract_from_image("AAAA", "image/png", "leer")
    assert vision == "Respuesta limpia"
    assert captured_calls[1]["max_tokens"] == 1111
    assert captured_calls[1]["reasoning_effort"] == "none"
    assert captured_calls[1]["extra_body"] == {"think": False}
    assert captured_calls[1]["model"] == "qwen3.5:4b"


@pytest.mark.asyncio
async def test_create_completion_fallback_when_extra_body_or_response_format_rejected() -> None:
    calls: list[dict[str, Any]] = []

    class _StrictCompletions:
        async def create(self, **kwargs: Any) -> Any:
            calls.append(dict(kwargs))
            if "extra_body" in kwargs:
                raise _BadRequest400("unknown field extra_body")
            if "response_format" in kwargs:
                raise _BadRequest400("response_format not supported")
            return _make_fake_response('{"ok": true}')

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=_StrictCompletions()))
    llm = UnifiedLLMClient.__new__(UnifiedLLMClient)
    resp = await llm._create_completion(
        fake_client,
        {"model": "qwen3.5:4b", "extra_body": {"think": False}, "response_format": {"type": "json_object"}},
    )
    assert resp.choices[0].message.content == '{"ok": true}'
    assert len(calls) == 3
    assert "extra_body" not in calls[1] and "response_format" in calls[1]
    assert "extra_body" not in calls[2] and "response_format" not in calls[2]


@pytest.mark.asyncio
async def test_create_completion_does_not_retry_on_connection_error() -> None:
    calls = 0

    class _OfflineCompletions:
        async def create(self, **_kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            raise _ConnectionDown("connection refused")

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=_OfflineCompletions()))
    llm = UnifiedLLMClient.__new__(UnifiedLLMClient)
    with pytest.raises(_ConnectionDown):
        await llm._create_completion(fake_client, {"model": "qwen3.5:4b", "extra_body": {"think": False}})
    assert calls == 1


@pytest.mark.asyncio
async def test_tool_loop_passes_think_false_and_strips_think_before_json_parse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[dict[str, Any]] = []

    class _FakeCompletions:
        async def create(self, **kwargs: Any) -> Any:
            captured.append(dict(kwargs))
            return _make_fake_response('<think>verificado</think>{"decision": "valida"}')

    class _FakeAsyncOpenAI:
        def __init__(self, **_kwargs: Any) -> None:
            self.chat = SimpleNamespace(completions=_FakeCompletions())

        async def __aenter__(self) -> _FakeAsyncOpenAI:
            return self

        async def __aexit__(self, *_args: Any) -> None:
            return None

    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", _FakeAsyncOpenAI)

    settings = Settings(
        _env_file=None,
        llm_provider="openai",
        openai_base_url="http://127.0.0.1:11434/v1",
        openai_api_key="local",
        llm_disable_thinking=True,
        llm_local_max_tokens=800,
    )
    client = UnifiedLLMClient.__new__(UnifiedLLMClient)
    client.settings = settings
    client.provider = "openai"

    async def _noop_tool(_name: str, _args: dict[str, Any]) -> dict[str, Any]:
        return {}

    res = await client.run_agent_tool_loop("sys", "usr", _noop_tool)
    assert res.structured_json == {"decision": "valida"}
    assert captured[0]["max_tokens"] == 800
    assert captured[0]["extra_body"] == {"think": False}
