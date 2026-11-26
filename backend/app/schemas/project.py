"""Project and workflow schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import ProjectStatus


class ProjectCreate(BaseModel):
    name: str = Field(min_length=3, max_length=255)
    description: str | None = None
    execution_location: str = Field(default="La Hoyada, Caracas", max_length=255)
    reference_budget: float | None = Field(default=None, ge=0)
    reference_currency: str = Field(default="USD", pattern="^(USD|VES)$")


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = None
    execution_location: str | None = None
    reference_budget: float | None = Field(default=None, ge=0)
    reference_currency: str | None = Field(default=None, pattern="^(USD|VES)$")


class ProjectStatusTransition(BaseModel):
    target_status: ProjectStatus
    adjudicated_proposal_id: str | None = None
    notes: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None
    execution_location: str
    reference_budget: float | None
    reference_currency: str
    status: str
    document_filename: str | None
    document_sha256: str | None
    adjudicated_proposal_id: str | None
    adjudication_notes: str | None
    proposals_count: int = 0
    evaluations_count: int = 0
    latest_evaluation_id: str | None = None
    has_requirements_text: bool = False
    created_by_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
