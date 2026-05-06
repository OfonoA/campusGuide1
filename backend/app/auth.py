from fastapi import Depends, Header, HTTPException
import os
from jose import JWTError, jwt
from dotenv import load_dotenv
from datetime import datetime, timedelta
from typing import Annotated
import hashlib
import secrets
import uuid

from database.database import get_db, SessionLocal
from database.orm_models import User, RefreshToken
from sqlalchemy.orm import Session

# --- Security settings ---
load_dotenv()


def _is_production_env() -> bool:
    env = os.getenv("APP_ENV") or os.getenv("ENV") or os.getenv("FASTAPI_ENV") or ""
    return env.strip().lower() == "production"


def _get_secret_key() -> str:
    secret_key = os.getenv("SECRET_KEY")
    if secret_key:
        return secret_key

    if _is_production_env():
        raise RuntimeError("SECRET_KEY environment variable is required")

    fallback = "dev-secret-key-change-me"
    print("Warning: SECRET_KEY not set; using development fallback key")
    return fallback


SECRET_KEY = _get_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))


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


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_refresh_token(db: Session, user: User) -> str:
    raw_token = secrets.token_urlsafe(64)
    hashed = _hash_refresh_token(raw_token)
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    refresh_record = RefreshToken(
        token_id=str(uuid.uuid4()),
        user_id=user.id,
        hashed_token=hashed,
        expires_at=expire,
    )
    db.add(refresh_record)
    db.commit()
    db.refresh(refresh_record)
    return raw_token


def consume_refresh_token(db: Session, refresh_token: str) -> RefreshToken | None:
    hashed = _hash_refresh_token(refresh_token)
    token_record = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.hashed_token == hashed,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if token_record:
        token_record.last_used_at = datetime.utcnow()
        db.add(token_record)
        db.commit()
        db.refresh(token_record)
    return token_record


def rotate_refresh_token(db: Session, token_record: RefreshToken) -> str:
    user = token_record.user
    token_record.revoked = True
    db.add(token_record)
    db.commit()
    return create_refresh_token(db, user)


def revoke_refresh_tokens(db: Session, user_id: int, refresh_token: str | None = None):
    query = db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked == False,
    )
    if refresh_token:
        hashed = _hash_refresh_token(refresh_token)
        query = query.filter(RefreshToken.hashed_token == hashed)
    query.update({RefreshToken.revoked: True}, synchronize_session=False)
    db.commit()
