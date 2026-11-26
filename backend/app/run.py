"""Uvicorn launcher enforcing TLS 1.2 / TLS 1.3 when TLS_ENABLED=true (Section 2.F)."""

from __future__ import annotations

import ssl
from pathlib import Path

import uvicorn

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    kwargs: dict = {
        "app": "app.main:app",
        "host": settings.host,
        "port": settings.port,
        "reload": settings.debug and settings.app_env == "development",
    }

    if settings.tls_enabled:
        cert = Path(settings.tls_cert_file)
        key = Path(settings.tls_key_file)
        if not cert.exists() or not key.exists():
            raise FileNotFoundError(
                f"TLS habilitado pero faltan certificados: {cert} / {key}. "
                "Ejecuta ./scripts/generate_tls_certs.sh para generar certificados locales."
            )
        kwargs["ssl_certfile"] = str(cert)
        kwargs["ssl_keyfile"] = str(key)
        kwargs["ssl_version"] = ssl.PROTOCOL_TLS_SERVER
        # TLS 1.2+ cipher suite hardening
        kwargs["ssl_ciphers"] = "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:!aNULL:!MD5:!DSS"

    uvicorn.run(**kwargs)


if __name__ == "__main__":
    main()
