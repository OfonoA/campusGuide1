from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, and_
from typing import List
import os

from database.database import get_db
from database.orm_models import Ticket, User, InPersonAssistance, RLFeedback, RAGDocument, DocumentChunk
from app.auth import get_current_user
from app.schemas import AdminTicket, IngestionStatusItem, ARActivityItem, AdminDocumentItem, AdminUserItem, RoleUpdateRequest
from app.vector_store import vector_store_manager
import shutil
from app.schemas import AdminDocumentItem

router = APIRouter()


def require_admin(user: User):
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def require_admin_or_ar(user: User):
    if not user or user.role not in {"admin", "ar_staff"}:
        raise HTTPException(status_code=403, detail="Admin or AR staff required")
    return user


@router.get("/tickets", response_model=List[AdminTicket])
def tickets_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return an overview of all tickets with student info and (if any) assigned AR staff.

    Uses a subquery to fetch the latest `InPersonAssistance` per ticket to determine an assigned AR.
    """
    require_admin(current_user)

    # Subquery to get the latest in_person_assistance id per ticket
    latest_subq = (
        db.query(InPersonAssistance.ticket_id.label("ticket_id"), func.max(InPersonAssistance.id).label("max_id"))
        .group_by(InPersonAssistance.ticket_id)
        .subquery()
    )

    LastAssist = aliased(InPersonAssistance, name="last_assist")
    Student = aliased(User, name="student_user")
    ARUser = aliased(User, name="ar_user")

    # Join tickets -> student, left join to latest in-person assist and that assist's AR user
    q = (
        db.query(Ticket, Student, ARUser, LastAssist)
        .outerjoin(Student, Ticket.student)
        .outerjoin(latest_subq, latest_subq.c.ticket_id == Ticket.id)
        .outerjoin(LastAssist, and_(LastAssist.ticket_id == Ticket.id, LastAssist.id == latest_subq.c.max_id))
        .outerjoin(ARUser, LastAssist.ar_staff_id == ARUser.id)
        .order_by(Ticket.created_at.desc())
    )

    results = []
    for ticket, student, ar_user, last_assist in q.all():
        results.append(
            AdminTicket(
                ticket_id=ticket.id,
                reference_code=ticket.reference_code,
                student_id=getattr(student, "id", None),
                student_username=getattr(student, "username", None),
                status=ticket.status,
                ar_assigned_id=getattr(ar_user, "id", None),
                ar_assigned_username=getattr(ar_user, "username", None),
                created_at=ticket.created_at,
                resolved_at=ticket.resolved_at,
            )
        )

    return results


@router.get("/ingestion-status", response_model=List[IngestionStatusItem])
def ingestion_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List RLFeedback records and ingestion flags for auditing the RAG ingestion pipeline."""
    require_admin(current_user)

    feedbacks = db.query(RLFeedback).order_by(RLFeedback.created_at.desc()).all()
    items = []
    for fb in feedbacks:
        snippet = (fb.validated_answer[:200] + "...") if fb.validated_answer and len(fb.validated_answer) > 200 else fb.validated_answer
        items.append(
            IngestionStatusItem(
                id=fb.id,
                ticket_id=fb.ticket_id,
                validated_answer_snippet=snippet,
                ingested=bool(fb.ingested),
                created_at=fb.created_at,
            )
        )

    return items


@router.get("/ar-activity", response_model=List[ARActivityItem])
def ar_activity(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return per-AR staff activity: tickets resolved count and last activity timestamp.

    We aggregate `InPersonAssistance` records grouped by `ar_staff_id` for efficiency.
    """
    require_admin(current_user)

    # Aggregate counts and last activity per AR staff
    agg = (
        db.query(
            InPersonAssistance.ar_staff_id.label("ar_id"),
            func.count(InPersonAssistance.id).label("tickets_resolved"),
            func.max(InPersonAssistance.created_at).label("last_activity"),
        )
        .group_by(InPersonAssistance.ar_staff_id)
        .subquery()
    )

    ARUser = aliased(User)

    q = db.query(agg.c.ar_id, ARUser.username, agg.c.tickets_resolved, agg.c.last_activity).outerjoin(ARUser, ARUser.id == agg.c.ar_id)

    results = []
    for ar_id, username, tickets_resolved, last_activity in q.all():
        results.append(
            ARActivityItem(ar_id=ar_id, ar_username=username, tickets_resolved=tickets_resolved, last_activity=last_activity)
        )

    return results


@router.post("/documents/upload")
def upload_policy_document(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    file: UploadFile = File(...)
):
    """Upload a PDF to disk, then ingest immediately into RAG."""
    require_admin_or_ar(current_user)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    os.makedirs(storage_dir, exist_ok=True)

    original_filename = file.filename
    base, ext = os.path.splitext(original_filename)
    stored_filename = original_filename
    version = 1
    file_existed = False
    while os.path.exists(os.path.join(storage_dir, stored_filename)):
        file_existed = True
        version += 1
        stored_filename = f"{base}__v{version}{ext}"

    stored_path = os.path.join(storage_dir, stored_filename)
    with open(stored_path, "wb") as f:
        f.write(file.file.read())

    # Ingest the new document into RAG
    try:
        from scripts.ingest_documents import extract_content_with_table_handling, chunk_documents
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import ingestion helpers: {e}")

    try:
        blocks = extract_content_with_table_handling(stored_path)
        chunks = chunk_documents(blocks)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract/chunk PDF: {e}")

    # Create a RAG document record
    rag_doc = RAGDocument(
        source="policy",
        title=stored_filename,
        source_reference=stored_filename
    )
    db.add(rag_doc)
    db.commit()
    db.refresh(rag_doc)

    # Add to vector store + persist chunks
    chunks_created = 0
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk,
            metadata={"source": "policy", "filename": stored_filename}
        )
        if embedding_id:
            db.add(DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id))
            chunks_created += 1

    db.commit()

    return {
        "message": "Uploaded and ingested",
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "file_existed": file_existed,
        "rag_document_id": rag_doc.id,
        "chunks_created": chunks_created,
    }


@router.get("/documents", response_model=List[AdminDocumentItem])
def list_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List RAG document metadata."""
    require_admin_or_ar(current_user)

    docs = db.query(RAGDocument).order_by(RAGDocument.created_at.desc()).all()
    return [AdminDocumentItem.from_orm(d) for d in docs]


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a RAG document and its chunks. Removes file if it exists on disk."""
    require_admin_or_ar(current_user)

    doc = db.query(RAGDocument).filter(RAGDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove chunks
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()

    # Remove file from disk if present
    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    if doc.source_reference:
        file_path = os.path.join(storage_dir, doc.source_reference)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass

    db.delete(doc)
    db.commit()

    # Rebuild FAISS index from remaining chunks to remove deleted content
    _rebuild_faiss_from_db(db)

    return {"message": "Document deleted and FAISS index rebuilt"}


@router.get("/users", response_model=List[AdminUserItem])
def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all users with roles."""
    require_admin(current_user)
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [AdminUserItem.from_orm(u) for u in users]


@router.put("/users/{user_id}/role", response_model=AdminUserItem)
def update_user_role(
    user_id: int,
    payload: RoleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a user's role. Allowed roles: student, ar_staff, admin."""
    require_admin(current_user)

    if payload.role not in {"student", "ar_staff", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = payload.role
    db.add(user)
    db.commit()
    db.refresh(user)

    return AdminUserItem.from_orm(user)


def _rebuild_faiss_from_db(db: Session):
    """Rebuild FAISS index from remaining DocumentChunk rows."""
    index_path = "faiss_index"
    if os.path.exists(index_path):
        try:
            shutil.rmtree(index_path)
        except Exception:
            pass

    # Reset in-memory store
    vector_store_manager.vector_store = None

    chunks = db.query(DocumentChunk).order_by(DocumentChunk.id).all()
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk.chunk_text,
            metadata={"document_id": chunk.document_id}
        )
        if embedding_id:
            chunk.embedding_id = embedding_id

    db.commit()
