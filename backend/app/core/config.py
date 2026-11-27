"""Core configuration using Pydantic Settings."""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Agente Evaluador de Propuestas de Servicios"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = (
        "https://localhost:5173,http://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173,"
        "http://localhost:5174,http://localhost:4173,"
        "https://localhost:3000,http://localhost:3000,http://127.0.0.1:3000"
    )

    # Database (PostgreSQL) & Encrypted Storage
    database_url: str = "postgresql+asyncpg://postgres@127.0.0.1:5432/evaluador_propuestas"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle: int = 1800
    db_ssl_mode: Literal["disable", "prefer", "require", "verify-ca", "verify-full"] = "prefer"
    db_ssl_ca_file: str = ""
    db_statement_cache_size: int | None = None
    db_auto_create_tables: bool = False
    storage_dir: str = "./data/storage"

    # Security: AES-256-GCM & JWT & TLS 1.2/1.3
    master_encryption_key: str = Field(
        default="dev-insecure-default-key-replace-in-production-32b",
        description="Base64 32-byte key or passphrase derived via SHA-256 to 256-bit AES key.",
    )
    previous_encryption_key: str = Field(
        default="",
        description="Optional previous master key for zero-downtime key rotation during decryption.",
    )
    jwt_secret_key: str = Field(
        default="dev-insecure-jwt-secret-replace-in-production",
        description="Secret key for signing JWT access/refresh tokens.",
    )
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    login_rate_limit_max_attempts: int = 5
    login_rate_limit_window_seconds: int = 300

    tls_enabled: bool = False
    tls_cert_file: str = "./certs/server.crt"
    tls_key_file: str = "./certs/server.key"

    # LLM Configuration (local OpenAI-compatible API recommended: Ollama / llama.cpp)
    llm_provider: Literal["auto", "openai", "heuristic"] = "auto"
    llm_timeout_seconds: float = 120.0
    llm_disable_thinking: bool = True
    llm_local_max_tokens: int = Field(default=650, ge=64)
    llm_local_vision_max_tokens: int = Field(default=900, ge=64)

    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "qwen3.5:4b"
    openai_vision_model: str = "qwen3.5:4b"

    # Web Search & Finance
    web_search_enabled: bool = True
    bcv_fallback_rate: float = 52.50
    default_iva_rate: float = 0.16
    abusive_surcharge_pct_threshold: float = 50.0

    # Hackathon / Batch metadata
    hackathon_repo_path: str = ""
    timezone_offset: str = "-04:00"
    max_upload_size_mb: int = 25

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def storage_path(self) -> Path:
        path = Path(self.storage_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _decode_raw_key(raw: str) -> bytes:
        cleaned = raw.strip()
        try:
            decoded = base64.urlsafe_b64decode(cleaned.encode("ascii"))
            if len(decoded) == 32:
                return decoded
        except Exception:
            pass
        return hashlib.sha256(cleaned.encode("utf-8")).digest()

    @property
    def aes_key_bytes(self) -> bytes:
        """Return a deterministic 32-byte (256-bit) master key."""
        return self._decode_raw_key(self.master_encryption_key)

    @property
    def previous_aes_key_bytes(self) -> bytes | None:
        raw = self.previous_encryption_key.strip()
        return self._decode_raw_key(raw) if raw else None

    def insecure_secret_settings(self) -> list[str]:
        """Names of secrets still using development defaults or `.env.example` placeholders."""
        weak: list[str] = []
        for name, value in (
            ("MASTER_ENCRYPTION_KEY", self.master_encryption_key),
            ("JWT_SECRET_KEY", self.jwt_secret_key),
        ):
            v = (value or "").strip()
            if not v or "change_me" in v.lower() or "dev-insecure" in v.lower() or len(v) < 32:
                weak.append(name)
        return weak

    def resolved_llm_provider(self) -> Literal["openai", "heuristic"]:
        if self.llm_provider == "openai" and (self.openai_api_key or self.openai_base_url):
            return "openai"
        if self.llm_provider == "heuristic":
            return "heuristic"
        # Auto detection
        if self.openai_api_key or self.openai_base_url:
            return "openai"
        return "heuristic"

    @property
    def is_local_llm(self) -> bool:
        return self.resolved_llm_provider() == "openai" and bool(self.openai_base_url.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
