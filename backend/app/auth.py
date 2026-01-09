from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Annotated

from backend.database.database import get_db, SessionLocal
from backend.database.orm_models import User
from sqlalchemy.orm import Session

# --- Security settings ---
SECRET_KEY = "Ofono1234."  # Replace with a strong key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"sub": data.get("username"), "exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# DB dependency annotation for type hints
db_dependency = Annotated[SessionLocal, Depends(get_db)]


def get_current_user(db: Session = Depends(get_db), authorization: str | None = Header(None)) -> User:
    if authorization is None:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header format")

    token = authorization.split("Bearer ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    username: str | None = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


current_user_dependency = Annotated[User, Depends(get_current_user)]
