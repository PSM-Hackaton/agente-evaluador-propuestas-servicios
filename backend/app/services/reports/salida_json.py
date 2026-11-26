"""Hackathon `salida.json` generator and strict format validator (Section 3.C)."""

from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.config import get_settings


def get_git_commit_hash(repo_dir: Path | None = None) -> str:
    """Obtain exact commit hash via `git rev-parse HEAD` as required by Section 3.C."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_dir) if repo_dir else None,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
        return out.strip()
    except Exception:
        return "0" * 40


def get_git_repo_slug(repo_dir: Path | None = None) -> str:
    """Resolve repository path (e.g. 'org/repo') from env override or git remote URL."""
    settings = get_settings()
    if settings.hackathon_repo_path.strip():
        return settings.hackathon_repo_path.strip()
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=str(repo_dir) if repo_dir else None,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
        url = re.sub(r"\.git$", "", url)
        # Handle https://host/group/repo or git@host:group/repo
        if "://" in url:
            parts = url.split("://", 1)[1].split("/", 1)
            return parts[1] if len(parts) > 1 else url
        if ":" in url:
            return url.split(":", 1)[1]
        return url
    except Exception:
        return "local/agente-evaluador-propuestas-servicios"


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
    if not isinstance(repo, str) or not repo.strip():
        errors.append("El campo 'repositorio' debe ser un string no vacío.")

    commit = payload.get("commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit):
        errors.append("El campo 'commit' debe ser un hash git hexadecimal válido.")

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
