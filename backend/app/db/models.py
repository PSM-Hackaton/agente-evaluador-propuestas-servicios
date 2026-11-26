"""SQLAlchemy ORM models with full AES-256-GCM encryption at rest and HMAC blind indexes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, EncryptedFloat, EncryptedJSON, EncryptedText, UTCDateTime


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


class ProjectStatus(StrEnum):
    """Workflow stages defined in Section 2.E.1."""

    EN_RECEPCION = "en_recepcion"
    EN_EVALUACION = "en_evaluacion"
    EN_REVISION_COMITE = "en_revision_comite"
    ADJUDICADO = "adjudicado"
    CERRADO = "cerrado"


ALLOWED_STATUS_TRANSITIONS: dict[ProjectStatus, set[ProjectStatus]] = {
    ProjectStatus.EN_RECEPCION: {ProjectStatus.EN_EVALUACION, ProjectStatus.CERRADO},
    ProjectStatus.EN_EVALUACION: {
        ProjectStatus.EN_RECEPCION,
        ProjectStatus.EN_REVISION_COMITE,
        ProjectStatus.CERRADO,
    },
    ProjectStatus.EN_REVISION_COMITE: {
        ProjectStatus.EN_EVALUACION,
        ProjectStatus.ADJUDICADO,
        ProjectStatus.CERRADO,
    },
    ProjectStatus.ADJUDICADO: {ProjectStatus.CERRADO},
    ProjectStatus.CERRADO: set(),
}


class EvaluationStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class DiscardReasonCode(StrEnum):
    """Exact 7 discard reasons defined in Section 3.B of the specification."""

    ALCANCE_INCOMPLETO = "alcance_incompleto"
    INCOMPATIBILIDAD_TECNICA = "incompatibilidad_tecnica"
    CAPACIDAD_INSUFICIENTE = "capacidad_insuficiente"
    EQUIPOS_OBSOLETOS_RECICLADOS = "equipos_obsoletos_reciclados"
    COSTOS_CONDICIONES_ABUSIVAS = "costos_condiciones_abusivas"
    ERROR_ARITMETICO = "error_aritmetico"
    INYECCION_PROMPT = "inyeccion_prompt"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    email_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Supplier(Base):
    """Centralized Supplier Directory (Section 2.E.3), encrypted at rest."""

    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    name_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    rif: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    rif_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    location: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    representative: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    phone: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    alerts: Mapped[list[SupplierAlert]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan"
    )
    proposals: Mapped[list[Proposal]] = relationship(back_populates="supplier")


class SupplierAlert(Base):
    """Automatic alerts when a supplier is discarded or attempts manipulation (Section 2.E.3)."""

    __tablename__ = "supplier_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    evaluation_id: Mapped[str | None] = mapped_column(
        ForeignKey("evaluation_runs.id", ondelete="SET NULL"), nullable=True
    )
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="warning")
    reason_code: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    summary: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    supplier: Mapped[Supplier] = relationship(back_populates="alerts")


class Project(Base):
    """Procurement project / Terms of Reference (Section 2.E.1), encrypted at rest."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    description: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    execution_location: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    reference_budget: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    reference_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ProjectStatus.EN_RECEPCION.value, index=True
    )

    # Encrypted Project Requirements Document (e.g. proyecto.pdf)
    document_filename: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    document_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    document_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_requirements_text: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    parsed_requirements: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)

    adjudicated_proposal_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    adjudication_notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)

    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    proposals: Mapped[list[Proposal]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    evaluations: Mapped[list[EvaluationRun]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    chat_messages: Mapped[list[ChatMessage]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Proposal(Base):
    """Uploaded supplier proposal file encrypted at rest."""

    __tablename__ = "proposals"
    __table_args__ = (UniqueConstraint("project_id", "proposal_identifier_hash", name="uq_project_proposal_hash"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )

    proposal_identifier: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    proposal_identifier_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    file_extension: Mapped[str] = mapped_column(String(16), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_storage_key: Mapped[str] = mapped_column(String(512), nullable=False)

    # Cached ingestion artifacts (encrypted at rest)
    ingestion_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    hidden_text_findings: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    extracted_structured_data: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)

    uploaded_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    project: Mapped[Project] = relationship(back_populates="proposals")
    supplier: Mapped[Supplier | None] = relationship(back_populates="proposals")


class EvaluationRun(Base):
    """Single autonomous evaluation execution on a project."""

    __tablename__ = "evaluation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    triggered_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default=EvaluationStatus.PENDING.value)
    llm_provider_used: Mapped[str] = mapped_column(String(64), nullable=False, default="auto")
    bcv_rate_used: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    bcv_rate_source: Mapped[str] = mapped_column(String(128), nullable=False, default="fallback")
    iva_rate_used: Mapped[float] = mapped_column(Float, nullable=False, default=0.16)
    web_search_used: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    recommended_proposal_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    recommended_identifier: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)

    # Encrypted executive report & salida.json payload
    executive_summary: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    ranking_identifiers: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    procesados_log: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    salida_json_payload: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="evaluations")
    proposal_evaluations: Mapped[list[ProposalEvaluation]] = relationship(
        back_populates="evaluation_run", cascade="all, delete-orphan"
    )
    trace_steps: Mapped[list[AgentTraceStep]] = relationship(
        back_populates="evaluation_run", cascade="all, delete-orphan", order_by="AgentTraceStep.step_number"
    )
    human_reviews: Mapped[list[HumanReview]] = relationship(
        back_populates="evaluation_run", cascade="all, delete-orphan"
    )


class ProposalEvaluation(Base):
    """Detailed audit verdict for a single proposal within an EvaluationRun (all amounts & supplier encrypted)."""

    __tablename__ = "proposal_evaluations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    evaluation_run_id: Mapped[str] = mapped_column(
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True
    )
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), index=True)
    proposal_identifier: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    supplier_name: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    supplier_rif: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)

    is_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rank_position: Mapped[int] = mapped_column(Integer, nullable=False, default=999)
    technical_score: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    economic_score: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    overall_score: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)

    # Financial normalization (USD & VES) — encrypted at rest
    declared_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    declared_total_original: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    declared_total_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    computed_subtotal_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    shipping_cost_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    installation_cost_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    hidden_surcharges_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    taxes_iva_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    adjusted_tco_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    adjusted_tco_ves: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)
    arithmetic_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    arithmetic_discrepancy_usd: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0)

    # Encrypted rich audit details
    discard_reasons: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    discard_verdict_text: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    recommendation_rationale: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    tco_breakdown: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)
    line_items: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    fine_print_findings: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    technical_findings: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    market_comparison: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    prompt_injection_detected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    prompt_injection_evidence: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    supplier_history_alerts: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    processed_at_iso: Mapped[str | None] = mapped_column(String(64), nullable=True)

    evaluation_run: Mapped[EvaluationRun] = relationship(back_populates="proposal_evaluations")


class AgentTraceStep(Base):
    """Step-by-step traceability of the autonomous agent's actions (Section 2.D.3)."""

    __tablename__ = "agent_trace_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    evaluation_run_id: Mapped[str] = mapped_column(
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(64), nullable=False)
    proposal_identifier: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    message: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    evaluation_run: Mapped[EvaluationRun] = relationship(back_populates="trace_steps")


class HumanReview(Base):
    """Human-in-the-loop review, notes, confirmation, or override of AI verdicts (Section 2.E.2)."""

    __tablename__ = "human_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    evaluation_run_id: Mapped[str] = mapped_column(
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True
    )
    proposal_evaluation_id: Mapped[str | None] = mapped_column(
        ForeignKey("proposal_evaluations.id", ondelete="SET NULL"), nullable=True
    )
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_name: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    reviewer_role: Mapped[str] = mapped_column(String(32), nullable=False)

    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    override_recommended_proposal_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    evaluation_run: Mapped[EvaluationRun] = relationship(back_populates="human_reviews")


class AuditLog(Base):
    """Immutable audit trail of all platform actions (Section 2.E.2 & 2.F), encrypted at rest."""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_email: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    action_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    details: Mapped[dict | None] = mapped_column(EncryptedJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class ChatMessage(Base):
    """Grounded natural-language Q&A messages per project (Section 2.E.5)."""

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    evaluation_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    citations: Mapped[list | None] = mapped_column(EncryptedJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    project: Mapped[Project] = relationship(back_populates="chat_messages")


class BcvRateSnapshot(Base):
    """Persisted BCV official exchange rate history (Section 2.E.4)."""

    __tablename__ = "bcv_rate_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    usd_to_ves: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    is_manual_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
