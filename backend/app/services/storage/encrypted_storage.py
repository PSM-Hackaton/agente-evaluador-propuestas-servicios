"""AES-256-GCM encrypted file storage on disk (Section 2.F - Encryption at Rest)."""

from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import get_settings
from app.core.crypto import get_cipher


class EncryptedFileStorage:
    """Stores all uploaded originals, OCR artifacts, and reports encrypted with AES-256-GCM."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir if base_dir is not None else get_settings().storage_path
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._cipher = get_cipher()

    def _safe_path(self, storage_key: str) -> Path:
        resolved = (self._base_dir / storage_key).resolve()
        base_resolved = self._base_dir.resolve()
        if not str(resolved).startswith(str(base_resolved)):
            raise ValueError("Invalid storage key path traversal attempt.")
        return resolved

    def save_encrypted(self, content: bytes, category: str, extension: str = ".bin") -> tuple[str, str]:
        """Encrypt content with AES-256-GCM and store on disk. Returns (storage_key, sha256_hex)."""
        sha256_hex = hashlib.sha256(content).hexdigest()
        clean_cat = "".join(ch for ch in category if ch.isalnum() or ch in ("-", "_")) or "misc"
        clean_ext = "".join(ch for ch in extension if ch.isalnum() or ch == ".") or ".bin"
        key = f"{clean_cat}/{uuid.uuid4().hex}{clean_ext}.enc"
        target = self._safe_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)

        encrypted_blob = self._cipher.encrypt_bytes(content, associated_data=key.encode("utf-8"))
        target.write_bytes(encrypted_blob)
        return key, sha256_hex

    def read_decrypted(self, storage_key: str) -> bytes:
        """Read and authenticate-decrypt a stored artifact."""
        target = self._safe_path(storage_key)
        if not target.exists():
            raise FileNotFoundError(f"Encrypted artifact not found: {storage_key}")
        blob = target.read_bytes()
        return self._cipher.decrypt_bytes(blob, associated_data=storage_key.encode("utf-8"))

    def delete(self, storage_key: str) -> bool:
        target = self._safe_path(storage_key)
        if target.exists():
            # Overwrite with random bytes before unlinking to minimize residual plaintext/metadata
            size = target.stat().st_size
            try:
                target.write_bytes(os.urandom(min(size, 65536)))
            except OSError:
                pass
            target.unlink(missing_ok=True)
            return True
        return False

    @contextmanager
    def temporary_decrypted_file(self, storage_key: str, suffix: str = "") -> Iterator[Path]:
        """Yield a short-lived temp file for parsers requiring filesystem paths, wiping it on exit."""
        plaintext = self.read_decrypted(storage_key)
        fd, raw_path = tempfile.mkstemp(prefix="aev_", suffix=suffix)
        tmp_path = Path(raw_path)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(plaintext)
            yield tmp_path
        finally:
            try:
                if tmp_path.exists():
                    tmp_path.write_bytes(b"\x00" * min(len(plaintext), 65536))
                    tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
