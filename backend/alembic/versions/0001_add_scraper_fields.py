"""add scraper fields"""

from alembic import op
import sqlalchemy as sa

revision = "0001_add_scraper_fields"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rag_documents",
        sa.Column("source_url", sa.String(), nullable=True),
    )
    op.add_column(
        "rag_documents",
        sa.Column("source_type", sa.String(), nullable=False, server_default="pdf"),
    )
    op.add_column(
        "rag_documents",
        sa.Column("content_hash", sa.String(), nullable=True),
    )
    op.add_column(
        "rag_documents",
        sa.Column("last_scraped_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "rag_documents",
        sa.Column("scrape_status", sa.String(), nullable=True),
    )
    op.add_column(
        "rag_documents",
        sa.Column("http_etag", sa.String(), nullable=True),
    )
    op.add_column(
        "rag_documents",
        sa.Column("http_last_mod", sa.String(), nullable=True),
    )

    op.create_table(
        "watched_urls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("url", sa.String(), unique=True, nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("frequency_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("last_scraped_at", sa.DateTime(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("watched_urls")

    op.drop_column("rag_documents", "http_last_mod")
    op.drop_column("rag_documents", "http_etag")
    op.drop_column("rag_documents", "scrape_status")
    op.drop_column("rag_documents", "last_scraped_at")
    op.drop_column("rag_documents", "content_hash")
    op.drop_column("rag_documents", "source_type")
    op.drop_column("rag_documents", "source_url")
