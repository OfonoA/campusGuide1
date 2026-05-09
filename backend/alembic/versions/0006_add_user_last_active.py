"""add user last active timestamp

Revision ID: 0006_add_user_last_active
Revises: 0005_add_assignment_mode_and_review_flags
Create Date: 2026-05-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_add_user_last_active"
down_revision = "0005_add_assignment_mode_and_review_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_active_at")
