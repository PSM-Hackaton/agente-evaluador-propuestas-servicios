"""Bulk Proposal Upload (3 to 20+ files), Encrypted Storage, and Retrieval (Section 2.D.2 & 2.F)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles, require_roles_flexible
from app.core.config import get_settings
from app.core.security import ROLES_READ, ROLES_UPLOAD
from app.db.base import get_db
from app.db.models import Project, Proposal, User
from app.schemas.domain import ProposalDetailOut, ProposalOut
from app.services.audit.service import record_audit
from app.services.ingestion.pipeline import SUPPORTED_DOCUMENT_EXTENSIONS
from app.services.storage.encrypted_storage import EncryptedFileStorage

router = APIRouter(tags=["Propuestas de Proveedores"])

ALLOWED_EXTENSIONS = SUPPORTED_DOCUMENT_EXTENSIONS


@router.post("/projects/{project_id}/proposals", response_model=list[ProposalOut], status_code=status.HTTP_201_CREATED)
async def upload_proposals_bulk(
    project_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> list[Proposal]:
    """Upload multiple supplier proposals (PDF, JPG, PNG, XLSX) encrypted at rest with AES-256-GCM."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Debe adjuntar al menos un archivo.")
    if len(files) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Máximo 50 archivos por carga masiva.")

    settings = get_settings()
    storage = EncryptedFileStorage()
    saved: list[Proposal] = []

    for up in files:
        filename = Path(up.filename or "propuesta.pdf").name
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Archivo '{filename}' tiene formato no soportado ({ext}). "
                    f"Permitidos: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
                ),
            )
        content = await up.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Archivo vacío: {filename}")
        if len(content) > settings.max_upload_size_mb * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Archivo '{filename}' supera el máximo de {settings.max_upload_size_mb} MB.",
            )

        identifier = Path(filename).stem
        storage_key, sha256_hex = storage.save_encrypted(
            content, category=f"proposals_{project_id}", extension=ext
        )

        # Upsert if same proposal_identifier already uploaded to this project
        existing_res = await db.execute(
            select(Proposal).where(
                Proposal.project_id == project_id,
                Proposal.proposal_identifier == identifier,
            )
        )
        existing = existing_res.scalar_one_or_none()
        if existing:
            storage.delete(existing.encrypted_storage_key)
            existing.original_filename = filename
            existing.file_extension = ext
            existing.mime_type = up.content_type or "application/octet-stream"
            existing.file_size_bytes = len(content)
            existing.file_sha256 = sha256_hex
            existing.encrypted_storage_key = storage_key
            existing.uploaded_by_id = current_user.id
            saved.append(existing)
        else:
            prop = Proposal(
                project_id=project_id,
                proposal_identifier=identifier,
                original_filename=filename,
                file_extension=ext,
                mime_type=up.content_type or "application/octet-stream",
                file_size_bytes=len(content),
                file_sha256=sha256_hex,
                encrypted_storage_key=storage_key,
                uploaded_by_id=current_user.id,
            )
            db.add(prop)
            saved.append(prop)

    await db.flush()
    await record_audit(
        db,
        action="proposal.bulk_upload",
        resource_type="project",
        resource_id=project_id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={
            "count": len(saved),
            "filenames": [p.original_filename for p in saved],
            "encryption": "AES-256-GCM",
        },
    )
    await db.commit()
    for p in saved:
        await db.refresh(p)
    return saved


@router.get("/projects/{project_id}/proposals", response_model=list[ProposalOut])
async def list_proposals(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[Proposal]:
    res = await db.execute(
        select(Proposal).where(Proposal.project_id == project_id).order_by(Proposal.original_filename)
    )
    return list(res.scalars().all())


@router.get("/proposals/{proposal_id}", response_model=ProposalDetailOut)
async def get_proposal_detail(
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> ProposalDetailOut:
    """Get metadata and sanitized extracted text preview for a single uploaded proposal."""
    prop = await db.get(Proposal, proposal_id)
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propuesta no encontrada.")
    return ProposalDetailOut(
        id=prop.id,
        project_id=prop.project_id,
        supplier_id=prop.supplier_id,
        proposal_identifier=prop.proposal_identifier,
        original_filename=prop.original_filename,
        file_extension=prop.file_extension,
        mime_type=prop.mime_type,
        file_size_bytes=prop.file_size_bytes,
        file_sha256=prop.file_sha256,
        ingestion_method=prop.ingestion_method,
        created_at=prop.created_at,
        extracted_text_preview=(prop.extracted_text or "")[:1500] or None,
        has_hidden_text_findings=bool(prop.hidden_text_findings),
    )


@router.get("/proposals/{proposal_id}/download")
async def download_proposal_decrypted(
    proposal_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles_flexible(ROLES_READ)),
) -> Response:
    prop = await db.get(Proposal, proposal_id)
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propuesta no encontrada.")
    storage = EncryptedFileStorage()
    content = storage.read_decrypted(prop.encrypted_storage_key)
    await record_audit(
        db,
        action="proposal.download",
        resource_type="proposal",
        resource_id=prop.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"filename": prop.original_filename},
    )
    await db.commit()
    return Response(
        content=content,
        media_type=prop.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{prop.original_filename}"'},
    )


@router.delete("/proposals/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_proposal(
    proposal_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> None:
    prop = await db.get(Proposal, proposal_id)
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propuesta no encontrada.")
    storage = EncryptedFileStorage()
    storage.delete(prop.encrypted_storage_key)
    await db.delete(prop)
    await record_audit(
        db,
        action="proposal.delete",
        resource_type="proposal",
        resource_id=proposal_id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"identifier": prop.proposal_identifier},
    )
    await db.commit()
