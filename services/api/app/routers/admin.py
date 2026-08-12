from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.routers.auth import _current_user
from app.services import security

router = APIRouter(tags=["admin"])


class RoleIn(BaseModel):
    role: str = Field(pattern="^(FREE|VIP|ADMIN)$")


def _require_admin(user=Depends(_current_user)):
    if user["role"] != security.ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


@router.get("/admin/users")
def list_users(_=Depends(_require_admin)):
    return [
        {"id": r["id"], "email": r["email"], "role": r["role"], "created_at": r["created_at"].isoformat()}
        for r in security.list_users()
    ]


@router.patch("/admin/users/{user_id}/role")
def update_user_role(user_id: int, body: RoleIn, admin=Depends(_require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")
    if not security.update_user_role(user_id, body.role):
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"ok": True}
