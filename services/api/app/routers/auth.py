from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services import security

router = APIRouter(tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

bearer = HTTPBearer(auto_error=False)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    created_at: str


def _current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = security.decode_token(cred.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    row = security.get_user_by_id(int(payload["sub"]))
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return row


@router.post("/auth/register", response_model=TokenOut, status_code=201)
@limiter.limit("5/minute")
def register(request: Request, body: RegisterIn):
    if security.get_user_by_email(body.email):
        raise HTTPException(status_code=409, detail="邮箱已注册")
    uid = security.create_user(body.email, body.password)
    token = security.create_access_token(uid, body.email, "FREE")
    return TokenOut(
        access_token=token,
        user={"id": uid, "email": body.email, "role": "FREE"},
    )


@router.post("/auth/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn):
    row = security.get_user_by_email(body.email)
    if not row or not security.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    token = security.create_access_token(row["id"], row["email"], row["role"])
    return TokenOut(
        access_token=token,
        user={"id": row["id"], "email": row["email"], "role": row["role"]},
    )


@router.get("/users/me", response_model=UserOut)
def me(user=Depends(_current_user)):
    return UserOut(
        id=user["id"],
        email=user["email"],
        role=user["role"],
        created_at=user["created_at"].isoformat(),
    )
