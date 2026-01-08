from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from database.database import get_db
from database.orm_models import Ticket, Conversation
from app.feedback.schemas import FeedbackRequest, FeedbackResponse
from app.auth import get_current_user  # adjust import if needed

router = APIRouter()


def generate_reference_code():
    return f"AR-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"


@router.post("/feedback", response_model=FeedbackResponse)
def submit_feedback(
    payload: FeedbackRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    # 1️⃣ Validate conversation exists & belongs to user
    conversation = db.query(Conversation).filter(
        Conversation.id == payload.conversation_id,
        Conversation.user_id == current_user.id
    ).first()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 2️⃣ If satisfactory → no ticket
    if payload.satisfactory:
        return FeedbackResponse(
            message="Thank you for your feedback. We're glad it helped."
        )

    # 3️⃣ If NOT satisfactory & wants in-person help → create ticket
    if payload.request_in_person:
        reference_code = generate_reference_code()

        ticket = Ticket(
            reference_code=reference_code,
            conversation_id=conversation.id,
            student_id=current_user.id,
            status="open"
        )

        db.add(ticket)
        db.commit()
        db.refresh(ticket)

        return FeedbackResponse(
            message="Your request has been escalated to Academic Registrar staff.",
            ticket_reference=reference_code
        )

    # 4️⃣ Not satisfactory but no in-person request
    return FeedbackResponse(
        message="Thank you for your feedback. We will use it to improve responses."
    )
