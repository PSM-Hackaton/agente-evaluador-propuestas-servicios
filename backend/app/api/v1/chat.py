"""Grounded Natural-Language Chat endpoints over loaded project documents (Section 2.E.5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_client_ip, require_roles
from app.core.security import ROLES_READ, ROLES_REVIEW
from app.db.base import get_db
from app.db.models import ChatMessage, Project, User
from app.schemas.domain import ChatMessageOut, ChatQuestionRequest
from app.services.agent.chat_service import answer_project_question
from app.services.audit.service import record_audit

router = APIRouter(tags=["Consulta en Lenguaje Natural"])


@router.post("/projects/{project_id}/chat", response_model=ChatMessageOut)
async def ask_chat_question(
    project_id: str,
    payload: ChatQuestionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_READ)),
) -> ChatMessage:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    _, assistant_msg = await answer_project_question(
        db=db,
        project=project,
        question=payload.question,
        user_id=current_user.id,
        evaluation_run_id=payload.evaluation_run_id,
    )
    await record_audit(
        db,
        action="project.chat_query",
        resource_type="project",
        resource_id=project_id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={"question_length": len(payload.question)},
    )
    await db.commit()
    await db.refresh(assistant_msg)
    return assistant_msg


@router.get("/projects/{project_id}/chat", response_model=list[ChatMessageOut])
async def get_chat_history(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> list[ChatMessage]:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")
    res = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at)
    )
    return list(res.scalars().all())


@router.delete("/projects/{project_id}/chat", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat_history(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_REVIEW)),
) -> None:
    """Clear natural-language Q&A history for a project."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    await db.execute(delete(ChatMessage).where(ChatMessage.project_id == project_id))
    await record_audit(
        db,
        action="project.chat_clear",
        resource_type="project",
        resource_id=project_id,
        user=current_user,
        ip_address=get_client_ip(request),
    )
    await db.commit()
