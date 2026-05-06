"""add ticket recommendation fields

Revision ID: 0004_add_ticket_recommendation_fields
Revises: 0003_add_ticket_moderation_flags
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_add_ticket_recommendation_fields"
down_revision = "0003_add_ticket_moderation_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("recommended_officer_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("recommendation_score", sa.Float(), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("recommendation_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("recommendation_created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "recommendation_created_at")
    op.drop_column("tickets", "recommendation_reason")
    op.drop_column("tickets", "recommendation_score")
    op.drop_column("tickets", "recommended_officer_id")
