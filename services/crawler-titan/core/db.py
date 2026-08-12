"""crawler_titan 用户 → titan 库的共享连接。

密码从 monorepo 根 .env 读取（PG_APP_PASSWORD，回退 POSTGRES_PASSWORD）。
"""
import os

DB_HOST = "localhost"
DB_PORT = 5432
DB_USER = "crawler_titan"
DB_NAME = "titan"


def _monorepo_root() -> str:
    # services/crawler-titan/core/db.py → 上溯 4 层到 spottery-master 根
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def app_password() -> str:
    env_path = os.path.join(_monorepo_root(), ".env")
    pw = ""
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("PG_APP_PASSWORD="):
                    pw = line.split("=", 1)[1].strip()
                    break
        if not pw:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("POSTGRES_PASSWORD="):
                        pw = line.split("=", 1)[1].strip()
                        break
    except OSError:
        pass
    return pw


def connect(user: str = DB_USER, dbname: str = DB_NAME):
    import psycopg
    return psycopg.connect(
        host=DB_HOST, port=DB_PORT, user=user, password=app_password(),
        dbname=dbname, connect_timeout=20)


def connect_ro(dbname: str, user: str = DB_USER):
    """跨库只读连接（读权限已全放开；连接后强制只读事务）。"""
    conn = connect(user=user, dbname=dbname)
    with conn.cursor() as cur:
        cur.execute("SET default_transaction_read_only = on")
    return conn
