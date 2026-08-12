"""幂等创建初始管理员账号（读 .env 的 ADMIN_EMAIL / ADMIN_PASSWORD）。

用法：
    .venv\\Scripts\\python.exe scripts\\create_admin.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services import security


def main() -> None:
    settings = get_settings()
    email = settings.admin_email
    password = settings.admin_password

    if security.get_user_by_email(email):
        print(f"管理员已存在: {email}（跳过）")
        return

    uid = security.create_user(email, password, security.ROLE_ADMIN)
    print(f"已创建管理员: {email} (id={uid}, role=ADMIN)")


if __name__ == "__main__":
    main()
