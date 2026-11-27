"""Hackathon `salida.json` generator and strict format validator (Section 3.C)."""

from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.config import get_settings


class SalidaJsonMetadataError(RuntimeError):
    """Raised when `repositorio` or `commit` cannot be reliably determined for `salida.json`."""


def _normalize_repo_slug(raw: str) -> str | None:
    """Normalize HTTPS/SSH git URL or `group/project` path; return None if local/invalid."""
    s = (raw or "").strip()
    if not s:
        return None
    low = s.lower()
    if low.startswith("file://") or s.startswith(("/", "./", "../", "~")) or "\\" in s:
        return None
    if re.match(r"^[A-Za-z]:[/\\]", s):
        return None

    s = re.sub(r"\.git$", "", s.rstrip("/"))
    if "://" in s:
        host_and_path = s.split("://", 1)[1]
        if "/" not in host_and_path:
            return None
        s = host_and_path.split("/", 1)[1]
    elif ":" in s:
        # SCP-style SSH URL: git@gitlab.example.com:grupo/subgrupo/proyecto
        s = s.split(":", 1)[1]

    s = re.sub(r"\.git$", "", s.strip("/"))
    if not re.fullmatch(r"[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+", s):
        return None
    return s


def get_git_commit_hash(repo_dir: Path | None = None) -> str:
    """Obtain exact commit hash via `git rev-parse HEAD` as required by Section 3.C."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_dir) if repo_dir else None,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
    except Exception as exc:
        raise SalidaJsonMetadataError(
            "No se pudo obtener el hash de commit real mediante 'git rev-parse HEAD'."
        ) from exc

    if not re.fullmatch(r"[0-9a-fA-F]{40}", out) or set(out) == {"0"}:
        raise SalidaJsonMetadataError(
            f"El hash obtenido por 'git rev-parse HEAD' no es un commit SHA-1 válido: {out!r}"
        )
    return out


def get_git_repo_slug(repo_dir: Path | None = None) -> str:
    """Resolve `grupo/proyecto` slug from HACKATHON_REPO_PATH or git origin remote."""
    settings = get_settings()
    override = settings.hackathon_repo_path.strip()
    if override:
        slug = _normalize_repo_slug(override)
        if not slug:
            raise SalidaJsonMetadataError(
                f"HACKATHON_REPO_PATH inválido ({override!r}); debe tener formato 'grupo/proyecto' o URL Git válida."
            )
        return slug

    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=str(repo_dir) if repo_dir else None,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
    except Exception as exc:
        raise SalidaJsonMetadataError(
            "No se pudo leer el remoto 'origin' de git; configure HACKATHON_REPO_PATH='grupo/proyecto'."
        ) from exc

    slug = _normalize_repo_slug(url)
    if not slug:
        raise SalidaJsonMetadataError(
            f"El remoto 'origin' ({url!r}) no es una ruta GitLab/GitHub válida; configure HACKATHON_REPO_PATH."
        )
    return slug


def build_salida_json(
    *,
    inicio: str,
    fin: str,
    procesados: list[dict[str, str]],
    ranking: list[str],
    repo_dir: Path | None = None,
    repositorio: str | None = None,
    commit: str | None = None,
) -> dict[str, Any]:
    """Construct exact Section 3.C `salida.json` structure."""
    # Deduplicate defensively while preserving order
    seen: set[str] = set()
    clean_ranking: list[str] = []
    for item in ranking:
        if item not in seen:
            seen.add(item)
            clean_ranking.append(item)

    return {
        "reto": "propuesta_servicios",
        "repositorio": repositorio or get_git_repo_slug(repo_dir),
        "commit": commit or get_git_commit_hash(repo_dir),
        "inicio": inicio,
        "fin": fin,
        "procesados": procesados,
        "ranking": clean_ranking,
    }


def _is_valid_iso_with_tz(val: Any) -> bool:
    if not isinstance(val, str):
        return False
    try:
        dt = datetime.fromisoformat(val)
        return dt.tzinfo is not None
    except ValueError:
        return False


def validate_salida_json(
    payload: dict[str, Any],
    expected_filenames: list[str] | None = None,
) -> tuple[bool, list[str]]:
    """Validate `salida.json` against every requirement of Section 3.C."""
    errors: list[str] = []
    required_keys = ["reto", "repositorio", "commit", "inicio", "fin", "procesados", "ranking"]
    for key in required_keys:
        if key not in payload:
            errors.append(f"Falta el campo obligatorio '{key}'.")

    if payload.get("reto") != "propuesta_servicios":
        errors.append("El campo 'reto' debe ser exactamente 'propuesta_servicios'.")

    repo = payload.get("repositorio")
    if not isinstance(repo, str) or _normalize_repo_slug(repo) is None:
        errors.append("El campo 'repositorio' debe ser un slug válido 'grupo/proyecto' (no ruta local).")

    commit = payload.get("commit")
    if (
        not isinstance(commit, str)
        or not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit)
        or set(commit) == {"0"}
    ):
        errors.append("El campo 'commit' debe ser un hash git hexadecimal real (no ceros).")

    if not _is_valid_iso_with_tz(payload.get("inicio")):
        errors.append("El campo 'inicio' debe estar en formato ISO 8601 con zona horaria.")
    if not _is_valid_iso_with_tz(payload.get("fin")):
        errors.append("El campo 'fin' debe estar en formato ISO 8601 con zona horaria.")

    procesados = payload.get("procesados")
    if not isinstance(procesados, list) or len(procesados) == 0:
        errors.append("El campo 'procesados' debe ser una lista no vacía.")
    else:
        for i, item in enumerate(procesados):
            if not isinstance(item, dict) or "archivo" not in item or "hora" not in item:
                errors.append(f"procesados[{i}] debe tener 'archivo' y 'hora'.")
            elif not _is_valid_iso_with_tz(item.get("hora")):
                errors.append(f"procesados[{i}].hora no tiene formato ISO 8601 con zona horaria.")

    ranking = payload.get("ranking")
    if not isinstance(ranking, list) or len(ranking) == 0:
        errors.append("El campo 'ranking' debe ser una lista no vacía.")
    else:
        if len(ranking) != len(set(ranking)):
            errors.append("CRÍTICO: El campo 'ranking' contiene identificadores repetidos (vale 0 puntos).")
        for ident in ranking:
            if not isinstance(ident, str) or "." in Path(ident).suffix:
                # Extensions like .pdf, .png, .jpg, .xlsx must NOT be in ranking identifiers
                if any(ident.lower().endswith(ext) for ext in (".pdf", ".png", ".jpg", ".jpeg", ".xlsx")):
                    errors.append(f"El identificador '{ident}' en 'ranking' no debe incluir extensión de archivo.")

    if expected_filenames is not None and isinstance(ranking, list) and isinstance(procesados, list):
        expected_ids = {Path(f).stem for f in expected_filenames}
        missing = expected_ids - set(ranking)
        extra = set(ranking) - expected_ids
        if missing:
            errors.append(f"Faltan propuestas en 'ranking': {sorted(missing)}")
        if extra:
            errors.append(f"Identificadores desconocidos en 'ranking': {sorted(extra)}")
        proc_files = {p.get("archivo") for p in procesados if isinstance(p, dict)}
        if proc_files != set(expected_filenames):
            errors.append("La lista 'procesados' no coincide exactamente con los archivos de propuestas/.")

    return (len(errors) == 0, errors)
