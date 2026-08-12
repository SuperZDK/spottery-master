"""整日排干 + completeDate 推进（镜像 sporttery drain.ts）。

排干条件（用户确认）：某天所有比赛彻底结束，且每场 analysis + odds 数据都齐，
才整日写 DB，成功后才推进 completeDate。

写库：
  - 比赛清单      → titan_jc_schedule（upsert）
  - analysis      → titan_analysis_matches/h2h/recent（analysis_store）
  - 亚盘/大小球    → titan_asian_odds / titan_over_under_odds（append-only，公司=澳门 1）
  - 欧赔          → titan_euro_odds（append-only，公司=威廉希尔 115）

completeDate 不 reconcile 到 DB max（DB 历史不完整），只由成功排干逐日顺序推进。
"""
import datetime as dt

from core import analysis_store, db, jc_db

DEFAULT_COMPLETE_DATE = "2026-08-01"

# 爬取配置（运行时固定，配置文件不改）
ASIAN_COMPANY = 1        # 澳门（亚盘 + 大小球共用）
EURO_COMPANY = 115       # 威廉希尔
SUBTYPE = "full"         # 只爬全场（不爬半场）


def add_days_str(date_str: str, days: int) -> str:
    d = dt.date.fromisoformat(date_str)
    return (d + dt.timedelta(days=days)).isoformat()


def drain_date(ws, date: str) -> bool:
    """整日排干写 DB。任一步失败返回 False，保留该日重试（幂等）。

    不再要求 terminal——titan 不在本侧补赛果，status/比分由调用方在排干前
    按 sporttery 对齐填入；这里只校验每场 analysis + odds 数据齐。
    """
    matches = ws.matches_of(date)
    if not matches:
        return True
    for m in matches.values():
        jf = ws.read_match(m.get("sid"))
        if not jf:
            return False
        detail = jf.get("detail") or {}
        if not detail.get("analysis") or not detail.get("odds"):
            return False
    try:
        conn = db.connect()
        try:
            for m in matches.values():
                sid = m.get("sid")
                jc_db.upsert_jc_schedule(conn, m)

                jf = ws.read_match(sid)
                if not jf:
                    raise RuntimeError(f"match file missing sid={sid}")
                detail = jf.get("detail") or {}

                a = detail.get("analysis") or {}
                if a.get("matches"):
                    analysis_store.upsert_analysis(
                        sid, a["matches"], a.get("h2h") or [],
                        a.get("recent_home") or [], a.get("recent_away") or [])

                kickoff = m.get("kickoff") or ""
                odds = detail.get("odds") or {}
                for ch in odds.get("asian") or []:
                    jc_db.insert_odds(conn, "asian", sid, ASIAN_COMPANY, SUBTYPE, ch, kickoff)
                for ch in odds.get("over_under") or []:
                    jc_db.insert_odds(conn, "over_under", sid, ASIAN_COMPANY, SUBTYPE, ch, kickoff)
                for ch in odds.get("european") or []:
                    jc_db.insert_odds(conn, "european", sid, EURO_COMPANY, SUBTYPE, ch, kickoff)
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  [drain] {date} 导入失败: {e}")
        return False


def advance_complete_date(ws, drained: list) -> None:
    """completeDate 逐日顺序推进：只跳过本次成功排干的日期。"""
    cd = ws.complete_date or DEFAULT_COMPLETE_DATE
    drained_set = set(drained)
    while True:
        n = add_days_str(cd, 1)
        if n in drained_set:
            cd = n
            continue
        break
    ws.set_complete_date(cd)
