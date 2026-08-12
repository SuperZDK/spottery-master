from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine

from app.config import get_settings

_settings = get_settings()


def _engine(url: str, read_only: bool) -> Engine:
    kwargs = dict(
        pool_pre_ping=True,
        pool_size=8,
        max_overflow=4,
        pool_recycle=1800,
    )
    eng = create_engine(url, **kwargs)
    if read_only:
        # 源库只读：连接后强制会话级只读（与架构 6.2 一致）
        @event.listens_for(eng, "connect")
        def _set_readonly(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("SET default_transaction_read_only = on")
            cur.close()

    return eng


core_engine = _engine(_settings._core, read_only=False)
sofascore_engine = _engine(_settings._sofascore, read_only=True)
sporttery_engine = _engine(_settings._sporttery, read_only=True)
titan_engine = _engine(_settings._titan, read_only=True)


def dispose_engines() -> None:
    for e in (core_engine, sofascore_engine, sporttery_engine, titan_engine):
        e.dispose()
