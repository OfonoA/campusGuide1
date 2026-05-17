"""add assignment capabilities and ticket area

Revision ID: 0007_add_assignment_capabilities_and_ticket_area
Revises: 0006_add_user_last_active
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_add_assignment_capabilities_and_ticket_area"
down_revision = "0006_add_user_last_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("assignment_areas", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("max_concurrent_load", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("priority_weight", sa.Float(), nullable=False, server_default="1.0"))

    op.add_column("tickets", sa.Column("assignment_area", sa.String(length=100), nullable=True))
    op.add_column("tickets", sa.Column("assignment_area_confidence", sa.Float(), nullable=True))
    op.add_column("tickets", sa.Column("assignment_area_reason", sa.Text(), nullable=True))

    op.execute("UPDATE users SET is_available = 1 WHERE is_available IS NULL")
    op.execute("UPDATE users SET priority_weight = 1.0 WHERE priority_weight IS NULL")

    op.alter_column("users", "is_available", server_default=None)
    op.alter_column("users", "priority_weight", server_default=None)


def downgrade() -> None:
    op.drop_column("tickets", "assignment_area_reason")
    op.drop_column("tickets", "assignment_area_confidence")
    op.drop_column("tickets", "assignment_area")
    op.drop_column("users", "priority_weight")
    op.drop_column("users", "is_available")
    op.drop_column("users", "max_concurrent_load")
    op.drop_column("users", "assignment_areas")
