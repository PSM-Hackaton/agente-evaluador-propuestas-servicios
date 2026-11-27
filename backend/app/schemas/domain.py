"""Proposal, Supplier, Evaluation, Review, Chat, and Audit schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProposalOut(BaseModel):
    id: str
    project_id: str
    supplier_id: str | None
    proposal_identifier: str
    original_filename: str
    file_extension: str
    mime_type: str
    file_size_bytes: int
    file_sha256: str
    ingestion_method: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProposalDetailOut(ProposalOut):
    extracted_text_preview: str | None = None
    has_hidden_text_findings: bool = False


class SupplierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    rif: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=255)
    representative: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = None
    rif: str | None = None
    location: str | None = None
    representative: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class SupplierAlertOut(BaseModel):
    id: str
    supplier_id: str
    project_id: str | None
    evaluation_id: str | None
    severity: str
    reason_code: str
    summary: str
    is_resolved: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SupplierOut(BaseModel):
    id: str
    name: str
    rif: str | None
    location: str | None
    representative: str | None
    phone: str | None
    email: str | None
    notes: str | None
    alerts_count: int = 0
    proposals_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class EvaluationTriggerRequest(BaseModel):
    enable_web_search: bool = True
    bcv_rate_override: float | None = Field(default=None, gt=0)
    iva_rate: float = Field(default=0.16, ge=0, le=0.5)
    run_in_background: bool = False


class ProposalEvaluationOut(BaseModel):
    id: str
    proposal_id: str
    proposal_identifier: str
    supplier_name: str | None
    supplier_rif: str | None
    is_valid: bool
    rank_position: int
    technical_score: float
    economic_score: float
    overall_score: float
    declared_currency: str
    declared_total_original: float
    declared_total_usd: float
    computed_subtotal_usd: float
    shipping_cost_usd: float
    installation_cost_usd: float
    hidden_surcharges_usd: float
    taxes_iva_usd: float
    adjusted_tco_usd: float
    adjusted_tco_ves: float
    arithmetic_valid: bool
    arithmetic_discrepancy_usd: float
    discard_reasons: list[dict[str, Any]] | None
    discard_verdict_text: str | None
    recommendation_rationale: str | None
    tco_breakdown: dict[str, Any] | None
    line_items: list[dict[str, Any]] | None
    fine_print_findings: list[str] | None
    technical_findings: list[str] | None
    market_comparison: list[dict[str, Any]] | None
    prompt_injection_detected: bool
    prompt_injection_evidence: list[dict[str, Any]] | None
    supplier_history_alerts: list[dict[str, Any]] | None = None
    processed_at_iso: str | None

    model_config = {"from_attributes": True}


class TraceStepOut(BaseModel):
    id: str
    step_number: int
    phase: str
    proposal_identifier: str | None
    tool_name: str | None
    status: str
    message: str
    metadata_json: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class HumanReviewCreate(BaseModel):
    proposal_evaluation_id: str | None = None
    decision: str = Field(pattern="^(confirmed|observed|overridden|approved|rejected)$")
    notes: str = Field(min_length=3)
    override_recommended_proposal_id: str | None = None


class HumanReviewOut(BaseModel):
    id: str
    evaluation_run_id: str
    proposal_evaluation_id: str | None
    reviewer_id: str | None
    reviewer_name: str
    reviewer_role: str
    decision: str
    notes: str
    override_recommended_proposal_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EvaluationRunSummaryOut(BaseModel):
    id: str
    project_id: str
    status: str
    llm_provider_used: str
    bcv_rate_used: float
    bcv_rate_source: str
    iva_rate_used: float
    web_search_used: bool
    started_at: datetime
    finished_at: datetime | None
    duration_seconds: float | None
    recommended_proposal_id: str | None
    recommended_identifier: str | None
    executive_summary: str | None
    ranking_identifiers: list[str] | None
    error_message: str | None

    model_config = {"from_attributes": True}


class EvaluationRunDetailOut(EvaluationRunSummaryOut):
    proposal_evaluations: list[ProposalEvaluationOut] = []
    trace_steps: list[TraceStepOut] = []
    human_reviews: list[HumanReviewOut] = []
    salida_json_payload: dict[str, Any] | None = None


class ChatQuestionRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    evaluation_run_id: str | None = None


class ChatMessageOut(BaseModel):
    id: str
    project_id: str
    evaluation_run_id: str | None
    role: str
    content: str
    citations: list[dict[str, Any]] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogOut(BaseModel):
    id: str
    actor_id: str | None
    actor_email: str
    actor_role: str
    action: str
    resource_type: str
    resource_id: str | None
    ip_address: str | None
    details: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BcvOverrideRequest(BaseModel):
    usd_to_ves: float = Field(gt=0)
    note: str | None = None


class TcoPreviewRequest(BaseModel):
    declared_total: float = Field(ge=0)
    currency: str = Field(default="USD", pattern="^(USD|VES)$")
    shipping_included_in_total: bool = True
    shipping_cost: float = 0.0
    installation_included_in_total: bool = True
    installation_cost: float = 0.0
    hidden_surcharge_flat: float = 0.0
    hidden_surcharge_pct: float = 0.0
    iva_applies: bool = False
    iva_included: bool = True
    iva_rate: float = 0.16
    payment_surcharge_pct: float = 0.0


class BatchRunRequest(BaseModel):
    lote_dir: str
    output_path: str | None = None
    enable_web_search: bool = True
    bcv_rate_override: float | None = None


class MarketBenchmarkRequest(BaseModel):
    item_description: str = Field(min_length=3, max_length=300)
    proposed_unit_price_usd: float = Field(ge=0.0, le=1_000_000.0)
    enable_web: bool = True


class MarketBenchmarkBatchRequest(BaseModel):
    items: list[MarketBenchmarkRequest] = Field(min_length=1, max_length=20)
    enable_web: bool = True
