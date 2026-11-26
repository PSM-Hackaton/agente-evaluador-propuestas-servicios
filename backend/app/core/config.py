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

    # Database & Encrypted Storage
    database_url: str = "sqlite+aiosqlite:///./data/evaluador.db"
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

    # LLM Configuration
    llm_provider: Literal["auto", "gemini", "openai", "heuristic"] = "auto"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_vision_model: str = "gemini-2.5-flash"

    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_vision_model: str = "gpt-4o-mini"

    # Web Search & Finance
    web_search_enabled: bool = True
    tavily_api_key: str = ""
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

    def resolved_llm_provider(self) -> Literal["gemini", "openai", "heuristic"]:
        if self.llm_provider == "gemini" and self.gemini_api_key:
            return "gemini"
        if self.llm_provider == "openai" and self.openai_api_key:
            return "openai"
        if self.llm_provider == "heuristic":
            return "heuristic"
        # Auto detection
        if self.gemini_api_key:
            return "gemini"
        if self.openai_api_key:
            return "openai"
        return "heuristic"


@lru_cache
def get_settings() -> Settings:
    return Settings()
