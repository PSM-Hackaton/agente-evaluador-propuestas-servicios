"""AES-256-GCM encryption at rest for files, temporary artifacts, and database columns."""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

ENVELOPE_PREFIX = "enc:v1:"
NONCE_SIZE = 12  # 96-bit NIST recommended nonce for AES-GCM


class CryptoError(RuntimeError):
    """Raised when encryption or decryption fails."""


class AES256GCMCipher:
    """Authenticated encryption at rest using AES-256-GCM."""

    def __init__(self, key: bytes | None = None) -> None:
        resolved_key = key if key is not None else get_settings().aes_key_bytes
        if len(resolved_key) != 32:
            raise CryptoError("AES-256-GCM requires a 32-byte (256-bit) key.")
        self._aesgcm = AESGCM(resolved_key)

    def encrypt_bytes(self, plaintext: bytes, associated_data: bytes | None = None) -> bytes:
        nonce = os.urandom(NONCE_SIZE)
        ciphertext = self._aesgcm.encrypt(nonce, plaintext, associated_data)
        return b"AEV1" + nonce + ciphertext

    def decrypt_bytes(self, blob: bytes, associated_data: bytes | None = None) -> bytes:
        if len(blob) < 4 + NONCE_SIZE + 16 or blob[:4] != b"AEV1":
            raise CryptoError("Invalid encrypted payload header or truncated ciphertext.")
        nonce = blob[4 : 4 + NONCE_SIZE]
        ciphertext = blob[4 + NONCE_SIZE :]
        try:
            return self._aesgcm.decrypt(nonce, ciphertext, associated_data)
        except Exception as exc:
            raise CryptoError("Failed to decrypt payload (authentication tag mismatch).") from exc

    def encrypt_text(self, plaintext: str, associated_data: str | None = None) -> str:
        aad = associated_data.encode("utf-8") if associated_data else None
        raw = self.encrypt_bytes(plaintext.encode("utf-8"), aad)
        encoded = base64.urlsafe_b64encode(raw).decode("ascii")
        return f"{ENVELOPE_PREFIX}{encoded}"

    def decrypt_text(self, token: str, associated_data: str | None = None) -> str:
        if not token.startswith(ENVELOPE_PREFIX):
            raise CryptoError("Value does not carry a valid AES-256-GCM envelope prefix.")
        aad = associated_data.encode("utf-8") if associated_data else None
        raw = base64.urlsafe_b64decode(token[len(ENVELOPE_PREFIX) :].encode("ascii"))
        return self.decrypt_bytes(raw, aad).decode("utf-8")

    def encrypt_json(self, value: Any, associated_data: str | None = None) -> str:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return self.encrypt_text(serialized, associated_data=associated_data)

    def decrypt_json(self, token: str, associated_data: str | None = None) -> Any:
        serialized = self.decrypt_text(token, associated_data=associated_data)
        return json.loads(serialized)


def get_cipher() -> AES256GCMCipher:
    return AES256GCMCipher()
