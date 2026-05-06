from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from typing import List
from datetime import datetime
import os
from uuid import uuid4

from database.database import get_db, SessionLocal
from database.orm_models import (
    AppSetting,
    Ticket,
    User,
    InPersonAssistance,
    RLFeedback,
    RAGDocument,
    DocumentChunk,
    TicketUpdate,
    Conversation,
    TicketMessage,
    RefreshToken,
    WatchedURL,
)
from app.auth import get_current_user
from app.assignment import (
    ASSIGNMENT_MODE_AUTO_REVIEW,
    ASSIGNMENT_MODE_RECOMMEND,
    ASSIGNMENT_MODE_AUTO_ASSIGN,
    apply_ticket_recommendation,
    get_assignment_mode,
    maybe_auto_assign_recommended_ticket,
    set_assignment_mode,
)
from app.schemas import (
    AdminTicket,
    AssignmentModeResponse,
    AssignmentModeUpdateRequest,
    AdminTicketModerationRequest,
    IngestionStatusItem,
    ARActivityItem,
    AdminDocumentItem,
    AdminUserItem,
    RoleUpdateRequest,
    AdminUserCreateRequest,
    AdminUserDeleteRequest,
    ScrapeStatusItem,
    ScrapeUrlRequest,
    CrawlRequest,
    WatchedURLCreate,
    WatchedURLOut,
)
from passlib.hash import bcrypt
from app.bm25_store import reset_bm25_corpus
from app.vector_store import vector_store_manager
from app.scraper.ingest_web import WebIngestionService
from app.scraper.crawler import MUSTCrawler
from app.scraper.scheduler import HIGH_CHURN_URLS, MEDIUM_CHURN_URLS, LOW_CHURN_URLS
import shutil
router = APIRouter()


def _crawl_task(seed_url: str, max_pages: int) -> None:
    with SessionLocal() as session:
        crawler = MUSTCrawler(session, max_pages=max_pages, seed_urls=[seed_url])
        html_urls, pdf_urls = crawler.crawl()
        service = WebIngestionService(session)
        if html_urls or pdf_urls:
            service.ingest_batch(html_urls + pdf_urls)


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
    """Return an overview of all tickets with student info and current assigned AR staff."""
    require_admin(current_user)

    tickets = db.query(Ticket).order_by(Ticket.created_at.desc()).all()
    assignment_mode = get_assignment_mode(db)
    user_ids = {
        user_id
        for ticket in tickets
        for user_id in (ticket.student_id, ticket.assigned_to, ticket.recommended_officer_id)
        if user_id is not None
    }
    users_by_id = {}
    if user_ids:
        users_by_id = {
            user.id: user
            for user in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    results = []
    for ticket in tickets:
        if (
            ticket.recommended_officer_id is None
            and not ticket.false_generated
            and not ticket.exclude_from_ingestion
            and ticket.status in {"open", "assigned"}
        ):
            try:
                apply_ticket_recommendation(db, ticket)
            except Exception as exc:
                print(f"Failed to backfill recommendation for ticket {ticket.id}: {exc}")
        if (
            assignment_mode in {ASSIGNMENT_MODE_AUTO_REVIEW, ASSIGNMENT_MODE_AUTO_ASSIGN}
            and ticket.status == "open"
            and ticket.assigned_to is None
            and not ticket.false_generated
            and not ticket.exclude_from_ingestion
        ):
            try:
                maybe_auto_assign_recommended_ticket(db, ticket)
            except Exception as exc:
                print(f"Failed to auto-assign ticket {ticket.id} during admin sync: {exc}")
        student = users_by_id.get(ticket.student_id)
        ar_user = users_by_id.get(ticket.assigned_to) if ticket.assigned_to is not None else None
        recommended_user = users_by_id.get(ticket.recommended_officer_id) if ticket.recommended_officer_id is not None else None
        if recommended_user is None and ticket.recommended_officer_id is not None:
            recommended_user = db.query(User).filter(User.id == ticket.recommended_officer_id).first()
            if recommended_user is not None:
                users_by_id[recommended_user.id] = recommended_user
        results.append(
            AdminTicket(
                ticket_id=ticket.id,
                reference_code=ticket.reference_code,
                student_id=ticket.student_id,
                student_username=getattr(student, "username", None),
                status=ticket.status,
                false_generated=bool(ticket.false_generated),
                exclude_from_ingestion=bool(ticket.exclude_from_ingestion),
                recommended_officer_id=ticket.recommended_officer_id,
                recommended_officer_username=getattr(recommended_user, "username", None),
                recommendation_score=ticket.recommendation_score,
                recommendation_reason=ticket.recommendation_reason,
                recommendation_created_at=ticket.recommendation_created_at,
                auto_assigned=bool(ticket.auto_assigned),
                assignment_reviewed=bool(ticket.assignment_reviewed),
                ar_assigned_id=ticket.assigned_to,
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
            ARActivityItem(
                ar_id=ar_id,
                ar_username=username,
                tickets_resolved=tickets_resolved,
                last_activity=last_activity,
            )
        )

    return results


@router.get("/assignment-mode", response_model=AssignmentModeResponse)
def read_assignment_mode(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    return AssignmentModeResponse(mode=get_assignment_mode(db))


@router.put("/assignment-mode", response_model=AssignmentModeResponse)
def update_assignment_mode(
    payload: AssignmentModeUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    try:
        mode = set_assignment_mode(db, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if mode in {ASSIGNMENT_MODE_AUTO_REVIEW, ASSIGNMENT_MODE_AUTO_ASSIGN}:
        open_tickets = (
            db.query(Ticket)
            .filter(
                Ticket.status == "open",
                Ticket.assigned_to.is_(None),
                Ticket.false_generated.is_(False),
                Ticket.exclude_from_ingestion.is_(False),
            )
            .all()
        )
        for ticket in open_tickets:
            try:
                if ticket.recommended_officer_id is None:
                    apply_ticket_recommendation(db, ticket)
                maybe_auto_assign_recommended_ticket(db, ticket)
            except Exception as exc:
                print(f"Failed to apply auto-assignment for ticket {ticket.id} after mode switch: {exc}")

    return AssignmentModeResponse(mode=mode)


@router.post("/tickets/{ticket_id}/assign")
def assign_ticket(
    ticket_id: int,
    officer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign or reassign a ticket to an AR officer."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status not in {"open", "assigned"}:
        raise HTTPException(status_code=400, detail=f"Ticket must be 'open' or 'assigned' to assign (current: '{ticket.status}')")

    officer = db.query(User).filter(User.id == officer_id, User.role == "ar_staff").first()
    if not officer:
        raise HTTPException(status_code=404, detail="AR officer not found")

    previous_status = ticket.status
    previous_officer = ticket.assigned_to
    ticket.assigned_to = officer.id
    ticket.status = "assigned"
    ticket.assignment_reviewed = True
    if ticket.recommended_officer_id != officer.id:
        ticket.auto_assigned = False
    db.add(ticket)
    db.commit()

    note = f"Assigned to officer {officer.id}"
    if previous_officer and previous_officer != officer.id:
        note = f"Reassigned from officer {previous_officer} to officer {officer.id}"
    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=note,
            status_change=f"{previous_status}->assigned",
        )
    )
    db.commit()

    return {"message": "Ticket assigned", "ticket_id": ticket.id, "assigned_to": officer.id}


@router.post("/tickets/{ticket_id}/accept-recommendation")
def accept_recommendation(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign an open ticket to its recommended AR officer."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != "open":
        raise HTTPException(status_code=400, detail=f"Ticket must be 'open' to accept recommendation (current: '{ticket.status}')")

    if not ticket.recommended_officer_id:
        raise HTTPException(status_code=400, detail="No recommendation is available for this ticket")

    officer = db.query(User).filter(User.id == ticket.recommended_officer_id, User.role == "ar_staff").first()
    if not officer:
        raise HTTPException(status_code=404, detail="Recommended AR officer not found")

    ticket.assigned_to = officer.id
    ticket.status = "assigned"
    ticket.auto_assigned = False
    ticket.assignment_reviewed = True
    db.add(ticket)
    db.commit()

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=f"Accepted recommendation for officer {officer.id}",
            status_change="open->assigned_recommended",
        )
    )
    db.commit()

    return {"message": "Recommendation accepted", "ticket_id": ticket.id, "assigned_to": officer.id}


@router.post("/tickets/{ticket_id}/mark-assignment-reviewed")
def mark_assignment_reviewed(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark an auto-assigned ticket as reviewed by admin."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.auto_assigned:
        raise HTTPException(status_code=400, detail="Ticket is not auto-assigned")
    if ticket.assignment_reviewed:
        return {"message": "Assignment already reviewed", "ticket_id": ticket.id}

    ticket.assignment_reviewed = True
    db.add(ticket)
    db.commit()

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note="Admin reviewed automated assignment",
            status_change="assigned_auto_review->assigned_reviewed",
        )
    )
    db.commit()

    return {"message": "Assignment marked as reviewed", "ticket_id": ticket.id}


@router.post("/tickets/{ticket_id}/resolve-false")
def resolve_false_ticket(
    ticket_id: int,
    payload: AdminTicketModerationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve an unintended/false ticket and block it from reinforcement ingestion."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    previous_status = ticket.status
    ticket.false_generated = True
    ticket.exclude_from_ingestion = True
    ticket.resolved_at = datetime.utcnow()
    if ticket.status != "closed":
        ticket.status = "resolved"
    ticket.assigned_to = None
    db.add(ticket)

    note = (payload.note or "").strip() or "Admin marked ticket as falsely/unintentionally generated"
    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=note,
            status_change=f"{previous_status}->{ticket.status}_false_generated",
        )
    )

    try:
        if ticket.conversation:
            ticket.conversation.ended_at = datetime.utcnow()
    except Exception:
        pass

    db.commit()
    db.refresh(ticket)

    return {
        "message": "Ticket resolved as false and excluded from ingestion",
        "ticket_id": ticket.id,
        "reference_code": ticket.reference_code,
        "status": ticket.status,
        "false_generated": bool(ticket.false_generated),
        "exclude_from_ingestion": bool(ticket.exclude_from_ingestion),
    }


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
        from scripts.ingest_documents import extract_content_with_table_handling
        from app.utils import chunk_content_blocks
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import ingestion helpers: {e}")

    try:
        blocks = extract_content_with_table_handling(stored_path)
        chunks = chunk_content_blocks(blocks)
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

    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    rows = (
        db.query(
            RAGDocument,
            func.count(DocumentChunk.id).label("chunk_count"),
        )
        .outerjoin(DocumentChunk, DocumentChunk.document_id == RAGDocument.id)
        .group_by(RAGDocument.id)
        .order_by(RAGDocument.created_at.desc())
        .all()
    )

    results: List[AdminDocumentItem] = []
    for doc, chunk_count in rows:
        file_exists = False
        if doc.source_reference:
            file_exists = os.path.exists(os.path.join(storage_dir, doc.source_reference))

        results.append(
            AdminDocumentItem(
                id=doc.id,
                source=doc.source,
                title=doc.title,
                source_reference=doc.source_reference,
                source_type=doc.source_type,
                chunk_count=int(chunk_count or 0),
                file_exists=file_exists,
                created_at=doc.created_at,
            )
        )

    return results


@router.post("/scrape/url")
def scrape_single_url(
    payload: ScrapeUrlRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    require_admin(current_user)
    service = WebIngestionService(db)
    result = service.ingest_url(payload.url, force=payload.force)
    return {
        "url": result.url,
        "status": result.status,
        "chunks_added": result.chunks_added,
        "chunks_removed": result.chunks_removed,
        "error": result.error,
    }


@router.post("/scrape/crawl")
def trigger_crawl(
    payload: CrawlRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    require_admin(current_user)
    task_id = str(uuid4())
    background_tasks.add_task(_crawl_task, payload.seed_url, payload.max_pages)
    return {"status": "crawl_started", "task_id": task_id}


@router.get("/scrape/status", response_model=List[ScrapeStatusItem])
def scrape_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    docs = (
        db.query(RAGDocument)
        .filter(RAGDocument.last_scraped_at.is_not(None))
        .order_by(RAGDocument.last_scraped_at.desc())
        .limit(100)
        .all()
    )
    return [ScrapeStatusItem.from_orm(doc) for doc in docs]


@router.post("/watched-urls", response_model=WatchedURLOut)
def create_watched_url(
    payload: WatchedURLCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    existing = db.query(WatchedURL).filter(WatchedURL.url == payload.url).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="URL already watched")
        existing.is_active = True
        existing.label = payload.label
        existing.frequency_hours = payload.frequency_hours
        existing.created_by = current_user.username
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return WatchedURLOut.from_orm(existing)

    watch = WatchedURL(
        url=payload.url,
        label=payload.label,
        frequency_hours=payload.frequency_hours,
        created_by=current_user.username,
    )
    db.add(watch)
    db.commit()
    db.refresh(watch)
    return WatchedURLOut.from_orm(watch)


@router.get("/watched-urls", response_model=List[WatchedURLOut])
def list_watched_urls(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    watches = db.query(WatchedURL).filter(WatchedURL.is_active.is_(True)).all()
    return [WatchedURLOut.from_orm(w) for w in watches]


@router.delete("/watched-urls/{watch_id}")
def remove_watched_url(
    watch_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    watch = db.query(WatchedURL).filter(WatchedURL.id == watch_id).first()
    if not watch:
        raise HTTPException(status_code=404, detail="Watched URL not found")
    watch.is_active = False
    db.add(watch)
    db.commit()
    return {"message": "Watched URL disabled", "id": watch.id}


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


@router.post("/users", response_model=AdminUserItem)
def create_user(
    payload: AdminUserCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin-only: create a user with an explicit role."""
    require_admin(current_user)

    if payload.role not in {"student", "ar_staff", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")

    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed = bcrypt.hash(payload.password)
    user = User(username=payload.username, hashed_password=hashed, role=payload.role)
    db.add(user)
    db.commit()
    db.refresh(user)

    return AdminUserItem.from_orm(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    payload: AdminUserDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin-only: delete a user after confirming the acting admin's password."""
    require_admin(current_user)

    if not bcrypt.verify(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect admin password")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    has_related_records = any(
        [
            db.query(Conversation).filter(Conversation.user_id == user_id).first(),
            db.query(Ticket).filter((Ticket.student_id == user_id) | (Ticket.assigned_to == user_id)).first(),
            db.query(TicketMessage).filter(TicketMessage.sender_id == user_id).first(),
            db.query(TicketUpdate).filter(TicketUpdate.updated_by == user_id).first(),
            db.query(InPersonAssistance).filter(InPersonAssistance.ar_staff_id == user_id).first(),
            db.query(RefreshToken).filter(RefreshToken.user_id == user_id).first(),
        ]
    )

    if has_related_records:
        raise HTTPException(
            status_code=400,
            detail="This user has related records and cannot be deleted safely",
        )

    db.delete(user)
    db.commit()

    return {"message": "User deleted"}


def _rebuild_faiss_from_db(db: Session):
    """Rebuild FAISS index from remaining DocumentChunk rows."""
    index_path = vector_store_manager.index_path
    if os.path.exists(index_path):
        try:
            shutil.rmtree(index_path)
        except Exception:
            pass

    # Reset in-memory store
    vector_store_manager.vector_store = None
    reset_bm25_corpus()

    chunks = db.query(DocumentChunk).order_by(DocumentChunk.id).all()
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk.chunk_text,
            metadata={"document_id": chunk.document_id}
        )
        if embedding_id:
            chunk.embedding_id = embedding_id

    db.commit()
