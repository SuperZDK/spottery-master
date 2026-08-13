"""
读两侧 workset 增量匹配比赛 → 写 core.cross_source_matches。

由 titan（jc_workset，Python）与 sporttery（live，TS）在检测到新增场次时调用。

匹配键：(business_date, match_num) —— 两侧 match_num 均为 "周三001" 格式。

逻辑（增量、幂等，先检测后写）：
  - 以 titan 侧 workset 场次为锚点（cross_source_matches.titan_jc_sid 是主键）
  - 对 titan 每场：查 cross_source_matches 是否已有该 titan_jc_sid → 有则跳过（存在不匹配）
  - 无 → 找 sporttery workset 同 (date, match_num) 的 matchId（可空）→ INSERT，
    ON CONFLICT (titan_jc_sid) DO UPDATE 只补 jc_match_id
  - sporttery 有而 titan 无的场次无法建行（主键是 titan sid），等 titan 侧触发

运行：python mapping/scripts/workset-match.py
连接 core 库：api_service 用户 + PG_APP_PASSWORD（从 monorepo .env 读）
"""
import json
import os
import sys

MONOREPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TITAN_WORKSET = os.path.join(MONOREPO, "services", "crawler-titan", "data", "jc", "workset.json")
SPORTTERY_WORKSET = os.path.join(MONOREPO, "services", "crawler-sporttery", "data", "jingcai", "workset.json")


def _app_password():
    env_path = os.path.join(MONOREPO, ".env")
    pw = ""
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("PG_APP_PASSWORD="):
                    pw = line.split("=", 1)[1].strip()
                    break
            if not pw:
                f.seek(0)
                for line in f:
                    line = line.strip()
                    if line.startswith("POSTGRES_PASSWORD="):
                        pw = line.split("=", 1)[1].strip()
                        break
    except OSError:
        pass
    return pw


def _load_json(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def load_titan_index(ws) -> dict:
    """titan workset → {business_date: {match_num: {sid, sclass_id, kickoff}}}"""
    out = {}
    for date, entry in (ws.get("dates") or {}).items():
        matches = entry.get("matches") or {}
        for sid, m in matches.items():
            mn = m.get("match_num")
            if not mn:
                continue
            out.setdefault(date, {})[mn] = {
                "sid": m.get("sid"),
                "sclass_id": m.get("sclass_id"),
                "kickoff": m.get("kickoff"),
            }
    return out


def load_sporttery_index(ws) -> dict:
    """sporttery workset → {business_date: {match_num: {matchId, kickoffTime}}}"""
    out = {}
    for date, entry in (ws.get("dates") or {}).items():
        for m in (entry.get("matches") or []):
            mn = m.get("matchNum")
            if not mn:
                continue
            out.setdefault(date, {})[mn] = {
                "matchId": m.get("matchId"),
                "kickoffTime": m.get("kickoffTime"),
            }
    return out


def run(no_write=False) -> dict:
    titan_ws = _load_json(TITAN_WORKSET)
    sporttery_ws = _load_json(SPORTTERY_WORKSET)
    titan_idx = load_titan_index(titan_ws)
    sporttery_idx = load_sporttery_index(sporttery_ws)

    stats = {"matched": 0, "skipped_existing": 0, "missing_jc": 0, "inserted": 0, "updated": 0}

    if not titan_idx:
        print("[workset-match] titan workset 为空，无场次可匹配")
        return stats

    import psycopg
    conn = psycopg.connect(
        host="localhost", port=5432, user="api_service",
        password=_app_password(), dbname="core", connect_timeout=20)
    try:
        with conn.cursor() as cur:
            for date, mn_map in titan_idx.items():
                jc_map = sporttery_idx.get(date, {})
                for mn, t in mn_map.items():
                    sid = t["sid"]
                    # ① 检测：cross_source_matches 是否已有该 titan_jc_sid
                    cur.execute(
                        "SELECT jc_match_id FROM cross_source_matches WHERE titan_jc_sid=%s", [sid])
                    row = cur.fetchone()
                    if row is not None:
                        # 已有 → 存在不匹配；仅当 jc_match_id 为空且现在能补上时补
                        if row[0] is None and mn in jc_map and jc_map[mn]["matchId"] is not None:
                            cur.execute(
                                "UPDATE cross_source_matches SET jc_match_id=%s, updated_at=now() "
                                "WHERE titan_jc_sid=%s",
                                [jc_map[mn]["matchId"], sid])
                            stats["updated"] += 1
                        else:
                            stats["skipped_existing"] += 1
                        continue
                    # ② 找 sporttery 同 (date, match_num) 的 matchId
                    jc_match_id = None
                    if mn in jc_map:
                        jc_match_id = jc_map[mn]["matchId"]
                    if jc_match_id is None:
                        stats["missing_jc"] += 1
                    # ③ 写行（幂等）
                    if not no_write:
                        cur.execute(
                            """INSERT INTO cross_source_matches
                                 (titan_jc_sid, jc_match_id, business_date, kickoff_time, sclass_id)
                               VALUES (%s,%s,%s,%s,%s)
                               ON CONFLICT (titan_jc_sid) DO UPDATE SET
                                 jc_match_id=EXCLUDED.jc_match_id, updated_at=now()""",
                            [sid, jc_match_id, date, t["kickoff"], t["sclass_id"]])
                        stats["inserted"] += 1
                    stats["matched"] += 1
        if not no_write:
            conn.commit()
    finally:
        conn.close()

    print(f"[workset-match] matched={stats['matched']} inserted={stats['inserted']} "
          f"updated={stats['updated']} skipped_existing={stats['skipped_existing']} "
          f"missing_jc={stats['missing_jc']}")
    return stats


if __name__ == "__main__":
    run(no_write="--no-write" in sys.argv)
