from functools import lru_cache
from pathlib import Path
from typing import Dict

from pydantic_settings import BaseSettings

MONOREPO = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    # 平台库（api_service 读写）
    core_db_url: str = "postgresql+psycopg://api_service:change-me@localhost:5432/core"
    # 三源库（api_service 只读）
    sofascore_db_url: str = "postgresql+psycopg://api_service:change-me@localhost:5432/sofascore"
    sporttery_db_url: str = "postgresql+psycopg://api_service:change-me@localhost:5432/sporttery"
    titan_db_url: str = "postgresql+psycopg://api_service:change-me@localhost:5432/titan"

    jwt_secret_key: str = "change-me"
    jwt_expire_days: int = 7
    internal_api_key: str = "change-me"

    admin_email: str = "admin@spottery.dev"
    admin_password: str = "change-me"

    # 竞彩爬虫 JSON 数据路径（config/paths.json）
    sporttery_workset: str = str(
        MONOREPO / "services/crawler-sporttery/data/jingcai/workset.json"
    )
    sporttery_matches: str = str(
        MONOREPO / "services/crawler-sporttery/data/jingcai/matches"
    )

    # PG 应用账号密码（monorepo .env 提供）
    pg_app_password: str = "change-me"
    db_host: str = "localhost"

    @property
    def _core(self) -> str:
        return f"postgresql+psycopg://api_service:{self.pg_app_password}@{self.db_host}:5432/core"

    @property
    def _sporttery(self) -> str:
        return f"postgresql+psycopg://api_service:{self.pg_app_password}@{self.db_host}:5432/sporttery"

    @property
    def _sofascore(self) -> str:
        return f"postgresql+psycopg://api_service:{self.pg_app_password}@{self.db_host}:5432/sofascore"

    @property
    def _titan(self) -> str:
        return f"postgresql+psycopg://api_service:{self.pg_app_password}@{self.db_host}:5432/titan"

    model_config = {"env_file": str(MONOREPO / ".env"), "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
