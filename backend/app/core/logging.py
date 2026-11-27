"""Structured application logging."""

from __future__ import annotations

import logging
import sys


def setup_logging(debug: bool = False) -> None:
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        stream=sys.stdout,
        force=True,
    )
    # Third-party clients (HTTP/2 frames, search engines, PDF/LLM SDKs) flood the agent trace in DEBUG mode
    # and may echo request URLs; keep them at WARNING so only the application's own trace is verbose.
    for noisy in (
        "httpx",
        "httpcore",
        "h2",
        "hpack",
        "primp",
        "ddgs",
        "cookie_store",
        "rquest",
        "google_genai",
        "openai",
        "PIL",
        "asyncpg",
        "sqlalchemy.engine",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)
