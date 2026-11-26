"""Tests for AES-256-GCM encryption at rest and encrypted file storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.crypto import AES256GCMCipher, CryptoError
from app.services.storage.encrypted_storage import EncryptedFileStorage


def test_aes256_gcm_text_and_json_roundtrip() -> None:
    cipher = AES256GCMCipher(b"0" * 32)
    secret = "Propuesta confidencial $20,690.00 RIF J-40998877-2"
    token = cipher.encrypt_text(secret)
    assert secret not in token
    assert token.startswith("enc:v1:")
    assert cipher.decrypt_text(token) == secret

    payload = {"total": 20690.0, "alerts": ["inyeccion_prompt"]}
    jtok = cipher.encrypt_json(payload)
    assert "20690" not in jtok
    assert cipher.decrypt_json(jtok) == payload


def test_aes256_gcm_tamper_detection() -> None:
    cipher = AES256GCMCipher(b"1" * 32)
    blob = bytearray(cipher.encrypt_bytes(b"datos sensibles"))
    blob[-1] ^= 0xFF
    with pytest.raises(CryptoError):
        cipher.decrypt_bytes(bytes(blob))


def test_encrypted_file_storage_no_plaintext_on_disk(tmp_path: Path) -> None:
    storage = EncryptedFileStorage(base_dir=tmp_path)
    raw = b"CONFIDENTIAL_PROPOSAL_CONTENT_12345"
    key, sha = storage.save_encrypted(raw, category="proposals", extension=".pdf")
    assert len(sha) == 64

    disk_bytes = (tmp_path / key).read_bytes()
    assert raw not in disk_bytes
    assert storage.read_decrypted(key) == raw

    with storage.temporary_decrypted_file(key, suffix=".pdf") as tmp_file:
        assert tmp_file.read_bytes() == raw
        tmp_path_recorded = tmp_file
    assert not tmp_path_recorded.exists()

    assert storage.delete(key) is True
    assert not (tmp_path / key).exists()
