"""Uvicorn launcher enforcing TLS 1.2 / TLS 1.3 when TLS_ENABLED=true (Section 2.F)."""

from __future__ import annotations

import ssl
from pathlib import Path

import uvicorn

from app.core.config import get_settings


def build_tls_ssl_context(cert_file: Path, key_file: Path) -> ssl.SSLContext:
    """Create a hardened TLS 1.2 / TLS 1.3 SSLContext explicitly rejecting TLS 1.0/1.1."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.maximum_version = ssl.TLSVersion.MAXIMUM_SUPPORTED
    ctx.set_ciphers("ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:!aNULL:!MD5:!DSS")
    ctx.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))
    return ctx


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
        kwargs["ssl_ciphers"] = "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:!aNULL:!MD5:!DSS"
        kwargs["ssl_context_factory"] = lambda _cfg, _default: build_tls_ssl_context(cert, key)
        config = uvicorn.Config(**kwargs)
        uvicorn.Server(config).run()
        return

    uvicorn.run(**kwargs)


if __name__ == "__main__":
    main()
