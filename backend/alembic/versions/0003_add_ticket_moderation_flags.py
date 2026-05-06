"""add ticket moderation flags

Revision ID: 0003_add_ticket_moderation_flags
Revises: 0002_add_message_attachments
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_add_ticket_moderation_flags"
down_revision = "0002_add_message_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("false_generated", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "tickets",
        sa.Column("exclude_from_ingestion", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("tickets", "exclude_from_ingestion")
    op.drop_column("tickets", "false_generated")
