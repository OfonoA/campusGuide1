from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.database import get_db
from app.auth import get_current_user
from app.reinforcement.ingest import run_reinforcement_ingestion

router = APIRouter()


def require_admin(user):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access only")


@router.post("/admin/ingest-reinforcement")
def trigger_reinforcement_ingestion(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_admin(current_user)
    try:
        run_reinforcement_ingestion(db)
        return {"message": "Reinforcement ingestion triggered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {e}")
