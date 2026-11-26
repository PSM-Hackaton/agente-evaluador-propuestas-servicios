"""Initial encrypted schema for SQLite & PostgreSQL/Supabase.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-11-26 15:48:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("hashed_password", sa.String(length=512), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email_hash"), "users", ["email_hash"], unique=True)
    op.create_index(op.f("ix_users_role"), "users", ["role"], unique=False)

    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_hash", sa.String(length=64), nullable=False),
        sa.Column("rif", sa.Text(), nullable=True),
        sa.Column("rif_hash", sa.String(length=64), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("representative", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_suppliers_name_hash"), "suppliers", ["name_hash"], unique=False)
    op.create_index(op.f("ix_suppliers_rif_hash"), "suppliers", ["rif_hash"], unique=True)

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("execution_location", sa.Text(), nullable=False),
        sa.Column("reference_budget", sa.Text(), nullable=True),
        sa.Column("reference_currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("document_filename", sa.Text(), nullable=True),
        sa.Column("document_storage_key", sa.String(length=512), nullable=True),
        sa.Column("document_sha256", sa.String(length=64), nullable=True),
        sa.Column("extracted_requirements_text", sa.Text(), nullable=True),
        sa.Column("parsed_requirements", sa.Text(), nullable=True),
        sa.Column("adjudicated_proposal_id", sa.String(length=36), nullable=True),
        sa.Column("adjudication_notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_projects_status"), "projects", ["status"], unique=False)

    op.create_table(
        "proposals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("supplier_id", sa.String(length=36), nullable=True),
        sa.Column("proposal_identifier", sa.Text(), nullable=False),
        sa.Column("proposal_identifier_hash", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("file_extension", sa.String(length=16), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("encrypted_storage_key", sa.String(length=512), nullable=False),
        sa.Column("ingestion_method", sa.String(length=64), nullable=True),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("hidden_text_findings", sa.Text(), nullable=True),
        sa.Column("extracted_structured_data", sa.Text(), nullable=True),
        sa.Column("uploaded_by_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "proposal_identifier_hash", name="uq_project_proposal_hash"),
    )
    op.create_index(op.f("ix_proposals_project_id"), "proposals", ["project_id"], unique=False)
    op.create_index(op.f("ix_proposals_proposal_identifier_hash"), "proposals", ["proposal_identifier_hash"], unique=False)
    op.create_index(op.f("ix_proposals_supplier_id"), "proposals", ["supplier_id"], unique=False)

    op.create_table(
        "evaluation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("triggered_by_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("llm_provider_used", sa.String(length=64), nullable=False),
        sa.Column("bcv_rate_used", sa.Text(), nullable=False),
        sa.Column("bcv_rate_source", sa.String(length=128), nullable=False),
        sa.Column("iva_rate_used", sa.Float(), nullable=False),
        sa.Column("web_search_used", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("recommended_proposal_id", sa.String(length=36), nullable=True),
        sa.Column("recommended_identifier", sa.Text(), nullable=True),
        sa.Column("executive_summary", sa.Text(), nullable=True),
        sa.Column("ranking_identifiers", sa.Text(), nullable=True),
        sa.Column("procesados_log", sa.Text(), nullable=True),
        sa.Column("salida_json_payload", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["triggered_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_evaluation_runs_project_id"), "evaluation_runs", ["project_id"], unique=False)

    op.create_table(
        "supplier_alerts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("supplier_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("evaluation_id", sa.String(length=36), nullable=True),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("reason_code", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("is_resolved", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["evaluation_id"], ["evaluation_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_supplier_alerts_supplier_id"), "supplier_alerts", ["supplier_id"], unique=False)

    op.create_table(
        "proposal_evaluations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=False),
        sa.Column("proposal_id", sa.String(length=36), nullable=False),
        sa.Column("proposal_identifier", sa.Text(), nullable=False),
        sa.Column("supplier_name", sa.Text(), nullable=True),
        sa.Column("supplier_rif", sa.Text(), nullable=True),
        sa.Column("is_valid", sa.Boolean(), nullable=False),
        sa.Column("rank_position", sa.Integer(), nullable=False),
        sa.Column("technical_score", sa.Text(), nullable=False),
        sa.Column("economic_score", sa.Text(), nullable=False),
        sa.Column("overall_score", sa.Text(), nullable=False),
        sa.Column("declared_currency", sa.String(length=8), nullable=False),
        sa.Column("declared_total_original", sa.Text(), nullable=False),
        sa.Column("declared_total_usd", sa.Text(), nullable=False),
        sa.Column("computed_subtotal_usd", sa.Text(), nullable=False),
        sa.Column("shipping_cost_usd", sa.Text(), nullable=False),
        sa.Column("installation_cost_usd", sa.Text(), nullable=False),
        sa.Column("hidden_surcharges_usd", sa.Text(), nullable=False),
        sa.Column("taxes_iva_usd", sa.Text(), nullable=False),
        sa.Column("adjusted_tco_usd", sa.Text(), nullable=False),
        sa.Column("adjusted_tco_ves", sa.Text(), nullable=False),
        sa.Column("arithmetic_valid", sa.Boolean(), nullable=False),
        sa.Column("arithmetic_discrepancy_usd", sa.Text(), nullable=False),
        sa.Column("discard_reasons", sa.Text(), nullable=True),
        sa.Column("discard_verdict_text", sa.Text(), nullable=True),
        sa.Column("recommendation_rationale", sa.Text(), nullable=True),
        sa.Column("tco_breakdown", sa.Text(), nullable=True),
        sa.Column("line_items", sa.Text(), nullable=True),
        sa.Column("fine_print_findings", sa.Text(), nullable=True),
        sa.Column("technical_findings", sa.Text(), nullable=True),
        sa.Column("market_comparison", sa.Text(), nullable=True),
        sa.Column("prompt_injection_detected", sa.Boolean(), nullable=False),
        sa.Column("prompt_injection_evidence", sa.Text(), nullable=True),
        sa.Column("supplier_history_alerts", sa.Text(), nullable=True),
        sa.Column("processed_at_iso", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["evaluation_run_id"], ["evaluation_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_id"], ["proposals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_proposal_evaluations_evaluation_run_id"), "proposal_evaluations", ["evaluation_run_id"], unique=False)
    op.create_index(op.f("ix_proposal_evaluations_proposal_id"), "proposal_evaluations", ["proposal_id"], unique=False)

    op.create_table(
        "agent_trace_steps",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("phase", sa.String(length=64), nullable=False),
        sa.Column("proposal_identifier", sa.Text(), nullable=True),
        sa.Column("tool_name", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["evaluation_run_id"], ["evaluation_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_trace_steps_evaluation_run_id"), "agent_trace_steps", ["evaluation_run_id"], unique=False)

    op.create_table(
        "human_reviews",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=False),
        sa.Column("proposal_evaluation_id", sa.String(length=36), nullable=True),
        sa.Column("reviewer_id", sa.String(length=36), nullable=True),
        sa.Column("reviewer_name", sa.Text(), nullable=False),
        sa.Column("reviewer_role", sa.String(length=32), nullable=False),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("override_recommended_proposal_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["evaluation_run_id"], ["evaluation_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_evaluation_id"], ["proposal_evaluations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_human_reviews_evaluation_run_id"), "human_reviews", ["evaluation_run_id"], unique=False)

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=True),
        sa.Column("actor_email", sa.Text(), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("action_hash", sa.String(length=64), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=64), nullable=True),
        sa.Column("ip_address", sa.Text(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_action_hash"), "audit_logs", ["action_hash"], unique=False)
    op.create_index(op.f("ix_audit_logs_actor_id"), "audit_logs", ["actor_id"], unique=False)
    op.create_index(op.f("ix_audit_logs_created_at"), "audit_logs", ["created_at"], unique=False)
    op.create_index(op.f("ix_audit_logs_resource_id"), "audit_logs", ["resource_id"], unique=False)
    op.create_index(op.f("ix_audit_logs_resource_type"), "audit_logs", ["resource_type"], unique=False)

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_messages_project_id"), "chat_messages", ["project_id"], unique=False)

    op.create_table(
        "bcv_rate_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("usd_to_ves", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=128), nullable=False),
        sa.Column("is_manual_override", sa.Boolean(), nullable=False),
        sa.Column("recorded_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("bcv_rate_snapshots")
    op.drop_index(op.f("ix_chat_messages_project_id"), table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index(op.f("ix_audit_logs_resource_type"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_resource_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_created_at"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_actor_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action_hash"), table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index(op.f("ix_human_reviews_evaluation_run_id"), table_name="human_reviews")
    op.drop_table("human_reviews")
    op.drop_index(op.f("ix_agent_trace_steps_evaluation_run_id"), table_name="agent_trace_steps")
    op.drop_table("agent_trace_steps")
    op.drop_index(op.f("ix_proposal_evaluations_proposal_id"), table_name="proposal_evaluations")
    op.drop_index(op.f("ix_proposal_evaluations_evaluation_run_id"), table_name="proposal_evaluations")
    op.drop_table("proposal_evaluations")
    op.drop_index(op.f("ix_supplier_alerts_supplier_id"), table_name="supplier_alerts")
    op.drop_table("supplier_alerts")
    op.drop_index(op.f("ix_evaluation_runs_project_id"), table_name="evaluation_runs")
    op.drop_table("evaluation_runs")
    op.drop_index(op.f("ix_proposals_supplier_id"), table_name="proposals")
    op.drop_index(op.f("ix_proposals_proposal_identifier_hash"), table_name="proposals")
    op.drop_index(op.f("ix_proposals_project_id"), table_name="proposals")
    op.drop_table("proposals")
    op.drop_index(op.f("ix_projects_status"), table_name="projects")
    op.drop_table("projects")
    op.drop_index(op.f("ix_suppliers_rif_hash"), table_name="suppliers")
    op.drop_index(op.f("ix_suppliers_name_hash"), table_name="suppliers")
    op.drop_table("suppliers")
    op.drop_index(op.f("ix_users_role"), table_name="users")
    op.drop_index(op.f("ix_users_email_hash"), table_name="users")
    op.drop_table("users")
