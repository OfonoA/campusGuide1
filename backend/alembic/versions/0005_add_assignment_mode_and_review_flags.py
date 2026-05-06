"""add assignment mode and review flags

Revision ID: 0005_add_assignment_mode_and_review_flags
Revises: 0004_add_ticket_recommendation_fields
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_add_assignment_mode_and_review_flags"
down_revision = "0004_add_ticket_recommendation_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("auto_assigned", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "tickets",
        sa.Column("assignment_reviewed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=100), nullable=False, unique=True),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_column("tickets", "assignment_reviewed")
    op.drop_column("tickets", "auto_assigned")
