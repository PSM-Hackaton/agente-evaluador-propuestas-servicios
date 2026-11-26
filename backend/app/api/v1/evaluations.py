"""Evaluation Execution, SSE Live Traceability, Human Review, and Report Exports (Sections 2.D, 2.E, 3.C)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_client_ip, require_roles, require_roles_flexible
from app.core.security import ROLES_EVALUATE, ROLES_READ, ROLES_REVIEW
from app.db.base import get_db, get_session_factory
from app.db.models import (
    EvaluationRun,
    EvaluationStatus,
    HumanReview,
    Project,
    Proposal,
    User,
)
from app.schemas.domain import (
    EvaluationRunDetailOut,
    EvaluationTriggerRequest,
    HumanReviewCreate,
    HumanReviewOut,
)
from app.services.agent.orchestrator import (
    run_project_evaluation_in_db,
    subscribe_trace,
    unsubscribe_trace,
)
from app.services.audit.service import record_audit
from app.services.finance.bcv import get_active_bcv_rate
from app.services.reports.exporter import (
    generate_csv_report,
    generate_markdown_report,
    generate_pdf_report,
    generate_xlsx_report,
)

router = APIRouter(tags=["Evaluación Agéntica y Reportes"])


async def _load_evaluation_detail(db: AsyncSession, evaluation_id: str) -> EvaluationRun:
    res = await db.execute(
        select(EvaluationRun)
        .where(EvaluationRun.id == evaluation_id)
        .options(
            selectinload(EvaluationRun.proposal_evaluations),
            selectinload(EvaluationRun.trace_steps),
            selectinload(EvaluationRun.human_reviews),
        )
    )
    run = res.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluación no encontrada.")
    run.proposal_evaluations.sort(key=lambda x: x.rank_position)
    return run


async def _run_evaluation_background(
    project_id: str,
    evaluation_id: str,
    enable_web_search: bool,
    bcv_rate_override: float | None,
) -> None:
    factory = get_session_factory()
    async with factory() as bg_db:
        await run_project_evaluation_in_db(
            bg_db,
            project_id=project_id,
            evaluation_run_id=evaluation_id,
            enable_web_search=enable_web_search,
            bcv_rate_override=bcv_rate_override,
        )


@router.post("/projects/{project_id}/evaluate", response_model=EvaluationRunDetailOut, status_code=status.HTTP_201_CREATED)
async def trigger_evaluation(
    project_id: str,
    payload: EvaluationTriggerRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_EVALUATE)),
) -> EvaluationRun:
    """Button action: 'Evaluar Propuestas de Servicios' — runs synchronously or async with SSE stream."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    props = (await db.execute(select(Proposal).where(Proposal.project_id == project_id))).scalars().all()
    if not (3 <= len(props) <= 20):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"El proyecto debe tener entre 3 y 20 propuestas cargadas para evaluarse "
                f"(actualmente tiene {len(props)})."
            ),
        )

    bcv = await get_active_bcv_rate(db)
    run = EvaluationRun(
        project_id=project_id,
        triggered_by_id=current_user.id,
        status=EvaluationStatus.PENDING.value,
        bcv_rate_used=payload.bcv_rate_override or bcv.usd_to_ves,
        bcv_rate_source="manual_override" if payload.bcv_rate_override else bcv.source,
        iva_rate_used=payload.iva_rate,
        web_search_used=payload.enable_web_search,
    )
    db.add(run)
    await db.flush()
    await record_audit(
        db,
        action="evaluation.trigger",
        resource_type="evaluation",
        resource_id=run.id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={
            "project_id": project_id,
            "proposals_count": len(props),
            "web_search": payload.enable_web_search,
            "run_in_background": payload.run_in_background,
        },
    )
    await db.commit()

    if payload.run_in_background:
        background_tasks.add_task(
            _run_evaluation_background,
            project_id,
            run.id,
            payload.enable_web_search,
            payload.bcv_rate_override,
        )
        return await _load_evaluation_detail(db, run.id)

    await run_project_evaluation_in_db(
        db,
        project_id=project_id,
        evaluation_run_id=run.id,
        enable_web_search=payload.enable_web_search,
        bcv_rate_override=payload.bcv_rate_override,
    )
    return await _load_evaluation_detail(db, run.id)


@router.get("/evaluations/{evaluation_id}", response_model=EvaluationRunDetailOut)
async def get_evaluation(
    evaluation_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(ROLES_READ)),
) -> EvaluationRun:
    return await _load_evaluation_detail(db, evaluation_id)


@router.get("/evaluations/{evaluation_id}/stream")
async def stream_evaluation_trace(
    evaluation_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles_flexible(ROLES_READ)),
) -> EventSourceResponse:
    """Server-Sent Events (SSE) endpoint streaming live agent traceability steps (Section 2.D.3)."""
    # Subscribe BEFORE reading DB snapshot to prevent missing any step between query and subscribe
    queue = subscribe_trace(evaluation_id)
    try:
        run = await _load_evaluation_detail(db, evaluation_id)
    except Exception:
        unsubscribe_trace(evaluation_id, queue)
        raise

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        last_sent_step = 0
        try:
            for step in run.trace_steps:
                last_sent_step = max(last_sent_step, step.step_number)
                yield {
                    "event": "trace_step",
                    "data": json.dumps(
                        {
                            "step_number": step.step_number,
                            "phase": step.phase,
                            "proposal_identifier": step.proposal_identifier,
                            "tool_name": step.tool_name,
                            "message": step.message,
                            "metadata": step.metadata_json or {},
                            "timestamp": step.created_at.isoformat(),
                        },
                        ensure_ascii=False,
                    ),
                }

            if run.status in (EvaluationStatus.COMPLETED.value, EvaluationStatus.FAILED.value):
                yield {
                    "event": run.status,
                    "data": json.dumps(
                        {
                            "evaluation_id": run.id,
                            "status": run.status,
                            "recommended_identifier": run.recommended_identifier,
                        },
                        ensure_ascii=False,
                    ),
                }
                return

            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=20.0)
                    evt_name = evt.get("event", "trace_step")
                    if evt_name == "trace_step":
                        step_no = int(evt.get("step_number") or 0)
                        if step_no and step_no <= last_sent_step:
                            continue
                        last_sent_step = max(last_sent_step, step_no)
                    yield {"event": evt_name, "data": json.dumps(evt, ensure_ascii=False)}
                    if evt_name in ("completed", "failed"):
                        break
                except TimeoutError:
                    yield {"event": "heartbeat", "data": "{}"}
        finally:
            unsubscribe_trace(evaluation_id, queue)

    return EventSourceResponse(event_generator())


@router.post("/evaluations/{evaluation_id}/reviews", response_model=HumanReviewOut, status_code=status.HTTP_201_CREATED)
async def add_human_review(
    evaluation_id: str,
    payload: HumanReviewCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(ROLES_REVIEW)),
) -> HumanReview:
    """Human-in-the-loop review, notes, confirmation, or override with immutable audit log (Section 2.E.2)."""
    run = await db.get(EvaluationRun, evaluation_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluación no encontrada.")

    review = HumanReview(
        evaluation_run_id=evaluation_id,
        proposal_evaluation_id=payload.proposal_evaluation_id,
        reviewer_id=current_user.id,
        reviewer_name=current_user.full_name,
        reviewer_role=current_user.role,
        decision=payload.decision,
        notes=payload.notes,
        override_recommended_proposal_id=payload.override_recommended_proposal_id,
    )
    db.add(review)

    if payload.decision == "overridden" and payload.override_recommended_proposal_id:
        override_prop = await db.get(Proposal, payload.override_recommended_proposal_id)
        run.recommended_proposal_id = payload.override_recommended_proposal_id
        if override_prop is not None:
            run.recommended_identifier = override_prop.proposal_identifier

    await db.flush()
    await record_audit(
        db,
        action=f"evaluation.human_review.{payload.decision}",
        resource_type="evaluation",
        resource_id=evaluation_id,
        user=current_user,
        ip_address=get_client_ip(request),
        details={
            "decision": payload.decision,
            "notes": payload.notes,
            "override_proposal_id": payload.override_recommended_proposal_id,
        },
    )
    await db.commit()
    await db.refresh(review)
    return review


@router.get("/evaluations/{evaluation_id}/export/{fmt}")
async def export_evaluation_report(
    evaluation_id: str,
    fmt: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles_flexible(ROLES_READ)),
) -> Response:
    """Export Committee Report in PDF, Markdown, XLSX, CSV, or Hackathon `salida.json`."""
    run = await _load_evaluation_detail(db, evaluation_id)
    project = await db.get(Project, run.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado.")

    fmt_low = fmt.lower()
    await record_audit(
        db,
        action=f"evaluation.export.{fmt_low}",
        resource_type="evaluation",
        resource_id=evaluation_id,
        user=current_user,
        ip_address=get_client_ip(request),
    )
    await db.commit()

    if fmt_low == "pdf":
        data = generate_pdf_report(project, run, run.proposal_evaluations, run.human_reviews)
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="informe_{project.id[:8]}.pdf"'},
        )
    if fmt_low in ("md", "markdown"):
        md = generate_markdown_report(project, run, run.proposal_evaluations, run.human_reviews)
        return Response(
            content=md.encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="informe_{project.id[:8]}.md"'},
        )
    if fmt_low == "xlsx":
        data = generate_xlsx_report(project, run, run.proposal_evaluations)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="comparativa_{project.id[:8]}.xlsx"'},
        )
    if fmt_low == "csv":
        data = generate_csv_report(run.proposal_evaluations)
        return Response(
            content=data,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="comparativa_{project.id[:8]}.csv"'},
        )
    if fmt_low in ("salida-json", "salida_json", "json"):
        payload = run.salida_json_payload or {}
        return Response(
            content=json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="salida.json"'},
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Formato inválido. Use: pdf, markdown, xlsx, csv o salida-json.",
    )
