"""Add invitation_codes table for public signup and invitation onboarding.

Revision ID: 0002_invitation_codes
Revises: 0001_initial_schema
Create Date: 2026-11-27 19:25:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_invitation_codes"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invitation_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("code_prefix", sa.String(length=16), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("email_hash", sa.String(length=64), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("uses_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("max_uses >= 1", name="ck_invitation_codes_max_uses_positive"),
        sa.CheckConstraint("uses_count >= 0", name="ck_invitation_codes_uses_count_nonneg"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_invitation_codes_code_hash"), "invitation_codes", ["code_hash"], unique=True)
    op.create_index(op.f("ix_invitation_codes_role"), "invitation_codes", ["role"], unique=False)
    op.create_index(op.f("ix_invitation_codes_email_hash"), "invitation_codes", ["email_hash"], unique=False)
    op.create_index(
        op.f("ix_invitation_codes_created_by_id"), "invitation_codes", ["created_by_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_invitation_codes_created_by_id"), table_name="invitation_codes")
    op.drop_index(op.f("ix_invitation_codes_email_hash"), table_name="invitation_codes")
    op.drop_index(op.f("ix_invitation_codes_role"), table_name="invitation_codes")
    op.drop_index(op.f("ix_invitation_codes_code_hash"), table_name="invitation_codes")
    op.drop_table("invitation_codes")
