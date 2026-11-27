"""Project Management, Document Upload (Encrypted), and Workflow Transitions (Section 2.E.1)."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles, require_roles_flexible
from app.core.config import get_settings
from app.core.security import ROLES_APPROVE, ROLES_READ, ROLES_REVIEW, ROLES_UPLOAD, UserRole
from app.db.base import get_db
from app.db.models import (
    ALLOWED_STATUS_TRANSITIONS,
    EvaluationRun,
    Project,
    ProjectStatus,
    Proposal,
    User,
)
from app.schemas.domain import EvaluationRunSummaryOut
from app.schemas.project import ProjectCreate, ProjectOut, ProjectStatusTransition, ProjectUpdate
from app.services.audit.service import record_audit
from app.services.ingestion.pipeline import SUPPORTED_DOCUMENT_EXTENSIONS, ingest_document
from app.services.llm.client import UnifiedLLMClient
from app.services.storage.encrypted_storage import EncryptedFileStorage

router = APIRouter(prefix="/projects", tags=["Proyectos y Flujo de Proceso"])


async def _to_project_out(db: AsyncSession, project: Project) -> ProjectOut:
    p_cnt = (
        await db.execute(select(func.count(Proposal.id)).where(Proposal.project_id == project.id))
    ).scalar_one()
    e_cnt = (
        await db.execute(select(func.count(EvaluationRun.id)).where(EvaluationRun.project_id == project.id))
    ).scalar_one()
    latest_eval_id = (
        await db.execute(
            select(EvaluationRun.id)
            .where(EvaluationRun.project_id == project.id)
            .order_by(desc(EvaluationRun.started_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        execution_location=project.execution_location,
        reference_budget=project.reference_budget,
        reference_currency=project.reference_currency,
        status=project.status,
        document_filename=project.document_filename,
        document_sha256=project.document_sha256,
        adjudicated_proposal_id=project.adjudicated_proposal_id,
        adjudication_notes=project.adjudication_notes,
        proposals_count=int(p_cnt),
        evaluations_count=int(e_cnt),
        latest_evaluation_id=latest_eval_id,
        has_requirements_text=bool(project.extracted_requirements_text),
        requirements_preview=(project.extracted_requirements_text or "")[:600] or None,
        created_by_id=project.created_by_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> ProjectOut:
    project = Project(
        name=payload.name,
        description=payload.description,
        execution_location=payload.execution_location,
        reference_budget=payload.reference_budget,
        reference_currency=payload.reference_currency,
        status=ProjectStatus.EN_RECEPCION.value,
        created_by_id=current_user.id,
    )
    db.add(project)
    await db.flush()
    await record_audit(
        db,
        action="project.create",
        resource_type="project",
        resource_id=project.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"name": project.name, "location": project.execution_location},
    )
    await db.commit()
    await db.refresh(project)
    return await _to_project_out(db, project)


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    status_filter: ProjectStatus | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[ProjectOut]:
    stmt = select(Project).order_by(desc(Project.created_at))
    if status_filter is not None:
        stmt = stmt.where(Project.status == status_filter.value)
    res = await db.execute(stmt)
    projects = list(res.scalars().all())
    return [await _to_project_out(db, p) for p in projects]


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> ProjectOut:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")
    return await _to_project_out(db, project)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> ProjectOut:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(project, k, v)
    await record_audit(
        db,
        action="project.update",
        resource_type="project",
        resource_id=project.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"changes": changes},
    )
    await db.commit()
    await db.refresh(project)
    return await _to_project_out(db, project)


@router.post("/{project_id}/document", response_model=ProjectOut)
async def upload_project_document(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_UPLOAD)),
) -> ProjectOut:
    """Upload and encrypt (AES-256-GCM) the base Project / Terms of Reference document."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    settings = get_settings()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo vacío.")
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Archivo excede límite permitido.")

    filename = file.filename or "proyecto.pdf"
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_DOCUMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Formato no soportado para documento base: {ext}. "
                f"Permitidos: {', '.join(sorted(SUPPORTED_DOCUMENT_EXTENSIONS))}."
            ),
        )

    storage = EncryptedFileStorage()
    if project.document_storage_key:
        storage.delete(project.document_storage_key)

    storage_key, sha256_hex = storage.save_encrypted(content, category=f"projects_{project.id}", extension=ext)
    ingested = await ingest_document(filename=filename, content=content, llm_client=UnifiedLLMClient())

    project.document_filename = filename
    project.document_storage_key = storage_key
    project.document_sha256 = sha256_hex
    project.extracted_requirements_text = ingested.visible_text

    await record_audit(
        db,
        action="project.upload_document",
        resource_type="project",
        resource_id=project.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"filename": filename, "sha256": sha256_hex, "encrypted_at_rest": "AES-256-GCM"},
    )
    await db.commit()
    await db.refresh(project)
    return await _to_project_out(db, project)


@router.get("/{project_id}/document/download")
async def download_project_document(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles_flexible(ROLES_READ)),
) -> Response:
    """Decrypt and download the project's base requirements document."""
    project = await db.get(Project, project_id)
    if project is None or not project.document_storage_key or not project.document_filename:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento base del proyecto no encontrado.",
        )

    storage = EncryptedFileStorage()
    content = storage.read_decrypted(project.document_storage_key)
    media_type = mimetypes.guess_type(project.document_filename)[0] or "application/octet-stream"

    await record_audit(
        db,
        action="project.download_document",
        resource_type="project",
        resource_id=project.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"filename": project.document_filename},
    )
    await db.commit()

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{project.document_filename}"'},
    )


@router.post("/{project_id}/status", response_model=ProjectOut)
async def transition_project_status(
    project_id: str,
    payload: ProjectStatusTransition,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_REVIEW)),
) -> ProjectOut:
    """Enforce workflow stages (En recepción -> En evaluación -> En revisión del comité -> Adjudicado / Cerrado)."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    current_status = ProjectStatus(project.status)
    target = payload.target_status
    if target not in ALLOWED_STATUS_TRANSITIONS[current_status]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transición inválida de '{current_status.value}' a '{target.value}'.",
        )

    # Adjudicating or closing requires Approver or Admin role
    if target in (ProjectStatus.ADJUDICADO, ProjectStatus.CERRADO):
        if UserRole(current_user.role) not in ROLES_APPROVE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo un usuario con rol 'aprobador' o 'admin' puede adjudicar o cerrar un proyecto.",
            )

    if payload.adjudicated_proposal_id:
        adjudicated = await db.get(Proposal, payload.adjudicated_proposal_id)
        if adjudicated is None or adjudicated.project_id != project.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La propuesta adjudicada no existe o no pertenece a este proyecto.",
            )

    project.status = target.value
    if payload.adjudicated_proposal_id:
        project.adjudicated_proposal_id = payload.adjudicated_proposal_id
    if payload.notes:
        project.adjudication_notes = payload.notes

    await record_audit(
        db,
        action="project.status_transition",
        resource_type="project",
        resource_id=project.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={
            "from_status": current_status.value,
            "to_status": target.value,
            "adjudicated_proposal_id": payload.adjudicated_proposal_id,
            "notes": payload.notes,
        },
    )
    await db.commit()
    await db.refresh(project)
    return await _to_project_out(db, project)


@router.get("/{project_id}/evaluations", response_model=list[EvaluationRunSummaryOut])
async def list_project_evaluations(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[EvaluationRun]:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")
    res = await db.execute(
        select(EvaluationRun)
        .where(EvaluationRun.project_id == project_id)
        .order_by(desc(EvaluationRun.started_at))
    )
    return list(res.scalars().all())


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_APPROVE)),
) -> None:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    storage = EncryptedFileStorage()
    if project.document_storage_key:
        storage.delete(project.document_storage_key)

    props = (await db.execute(select(Proposal).where(Proposal.project_id == project_id))).scalars().all()
    for p in props:
        storage.delete(p.encrypted_storage_key)

    await db.delete(project)
    await record_audit(
        db,
        action="project.delete",
        resource_type="project",
        resource_id=project_id,
        user=current_user,
        ip_address=get_client_ip(request),
    )
    await db.commit()
