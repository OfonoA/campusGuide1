from pydantic import BaseModel

class FeedbackRequest(BaseModel):
    conversation_id: int
    satisfactory: bool
    request_in_person: bool


class FeedbackResponse(BaseModel):
    message: str
    ticket_reference: str | None = None
