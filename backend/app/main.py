"""FastAPI application entry point with Security Headers, CORS, and DB initialization."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.base import get_session_factory, init_db
from app.db.seed import seed_default_users


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    setup_logging(debug=settings.debug)
    weak = settings.insecure_secret_settings()
    if weak:
        if settings.app_env in ("production", "staging"):
            raise RuntimeError(
                "Configuración insegura: " + ", ".join(weak) + " usan valores por defecto o de ejemplo. "
                "Genere claves fuertes (32 bytes) en .env antes de iniciar en " + settings.app_env + "."
            )
        logging.getLogger(__name__).warning(
            "Secretos de desarrollo en uso (%s): no usar este entorno con documentos reales.", ", ".join(weak)
        )
    await init_db()
    factory = get_session_factory()
    async with factory() as db:
        await seed_default_users(db)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description=(
            "API Backend del Agente de IA Autónomo Evaluador de Propuestas de Servicios — "
            "Hackatón Venezuela INNOVA 2026. Incluye ingesta multimodal, auditoría TCO, "
            "protección contra prompt injection, normalización BCV/IVA, RBAC, cifrado AES-256-GCM "
            "en reposo y TLS 1.2/1.3 en tránsito."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next) -> Response:
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if settings.tls_enabled or request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response

    @app.get("/health", tags=["Sistema"])
    async def health() -> dict:
        return {
            "status": "ok",
            "service": settings.app_name,
            "version": "1.0.0",
            "llm_provider": settings.resolved_llm_provider(),
            "encryption_at_rest": "AES-256-GCM",
            "tls_enabled": settings.tls_enabled,
        }

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
