"""Hackathon Batch Mode API endpoint (`lote/` -> `salida.json`) and validator (Section 3.C)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles
from app.core.security import ROLES_EVALUATE, ROLES_READ
from app.db.base import get_db
from app.db.models import User
from app.schemas.domain import BatchRunRequest
from app.services.agent.orchestrator import evaluate_proposals_core
from app.services.audit.service import record_audit
from app.services.ingestion.pipeline import SUPPORTED_DOCUMENT_EXTENSIONS, ingest_document
from app.services.llm.client import UnifiedLLMClient
from app.services.reports.salida_json import validate_salida_json

router = APIRouter(prefix="/batch", tags=["Modo Lote (salida.json)"])

SUPPORTED_EXTS = SUPPORTED_DOCUMENT_EXTENSIONS


@router.post("/run")
async def run_batch_evaluation(
    payload: BatchRunRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_EVALUATE)),
) -> dict:
    """Evaluate a local hackathon `lote/` folder and automatically generate validated `salida.json`."""
    lote_path = Path(payload.lote_dir).resolve()
    project_pdf = lote_path / "proyecto.pdf"
    proposals_dir = lote_path / "propuestas"

    if not project_pdf.exists() or not proposals_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"La carpeta '{lote_path}' debe contener 'proyecto.pdf' y la subcarpeta 'propuestas/'.",
        )

    proposal_paths = sorted(
        p for p in proposals_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    )
    if not proposal_paths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se encontraron propuestas válidas en la carpeta propuestas/.",
        )

    llm = UnifiedLLMClient()
    project_doc = await ingest_document("proyecto.pdf", project_pdf.read_bytes(), llm_client=llm)
    files_payload = [(None, p.name, p.read_bytes()) for p in proposal_paths]

    output = await evaluate_proposals_core(
        project_name=f"Evaluación por Lote ({lote_path.name})",
        project_location="La Hoyada, Caracas",
        project_requirements_text=project_doc.visible_text,
        proposal_files=files_payload,
        db=db,
        enable_web_search=payload.enable_web_search,
        bcv_rate_override=payload.bcv_rate_override,
    )

    is_valid_format, validation_errors = validate_salida_json(
        output.salida_json,
        expected_filenames=[p.name for p in proposal_paths],
    )

    written_to: str | None = None
    if payload.output_path:
        out_file = Path(payload.output_path).resolve()
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(json.dumps(output.salida_json, indent=2, ensure_ascii=False), encoding="utf-8")
        written_to = str(out_file)

    await record_audit(
        db,
        action="batch.run",
        resource_type="batch",
        resource_id=str(lote_path),
        user=current_user,
        ip_address=get_client_ip(request),
        details={
            "proposals_count": len(proposal_paths),
            "recommended": output.recommended_identifier,
            "salida_valid": is_valid_format,
        },
    )
    await db.commit()

    return {
        "salida_json": output.salida_json,
        "salida_valid": is_valid_format,
        "validation_errors": validation_errors,
        "written_to": written_to,
        "executive_summary": output.executive_summary,
        "bcv_rate": output.bcv_rate,
        "valid_count": sum(1 for r in output.results if r.is_valid),
        "discarded_count": sum(1 for r in output.results if not r.is_valid),
    }


@router.post("/validate-salida")
async def validate_salida_payload(
    payload: dict,
    _: User = Depends(require_roles(ROLES_READ)),
) -> dict:
    """Validate an arbitrary `salida.json` payload against Section 3.C rules."""
    ok, errors = validate_salida_json(payload)
    return {"valid": ok, "errors": errors}
