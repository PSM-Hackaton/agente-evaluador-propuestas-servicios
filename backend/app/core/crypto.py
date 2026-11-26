"""AES-256-GCM encryption at rest with HKDF subkey separation, key rotation, and HMAC blind indexes."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings

ENVELOPE_PREFIX = "enc:v1:"
NONCE_SIZE = 12  # 96-bit NIST recommended nonce for AES-GCM
_HKDF_SALT = b"agente-evaluador-propuestas-hkdf-salt-v1"


class CryptoError(RuntimeError):
    """Raised when encryption or decryption fails."""


def derive_purpose_subkey(master_key: bytes, purpose: str) -> bytes:
    """Derive a cryptographically isolated 256-bit key per purpose via HKDF-SHA256."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=f"aev:{purpose}".encode("ascii"),
    )
    return hkdf.derive(master_key)


class AES256GCMCipher:
    """Authenticated encryption at rest using AES-256-GCM with optional rotation fallback keys."""

    def __init__(self, key: bytes | None = None, fallback_keys: list[bytes] | None = None) -> None:
        resolved_key = key if key is not None else get_settings().aes_key_bytes
        if len(resolved_key) != 32:
            raise CryptoError("AES-256-GCM requires a 32-byte (256-bit) key.")
        self._aesgcm = AESGCM(resolved_key)
        self._fallbacks = [AESGCM(k) for k in (fallback_keys or []) if len(k) == 32]

    def encrypt_bytes(self, plaintext: bytes, associated_data: bytes | None = None) -> bytes:
        nonce = os.urandom(NONCE_SIZE)
        ciphertext = self._aesgcm.encrypt(nonce, plaintext, associated_data)
        return b"AEV1" + nonce + ciphertext

    def decrypt_bytes(self, blob: bytes, associated_data: bytes | None = None) -> bytes:
        if len(blob) < 4 + NONCE_SIZE + 16 or blob[:4] != b"AEV1":
            raise CryptoError("Invalid encrypted payload header or truncated ciphertext.")
        nonce = blob[4 : 4 + NONCE_SIZE]
        ciphertext = blob[4 + NONCE_SIZE :]
        for cipher in (self._aesgcm, *self._fallbacks):
            try:
                return cipher.decrypt(nonce, ciphertext, associated_data)
            except Exception:
                continue
        raise CryptoError("Failed to decrypt payload (authentication tag mismatch).")

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


def _purpose_cipher(purpose: str) -> AES256GCMCipher:
    settings = get_settings()
    primary = derive_purpose_subkey(settings.aes_key_bytes, purpose)
    fallbacks: list[bytes] = []
    if settings.previous_aes_key_bytes:
        fallbacks.append(derive_purpose_subkey(settings.previous_aes_key_bytes, purpose))
    return AES256GCMCipher(key=primary, fallback_keys=fallbacks)


def get_cipher() -> AES256GCMCipher:
    """Cipher for encrypted files on disk (purpose-separated HKDF subkey)."""
    return _purpose_cipher("storage")


def get_db_cipher() -> AES256GCMCipher:
    """Cipher for encrypted database columns (purpose-separated HKDF subkey)."""
    return _purpose_cipher("db_fields")


def blind_index(value: str | None) -> str | None:
    """Compute a deterministic keyed HMAC-SHA256 blind index for encrypted DB lookups."""
    if value is None:
        return None
    normalized = " ".join(str(value).strip().lower().split())
    if not normalized:
        return None
    key = derive_purpose_subkey(get_settings().aes_key_bytes, "blind_index")
    return hmac.new(key, normalized.encode("utf-8"), hashlib.sha256).hexdigest()
