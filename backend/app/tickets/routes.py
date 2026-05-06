from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from database.database import get_db
from database.orm_models import Ticket, TicketMessage, Conversation, Message, TicketUpdate, MessageAttachment
from app.auth import get_current_user
from app.schemas import AttachmentOut, TicketMessageOut, TicketMessageCreate
from app.utils import build_stored_message_content, strip_attachment_ingestion_content
from app.attachments import build_attachment_note, process_message_uploads

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])


def _ticket_alias(ticket: Ticket, role: str) -> str:
    ref = ticket.reference_code
    if role == "student":
        return f"Student-{ref}"
    return f"Officer-{ref}"


def _can_read(ticket: Ticket, user) -> bool:
    if user.role == "admin":
        return True
    if user.role == "student" and ticket.student_id == user.id:
        return True
    if user.role == "ar_staff" and ticket.assigned_to == user.id:
        return True
    return False


def _can_write(ticket: Ticket, user) -> bool:
    if ticket.status in {"resolved", "closed"}:
        return False
    if user.role == "student" and ticket.student_id == user.id:
        return True
    if user.role == "ar_staff" and ticket.assigned_to == user.id:
        return True
    return False


def _serialize_attachment(attachment: MessageAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
        file_size_bytes=attachment.file_size_bytes,
        download_url=f"/api/attachments/{attachment.id}/download",
        view_url=f"/api/attachments/{attachment.id}/view",
    )


def _build_ticket_message_content(content: str, files: list[UploadFile]) -> tuple[str, list[dict]]:
    if not files:
        return content.strip(), []

    processed = process_message_uploads(files)
    file_names = [item.original_filename for item in processed]
    extracted_sections = [
        f"[File: {item.original_filename}]\n{item.extracted_text}"
        for item in processed
        if item.extracted_text
    ]

    base_content = content.strip() or "Please review the attached files."
    visible_content = f"{base_content}{build_attachment_note(file_names)}".strip()
    if not extracted_sections:
        return visible_content, [
            {
                "original_filename": item.original_filename,
                "stored_filename": item.stored_filename,
                "stored_path": item.stored_path,
                "content_type": item.content_type,
                "file_size_bytes": item.file_size_bytes,
                "extracted_text": item.extracted_text,
            }
            for item in processed
        ]
    return build_stored_message_content(visible_content, extracted_sections), [
        {
            "original_filename": item.original_filename,
            "stored_filename": item.stored_filename,
            "stored_path": item.stored_path,
            "content_type": item.content_type,
            "file_size_bytes": item.file_size_bytes,
            "extracted_text": item.extracted_text,
        }
        for item in processed
    ]


@router.get("/{ticket_id}/messages", response_model=list[TicketMessageOut])
def list_ticket_messages(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if not _can_read(ticket, current_user):
        raise HTTPException(status_code=403, detail="Not allowed")

    messages = (
        db.query(TicketMessage)
        .filter(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at)
        .all()
    )

    convo_messages = []
    if ticket.conversation_id:
        convo_messages = db.query(Message).filter(
            Message.conversation_id == ticket.conversation_id
        ).order_by(Message.created_at).all()

    combined = []
    for m in convo_messages:
        combined.append(
            TicketMessageOut(
                id=-m.id,
                ticket_id=ticket.id,
                sender_alias="ArASSIST" if m.sender == "bot" else f"Student-{ticket.reference_code}",
                sender_role="bot" if m.sender == "bot" else "student",
                content=strip_attachment_ingestion_content(m.content),
                created_at=m.created_at,
                attachments=[_serialize_attachment(attachment) for attachment in m.attachments],
            )
        )

    for m in messages:
        combined.append(
            TicketMessageOut(
                id=m.id,
                ticket_id=m.ticket_id,
                sender_alias=_ticket_alias(ticket, m.sender_role),
                sender_role="ar_staff" if m.sender_role == "officer" else m.sender_role,
                content=strip_attachment_ingestion_content(m.content),
                created_at=m.created_at,
                attachments=[_serialize_attachment(attachment) for attachment in m.attachments],
            )
        )

    combined.sort(key=lambda x: x.created_at)
    return combined


@router.get("", response_model=list[dict])
def list_user_tickets(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List tickets for the current user."""
    if current_user.role not in {"student", "ar_staff", "admin"}:
        raise HTTPException(status_code=403, detail="Not allowed")

    if current_user.role == "student":
        tickets = db.query(Ticket).filter(Ticket.student_id == current_user.id).order_by(Ticket.created_at.desc()).all()
    elif current_user.role == "ar_staff":
        tickets = db.query(Ticket).filter(Ticket.assigned_to == current_user.id).order_by(Ticket.created_at.desc()).all()
    else:
        tickets = db.query(Ticket).order_by(Ticket.created_at.desc()).all()

    return [
        {
            "id": t.id,
            "reference_code": t.reference_code,
            "conversation_id": t.conversation_id,
            "student_id": t.student_id,
            "status": t.status,
            "created_at": t.created_at,
        }
        for t in tickets
    ]


@router.get("/{ticket_id}", response_model=dict)
def get_ticket_detail(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get ticket detail and status."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if not _can_read(ticket, current_user):
        raise HTTPException(status_code=403, detail="Not allowed")

    return {
        "id": ticket.id,
        "reference_code": ticket.reference_code,
        "conversation_id": ticket.conversation_id,
        "student_id": ticket.student_id,
        "status": ticket.status,
        "created_at": ticket.created_at,
    }


@router.post("/{ticket_id}/messages", response_model=TicketMessageOut)
def create_ticket_message(
    ticket_id: int,
    payload: TicketMessageCreate | None = None,
    content: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if not _can_write(ticket, current_user):
        if ticket.status in {"resolved", "closed"}:
            raise HTTPException(status_code=400, detail="Ticket is resolved")
        raise HTTPException(status_code=403, detail="Not allowed")

    sender_role = "student" if current_user.role == "student" else "ar_staff"
    auto_started = False
    if (
        sender_role == "ar_staff"
        and ticket.assigned_to == current_user.id
        and ticket.status == "assigned"
    ):
        ticket.status = "in_progress"
        db.add(ticket)
        db.flush()
        db.add(
            TicketUpdate(
                ticket_id=ticket.id,
                updated_by=current_user.id,
                note="Ticket moved to in_progress on first officer reply",
                status_change="assigned->in_progress",
            )
        )
        auto_started = True

    usable_files = [file for file in (files or []) if file.filename]
    message_content, attachment_records = _build_ticket_message_content(
        content if content is not None else payload.content if payload else "",
        usable_files,
    )
    if not message_content:
        raise HTTPException(status_code=400, detail="Message content is required")

    msg = TicketMessage(
        ticket_id=ticket.id,
        sender_role=sender_role,
        sender_id=current_user.id,
        content=message_content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    for attachment in attachment_records:
        db.add(
            MessageAttachment(
                ticket_message_id=msg.id,
                uploaded_by_user_id=current_user.id,
                original_filename=attachment["original_filename"],
                stored_filename=attachment["stored_filename"],
                stored_path=attachment["stored_path"],
                content_type=attachment["content_type"],
                file_size_bytes=attachment["file_size_bytes"],
                extracted_text=attachment["extracted_text"],
            )
        )
    if attachment_records:
        db.commit()
        db.refresh(msg)

    if auto_started:
        db.refresh(ticket)

    return TicketMessageOut(
        id=msg.id,
        ticket_id=msg.ticket_id,
        sender_alias=_ticket_alias(ticket, sender_role),
        sender_role=sender_role,
        content=strip_attachment_ingestion_content(msg.content),
        created_at=msg.created_at,
        attachments=[_serialize_attachment(attachment) for attachment in msg.attachments],
    )
