"""无效场次（Refund）兜底：读 sporttery 爬虫维护的 workset + DB。

判定：按 (business_date, match_num) 查 sporttery（连接键已验证两边一致，如 周四003）：
  1. sporttery workset.json（在售/未排干，poolStatus 字段）
  2. sporttery DB jingcai_schedules（已排干/历史，pool_status 字段）

命中 pool_status == 'Refund' → 无效场次（titan 的 JcResult 永不返回它，需兜底标记 -10）。
命中 'Payout' 但 titan JcResult 缺失 → 记 pending 人工核查，不自动判。
"""
import json
import os
import time

from core import db

MONOREPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SPORTTERY_WORKSET = os.path.join(MONOREPO, "services", "crawler-sporttery", "data", "jingcai", "workset.json")
PENDING_PATH = os.path.join(MONOREPO, "services", "crawler-titan", "data", "jc", "pending.json")


# ─── sporttery workset.json ───────────────────────────────────

def _load_sporttery_workset():
    if not os.path.isfile(SPORTTERY_WORKSET):
        return None
    try:
        with open(SPORTTERY_WORKSET, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _check_workset(business_date: str, match_num: str):
    ws = _load_sporttery_workset()
    if not ws:
        return None
    entry = ws.get("dates", {}).get(business_date, {})
    for m in entry.get("matches", []):
        if m.get("matchNum") == match_num:
            return m.get("poolStatus")
    return None


def _check_db(business_date: str, match_num: str):
    try:
        conn = db.connect_ro("sporttery")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pool_status FROM jingcai_schedules "
                    "WHERE business_date=%s AND match_num=%s LIMIT 1",
                    [business_date, match_num])
                row = cur.fetchone()
                return row[0] if row else None
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        print(f"  [refund] sporttery DB 查询失败: {e}")
        return None


def check_refund(business_date: str, match_num: str):
    """返回 'Refund' / 'Payout' / 'Selling' / None。None = 两处都没有。"""
    status = _check_workset(business_date, match_num)
    if status is not None:
        return status
    return _check_db(business_date, match_num)


def get_complete_date():
    """sporttery workset.json 的 completeDate（其"该日都完赛"信号）。"""
    ws = _load_sporttery_workset()
    if not ws:
        return None
    return ws.get("completeDate")


def get_day_results(business_date: str) -> dict:
    """sporttery DB 某业务日全部比赛 → {match_num: {pool_status, home_score, away_score}}。"""
    try:
        conn = db.connect_ro("sporttery")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT match_num, pool_status, home_score, away_score "
                    "FROM jingcai_schedules WHERE business_date=%s", [business_date])
                out = {}
                for mn, ps, hs, as_ in cur.fetchall():
                    if mn:
                        out[mn] = {"pool_status": ps, "home_score": hs, "away_score": as_}
                return out
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        print(f"  [sporttery] 读取 {business_date} 赛果失败: {e}")
        return {}


# ─── pending.json（人工核查清单）──────────────────────────────

def load_pending() -> dict:
    if os.path.isfile(PENDING_PATH):
        try:
            with open(PENDING_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"items": []}


def save_pending(data: dict) -> None:
    os.makedirs(os.path.dirname(PENDING_PATH), exist_ok=True)
    tmp = f"{PENDING_PATH}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PENDING_PATH)


def append_pending(sid, business_date, match_num, home_team, away_team, kickoff, reason, source=None) -> None:
    data = load_pending()
    existing = {x["sid"] for x in data["items"]}
    if sid in existing:
        return
    data["items"].append({
        "sid": sid,
        "business_date": business_date,
        "match_num": match_num,
        "home_team": home_team,
        "away_team": away_team,
        "kickoff": kickoff,
        "reason": reason,
        "sporttery_status": source,
        "detected_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
    })
    save_pending(data)
