import io

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.admin import routes
from database.database import Base
from database.orm_models import DocumentChunk, RAGDocument, User
from scripts import ingest_documents
import app.utils as app_utils


def _build_session():
    engine = create_engine("sqlite:///:memory:")
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestingSessionLocal()


def _storage_dir_patch(monkeypatch, tmp_path):
    original_abspath = routes.os.path.abspath

    def _fake_abspath(path):
        if str(path).endswith("university_documents"):
            return str(tmp_path)
        return original_abspath(path)

    monkeypatch.setattr(routes.os.path, "abspath", _fake_abspath)


def test_admin_upload_persists_document_and_chunks(monkeypatch, tmp_path):
    db = _build_session()
    admin = User(username="admin_upload_ok", hashed_password="x", role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    _storage_dir_patch(monkeypatch, tmp_path)
    monkeypatch.setattr(
        ingest_documents,
        "extract_content_with_table_handling",
        lambda path: [{"type": "text", "content": "Official handbook content."}],
    )
    monkeypatch.setattr(
        app_utils,
        "chunk_content_blocks",
        lambda blocks: ["chunk one", "chunk two"],
    )

    captured_metadata = []

    def _fake_add_text(text, metadata=None):
        captured_metadata.append((text, metadata or {}))
        return f"embed-{len(captured_metadata)}"

    monkeypatch.setattr(routes.vector_store_manager, "add_text", _fake_add_text)

    upload = UploadFile(filename="policy.pdf", file=io.BytesIO(b"%PDF-1.4 test"))

    result = routes.upload_policy_document(current_user=admin, db=db, file=upload)

    assert result["chunks_created"] == 2
    assert db.query(RAGDocument).count() == 1
    assert db.query(DocumentChunk).count() == 2
    assert (tmp_path / "policy.pdf").exists()
    assert all(meta["filename"] == "policy.pdf" for _, meta in captured_metadata)
    assert all(meta["document_id"] for _, meta in captured_metadata)


def test_admin_upload_fails_cleanly_when_indexing_fails(monkeypatch, tmp_path):
    db = _build_session()
    admin = User(username="admin_upload_fail", hashed_password="x", role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    _storage_dir_patch(monkeypatch, tmp_path)
    monkeypatch.setattr(
        ingest_documents,
        "extract_content_with_table_handling",
        lambda path: [{"type": "text", "content": "Official handbook content."}],
    )
    monkeypatch.setattr(
        app_utils,
        "chunk_content_blocks",
        lambda blocks: ["chunk one"],
    )
    monkeypatch.setattr(routes.vector_store_manager, "add_text", lambda text, metadata=None: "")
    monkeypatch.setattr(routes.vector_store_manager, "remove_by_ids", lambda ids: len(ids))

    upload = UploadFile(filename="policy.pdf", file=io.BytesIO(b"%PDF-1.4 test"))

    with pytest.raises(HTTPException) as exc_info:
        routes.upload_policy_document(current_user=admin, db=db, file=upload)

    assert exc_info.value.status_code == 500
    assert db.query(RAGDocument).count() == 0
    assert db.query(DocumentChunk).count() == 0
    assert not (tmp_path / "policy.pdf").exists()
