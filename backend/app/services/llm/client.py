"""Unified multimodal LLM client (Google Gemini & OpenAI-compatible) with Vision & Tool Calling."""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class UnifiedLLMClient:
    """Provider-agnostic multimodal & structured-output LLM client."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.provider = self.settings.resolved_llm_provider()

    @property
    def is_available(self) -> bool:
        return self.provider in ("gemini", "openai")

    async def extract_from_image(
        self,
        image_b64: str,
        mime_type: str,
        prompt: str,
    ) -> str | None:
        """Use Vision LLM API to transcribe handwritten budgets, noisy scans, or chat screenshots."""
        if not self.is_available:
            return None

        if self.provider == "gemini":
            return await self._gemini_vision(image_b64, mime_type, prompt)
        if self.provider == "openai":
            return await self._openai_vision(image_b64, mime_type, prompt)
        return None

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        images_b64: list[tuple[str, str]] | None = None,
    ) -> dict[str, Any] | None:
        """Generate a strict JSON object from text + optional images."""
        if not self.is_available:
            return None

        try:
            raw: str | None = None
            if self.provider == "gemini":
                raw = await self._gemini_generate(system_prompt, user_prompt, images_b64, json_mode=True)
            elif self.provider == "openai":
                raw = await self._openai_generate(system_prompt, user_prompt, images_b64, json_mode=True)

            if not raw:
                return None
            return _parse_json_safely(raw)
        except Exception as exc:
            logger.warning("LLM generate_json failed (%s): %s", self.provider, exc)
            return None

    async def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> str | None:
        """Generate free-form text (e.g. grounded chat response or executive summary)."""
        if not self.is_available:
            return None
        try:
            if self.provider == "gemini":
                return await self._gemini_generate(system_prompt, user_prompt, None, json_mode=False)
            if self.provider == "openai":
                return await self._openai_generate(system_prompt, user_prompt, None, json_mode=False)
        except Exception as exc:
            logger.warning("LLM generate_text failed (%s): %s", self.provider, exc)
        return None

    async def _gemini_vision(self, image_b64: str, mime_type: str, prompt: str) -> str | None:
        return await self._gemini_generate(
            "Eres un especialista en extracción documental multimodal (OCR + visión) de presupuestos y cotizaciones.",
            prompt,
            images_b64=[(image_b64, mime_type)],
            json_mode=False,
        )

    async def _gemini_generate(
        self,
        system_prompt: str,
        user_prompt: str,
        images_b64: list[tuple[str, str]] | None,
        json_mode: bool,
    ) -> str | None:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.settings.gemini_api_key)
        parts: list[Any] = [types.Part.from_text(text=user_prompt)]
        if images_b64:
            for b64, mime in images_b64:
                parts.append(types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime))

        config_kwargs: dict[str, Any] = {
            "system_instruction": system_prompt,
            "temperature": 0.1,
        }
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        model_name = self.settings.gemini_vision_model if images_b64 else self.settings.gemini_model
        response = await client.aio.models.generate_content(
            model=model_name,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(**config_kwargs),
        )
        return response.text

    async def _openai_vision(self, image_b64: str, mime_type: str, prompt: str) -> str | None:
        return await self._openai_generate(
            "Eres un especialista en extracción documental multimodal (OCR + visión) de presupuestos y cotizaciones.",
            prompt,
            images_b64=[(image_b64, mime_type)],
            json_mode=False,
        )

    async def _openai_generate(
        self,
        system_prompt: str,
        user_prompt: str,
        images_b64: list[tuple[str, str]] | None,
        json_mode: bool,
    ) -> str | None:
        from openai import AsyncOpenAI

        client_kwargs: dict[str, Any] = {"api_key": self.settings.openai_api_key}
        if self.settings.openai_base_url:
            client_kwargs["base_url"] = self.settings.openai_base_url
        client = AsyncOpenAI(**client_kwargs)

        user_content: Any
        if images_b64:
            user_content = [{"type": "text", "text": user_prompt}]
            for b64, mime in images_b64:
                user_content.append(
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
                )
        else:
            user_content = user_prompt

        kwargs: dict[str, Any] = {
            "model": self.settings.openai_vision_model if images_b64 else self.settings.openai_model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        resp = await client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content


def _parse_json_safely(raw: str) -> dict[str, Any] | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {"data": parsed}
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(cleaned[start : end + 1])
                return parsed if isinstance(parsed, dict) else {"data": parsed}
            except json.JSONDecodeError:
                return None
        return None
