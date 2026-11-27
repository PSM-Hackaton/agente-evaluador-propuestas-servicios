"""Unified multimodal LLM client (Gemini & OpenAI) with Vision, JSON Mode, and Real Tool Calling."""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Tool declarations exposed directly to Gemini & OpenAI during the autonomous evaluation loop (Issue #9 R3-B1)
AGENT_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "verify_arithmetic",
        "description": "Verifica con aritmética exacta Decimal que cantidad x precio unitario = subtotal y suma(subtotales) = total declarado.",
        "parameters": {
            "type": "object",
            "properties": {
                "declared_total": {"type": "number", "description": "Total general declarado en la propuesta."},
                "line_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit_price": {"type": "number"},
                            "declared_subtotal": {"type": "number"},
                            "category": {"type": "string"},
                        },
                        "required": ["description", "quantity", "unit_price"],
                    },
                },
            },
            "required": ["line_items", "declared_total"],
        },
    },
    {
        "name": "compute_tco",
        "description": "Calcula el Costo Total de Propiedad (TCO) normalizado a USD y Bolívares a tasa BCV incluyendo fletes, instalación, recargos ocultos e IVA.",
        "parameters": {
            "type": "object",
            "properties": {
                "declared_total": {"type": "number"},
                "currency": {"type": "string", "enum": ["USD", "VES"]},
                "bcv_rate": {"type": "number"},
                "shipping_included_in_total": {"type": "boolean"},
                "shipping_cost": {"type": "number"},
                "installation_included_in_total": {"type": "boolean"},
                "installation_cost": {"type": "number"},
                "hidden_surcharge_flat": {"type": "number"},
                "hidden_surcharge_pct": {"type": "number"},
                "iva_applies": {"type": "boolean"},
                "iva_included": {"type": "boolean"},
                "iva_rate": {"type": "number"},
                "payment_surcharge_pct": {"type": "number"},
            },
            "required": ["declared_total", "currency", "bcv_rate"],
        },
    },
    {
        "name": "web_search_market_prices",
        "description": "Busca precios reales de mercado en internet para un equipo, componente o servicio y detecta sobrecostos frente al mercado.",
        "parameters": {
            "type": "object",
            "properties": {
                "item_description": {"type": "string", "description": "Descripción técnica sin datos personales/RIF del proveedor."},
                "proposed_unit_price_usd": {"type": "number"},
            },
            "required": ["item_description", "proposed_unit_price_usd"],
        },
    },
    {
        "name": "check_hardware_compatibility",
        "description": "Audita compatibilidad física/eléctrica (socket, DDR4/DDR5, ranuras DIMM, PSU/UPS), equipos obsoletos y cumplimiento de alcance.",
        "parameters": {
            "type": "object",
            "properties": {
                "student_pc_count": {"type": "integer"},
                "teacher_pc_count": {"type": "integer"},
            },
        },
    },
    {
        "name": "check_supplier_history",
        "description": "Consulta antecedentes y alertas previas del proveedor en el directorio.",
        "parameters": {
            "type": "object",
            "properties": {
                "supplier_name": {"type": "string"},
                "supplier_rif": {"type": "string"},
            },
        },
    },
    {
        "name": "get_bcv_exchange_rate",
        "description": "Obtiene la tasa oficial vigente del Banco Central de Venezuela (BCV) Bs/USD.",
        "parameters": {"type": "object", "properties": {}},
    },
]


@dataclass
class AgentToolCallRecord:
    tool_name: str
    arguments: dict[str, Any]
    result: dict[str, Any]


@dataclass
class AgentLoopResult:
    structured_json: dict[str, Any] | None = None
    tool_calls: list[AgentToolCallRecord] = field(default_factory=list)
    turns_executed: int = 0


ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


class UnifiedLLMClient:
    """Provider-agnostic multimodal, structured-output, and real tool-calling LLM client."""

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

    async def run_agent_tool_loop(
        self,
        system_prompt: str,
        user_prompt: str,
        tool_executor: ToolExecutor,
        images_b64: list[tuple[str, str]] | None = None,
        max_steps: int = 6,
    ) -> AgentLoopResult:
        """Execute a bounded multi-turn tool-calling loop where the LLM decides which tools to invoke."""
        result = AgentLoopResult()
        if not self.is_available:
            return result

        try:
            if self.provider == "gemini":
                return await self._gemini_tool_loop(system_prompt, user_prompt, tool_executor, images_b64, max_steps)
            if self.provider == "openai":
                return await self._openai_tool_loop(system_prompt, user_prompt, tool_executor, images_b64, max_steps)
        except Exception as exc:
            logger.warning("LLM tool loop fallback (%s): %s", self.provider, exc)
        return result

    async def _gemini_tool_loop(
        self,
        system_prompt: str,
        user_prompt: str,
        tool_executor: ToolExecutor,
        images_b64: list[tuple[str, str]] | None,
        max_steps: int,
    ) -> AgentLoopResult:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.settings.gemini_api_key)
        declarations = [
            types.FunctionDeclaration(
                name=t["name"],
                description=t["description"],
                parameters_json_schema=t["parameters"],
            )
            for t in AGENT_TOOL_SCHEMAS
        ]
        tool_cfg = types.Tool(function_declarations=declarations)

        parts: list[Any] = [types.Part.from_text(text=user_prompt)]
        for b64, mime in images_b64 or []:
            parts.append(types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime))

        contents: list[Any] = [types.Content(role="user", parts=parts)]
        model_name = self.settings.gemini_vision_model if images_b64 else self.settings.gemini_model
        out = AgentLoopResult()

        for _ in range(max_steps):
            out.turns_executed += 1
            resp = await client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.1,
                    tools=[tool_cfg],
                ),
            )
            fn_calls = getattr(resp, "function_calls", None) or []
            if resp.candidates and resp.candidates[0].content:
                contents.append(resp.candidates[0].content)

            if not fn_calls:
                if getattr(resp, "text", None):
                    out.structured_json = _parse_json_safely(resp.text)
                break

            response_parts: list[Any] = []
            for call in fn_calls:
                args = dict(call.args or {})
                tool_res = await tool_executor(call.name, args)
                out.tool_calls.append(
                    AgentToolCallRecord(tool_name=call.name, arguments=args, result=tool_res)
                )
                response_parts.append(
                    types.Part.from_function_response(name=call.name, response=tool_res)
                )
            contents.append(types.Content(role="user", parts=response_parts))

        return out

    async def _openai_tool_loop(
        self,
        system_prompt: str,
        user_prompt: str,
        tool_executor: ToolExecutor,
        images_b64: list[tuple[str, str]] | None,
        max_steps: int,
    ) -> AgentLoopResult:
        from openai import AsyncOpenAI

        is_local = self.settings.is_local_llm
        client_kwargs: dict[str, Any] = {
            "api_key": self.settings.openai_api_key or "local",
            "timeout": self.settings.llm_timeout_seconds,
            "max_retries": 0 if is_local else 1,
        }
        if self.settings.openai_base_url:
            client_kwargs["base_url"] = self.settings.openai_base_url

        tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"],
                },
            }
            for t in AGENT_TOOL_SCHEMAS
        ]

        user_content: Any
        if images_b64:
            user_content = [{"type": "text", "text": user_prompt}]
            for b64, mime in images_b64:
                user_content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
        else:
            user_content = user_prompt

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        model_name = self.settings.openai_vision_model if images_b64 else self.settings.openai_model
        effective_steps = min(max_steps, 3) if is_local else max_steps
        out = AgentLoopResult()

        async with AsyncOpenAI(**client_kwargs) as client:
            for _ in range(effective_steps):
                out.turns_executed += 1
                create_kwargs: dict[str, Any] = {
                    "model": model_name,
                    "temperature": 0.1,
                    "messages": messages,
                    "tools": tools,
                }
                if is_local:
                    create_kwargs["max_tokens"] = 650
                resp = await client.chat.completions.create(**create_kwargs)
                msg = resp.choices[0].message
                tool_calls = msg.tool_calls or []

                assistant_msg: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
                if tool_calls:
                    assistant_msg["tool_calls"] = [
                        {
                            "id": tc.id or f"call_{idx}",
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": (
                                    tc.function.arguments
                                    if isinstance(tc.function.arguments, str)
                                    else json.dumps(tc.function.arguments or {}, ensure_ascii=False)
                                ),
                            },
                        }
                        for idx, tc in enumerate(tool_calls)
                    ]
                messages.append(assistant_msg)

                if not tool_calls:
                    if msg.content:
                        out.structured_json = _parse_json_safely(msg.content)
                    break

                for idx, tc in enumerate(tool_calls):
                    raw_args = tc.function.arguments
                    args = (
                        raw_args
                        if isinstance(raw_args, dict)
                        else (_parse_json_safely(raw_args or "{}") or {})
                    )
                    tool_res = await tool_executor(tc.function.name, args)
                    out.tool_calls.append(
                        AgentToolCallRecord(tool_name=tc.function.name, arguments=args, result=tool_res)
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id or f"call_{idx}",
                            "content": json.dumps(tool_res, ensure_ascii=False),
                        }
                    )

        return out

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

        is_local = self.settings.is_local_llm
        client_kwargs: dict[str, Any] = {
            "api_key": self.settings.openai_api_key or "local",
            "timeout": self.settings.llm_timeout_seconds,
            "max_retries": 0 if is_local else 1,
        }
        if self.settings.openai_base_url:
            client_kwargs["base_url"] = self.settings.openai_base_url

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
        if is_local:
            kwargs["max_tokens"] = 900 if images_b64 else 650
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        async with AsyncOpenAI(**client_kwargs) as client:
            try:
                resp = await client.chat.completions.create(**kwargs)
            except Exception:
                if not json_mode:
                    raise
                kwargs.pop("response_format", None)
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
