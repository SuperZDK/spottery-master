import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from sqlalchemy import text

from app.config import get_settings
from app.db import core_engine

ALGORITHM = "HS256"

ROLE_FREE = "FREE"
ROLE_VIP = "VIP"
ROLE_ADMIN = "ADMIN"
VALID_ROLES = (ROLE_FREE, ROLE_VIP, ROLE_ADMIN)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, email: str, role: str) -> str:
    settings = get_settings()
    payload = {"sub": str(user_id), "email": email, "role": role}
    # jwt 包对 datetime 需要正确处理
    import datetime

    exp = datetime.datetime.utcnow() + datetime.timedelta(days=settings.jwt_expire_days)
    payload["exp"] = exp
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])


def get_user_by_id(user_id: int):
    with core_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, email, role, created_at FROM users WHERE id = :i"),
            {"i": user_id},
        ).mappings().first()
    return row


def get_user_by_email(email: str):
    with core_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, email, password_hash, role, created_at FROM users WHERE email = :e"),
            {"e": email},
        ).mappings().first()
    return row


def create_user(email: str, plain_password: str, role: str = ROLE_FREE) -> int:
    pwd = hash_password(plain_password)
    with core_engine.connect() as conn:
        with conn.begin():
            result = conn.execute(
                text(
                    "INSERT INTO users (email, password_hash, role) VALUES (:e, :p, :r) RETURNING id"
                ),
                {"e": email, "p": pwd, "r": role},
            )
            uid = result.scalar()
    return uid


def list_users():
    with core_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, email, role, created_at FROM users ORDER BY id")
        ).mappings().all()
    return rows


def update_user_role(user_id: int, role: str) -> bool:
    with core_engine.connect() as conn:
        with conn.begin():
            result = conn.execute(
                text("UPDATE users SET role = :r WHERE id = :i"),
                {"r": role, "i": user_id},
            )
            return result.rowcount > 0
