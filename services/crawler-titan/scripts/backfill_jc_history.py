"""
历史赛程回填：按指定业务日期，从 jc.titan007.com 获取赛程并爬取
analysis / 亚盘+大小球 / 欧赔，直接写 titan 库对应表。

与 jc-workset（在售场次、轮询、排干）不同：
- 本脚本处理**历史已完赛**日期（status=-1），不落 workset、不排干状态机。
- 写库路径复用现有 core 模块：
    titan_jc_schedule      ← jc_db.upsert_jc_schedule（upsert）
    titan_analysis_*        ← analysis_store.upsert_analysis（upsert 三表）
    titan_asian_odds / over_under_odds / euro_odds
                            ← jc_db.insert_odds（append-only，澳门 1 / 威廉希尔 115）

每日期爬取完成后调用 mapping（npx tsx mapping/scripts/run-mapping.ts --date {date}
--skip-team --skip-jc）重建 cross_source_matches，并核对竞彩匹配结果。

日志统一写 data/backfill/：
    {date}.log     逐场明细 + 汇总
    unmatched.log  未能与竞彩匹配的场次（追加）

用法：
    python scripts/backfill_jc_history.py --date 2026-08-11
    python scripts/backfill_jc_history.py --date 2026-08-11 --skip-mapping
    python scripts/backfill_jc_history.py --date 2026-08-11 --no-write
"""
import argparse
import datetime as dt
import os
import random
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import analysis_store, db, jc_db, jc_parser, odds_parser
from pipelines import analysis_euro
from core.drain import ASIAN_COMPANY, EURO_COMPANY, SUBTYPE

MONOREPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BACKFILL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "backfill")


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _log_append(path: str, line: str) -> None:
    _ensure_dir(os.path.dirname(path))
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _sleep():
    time.sleep(random.uniform(1.0, 3.0))


# ─── 单场爬取 + 写库 ───────────────────────────────────────────

def crawl_match(conn, m: dict, no_write: bool) -> dict:
    """爬一场比赛（analysis + 亚盘/大小球 + 欧赔）并写库。返回统计 dict。"""
    sid = m["sid"]
    kickoff = m.get("kickoff") or ""
    stat = {"sid": sid, "analysis": False, "media": False, "asian": 0, "ou": 0, "euro": 0}

    # 1) analysis
    try:
        res = analysis_euro.fetch_analysis(sid, m)
        if res:
            matches, h2h, rh, ra = res
            # analysis 成功 = 解析到内容（h2h/recent/standings 任一）；standings 空可能是
            # 小赛事页面无积分榜，不算失败
            stat["analysis"] = bool(h2h or rh or ra or matches.get("standings"))
            stat["media"] = bool(matches.get("media_analysis"))
            if not no_write:
                analysis_store.upsert_analysis(sid, matches, h2h, rh, ra)
    except Exception as e:  # noqa: BLE001
        stat["analysis_err"] = str(e)[:200]

    # 2) 亚盘 + 大小球（澳门 1，全场）
    try:
        both = odds_parser.scrape_dual_odds(sid, ASIAN_COMPANY, is_half=False)
        a = both.get("asian")
        o = both.get("over_under")
        if a and a.changes and not no_write:
            for ch in a.changes:
                jc_db.insert_odds(conn, "asian", sid, ASIAN_COMPANY, SUBTYPE, ch, kickoff)
        if o and o.changes and not no_write:
            for ch in o.changes:
                jc_db.insert_odds(conn, "over_under", sid, ASIAN_COMPANY, SUBTYPE, ch, kickoff)
        stat["asian"] = len(a.changes) if a and a.changes else 0
        stat["ou"] = len(o.changes) if o and o.changes else 0
    except Exception as e:  # noqa: BLE001
        stat["odds_err"] = str(e)[:200]

    # 3) 欧赔（威廉希尔 115）
    try:
        js = odds_parser.fetch_euro_js_data(sid)
        if js:
            item = odds_parser.scrape_euro_from_oddslist(sid, EURO_COMPANY, js)
            if item and item.changes and not no_write:
                for ch in item.changes:
                    jc_db.insert_odds(conn, "european", sid, EURO_COMPANY, SUBTYPE, ch, kickoff)
            stat["euro"] = len(item.changes) if item and item.changes else 0
    except Exception as e:  # noqa: BLE001
        stat["euro_err"] = str(e)[:200]

    # 4) 赛程 upsert
    if not no_write:
        try:
            jc_db.upsert_jc_schedule(conn, m)
        except Exception as e:  # noqa: BLE001
            stat["sched_err"] = str(e)[:200]

    _sleep()
    return stat


# ─── mapping 调用 ──────────────────────────────────────────────

def run_mapping(date: str) -> tuple:
    """调用 run-mapping.ts --date {date} --skip-team --skip-jc，返回 (ok, output)。"""
    npx = "npx.cmd" if os.name == "nt" else "npx"
    script = os.path.join(MONOREPO, "mapping", "scripts", "run-mapping.ts")
    cmd = [npx, "tsx", script, f"--date={date}", "--skip-team", "--skip-jc"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=1800)
        return r.returncode == 0, (r.stdout or "") + (r.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def check_matches(date: str) -> tuple:
    """读 core.cross_source_matches，统计该日匹配结果 → (matched, unmatched_sids)。"""
    try:
        conn = db.connect_ro("core", user="api_service")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT titan_jc_sid, jc_match_id FROM cross_source_matches "
                    "WHERE business_date=%s", [date])
                rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        print(f"  [check-matches] core 查询失败: {e}")
        return None, []
    matched = sum(1 for _, jc in rows if jc is not None)
    unmatched = [sid for sid, jc in rows if jc is None]
    return matched, unmatched


# ─── 主流程 ────────────────────────────────────────────────────

def backfill_date(date: str, no_write: bool, skip_mapping: bool) -> int:
    _ensure_dir(BACKFILL_DIR)
    global UNMATCHED_PATH
    day_log = os.path.join(BACKFILL_DIR, f"{date}.log")
    UNMATCHED_PATH = os.path.join(BACKFILL_DIR, "unmatched.log")

    log_lines = []
    def log(line: str):
        log_lines.append(line)
        print(line)

    log(f"===== backfill {date} start {dt.datetime.now():%Y-%m-%d %H:%M:%S} no_write={no_write} =====")

    # 1) 赛程
    text = jc_parser.fetch_jc_result(date)
    if not text:
        log(f"[fail] 抓取 JcResult 失败: {date}")
        _log_append(day_log, "\n".join(log_lines))
        return 1
    parsed = jc_parser.parse_jc_result(text, date)
    matches = parsed.get("matches") or []
    log(f"[schedule] {date} 共 {len(matches)} 场")

    conn = db.connect() if not no_write else None
    stats = []
    try:
        for i, m in enumerate(matches, 1):
            log(f"[{i}/{len(matches)}] sid={m.get('sid')} {m.get('home_team')} vs {m.get('away_team')} "
                f"match_num={m.get('match_num')} status={m.get('status')}")
            stat = crawl_match(conn, m, no_write)
            stats.append(stat)
            # 明细行：analysis/media/盘口数 完整性
            a = "Y" if stat["analysis"] else "N"
            md = "Y" if stat["media"] else "N"
            log(f"  → analysis={a} media={md} asian={stat['asian']} ou={stat['ou']} euro={stat['euro']}"
                + (f" analysis_err={stat.get('analysis_err')}" if stat.get("analysis_err") else "")
                + (f" odds_err={stat.get('odds_err')}" if stat.get("odds_err") else ""))
            # 数据不完整：analysis 或赔率全空 → 记日志
            if not stat["analysis"] or (stat["asian"] == 0 and stat["ou"] == 0 and stat["euro"] == 0):
                _log_append(day_log, f"INCOMPLETE sid={m.get('sid')} match_num={m.get('match_num')} "
                                     f"analysis={a} asian={stat['asian']} ou={stat['ou']} euro={stat['euro']}")
        if conn:
            conn.commit()
    finally:
        if conn:
            conn.close()

    ok_analysis = sum(1 for s in stats if s["analysis"])
    ok_odds = sum(1 for s in stats if s["asian"] or s["ou"] or s["euro"])
    log(f"[summary] {date} 场次={len(stats)} analysis_ok={ok_analysis} odds_ok={ok_odds}")

    # 2) mapping 重建 + 匹配核对
    if not skip_mapping:
        ok, out = run_mapping(date)
        log(f"[mapping] run-mapping --date {date} exit_ok={ok}")
        if not ok:
            log(f"[mapping] 输出片段: {out[-1500:]}")
        matched, unmatched = check_matches(date)
        log(f"[match] {date} cross_source_matches={matched + len(unmatched)} 命中竞彩={matched} 未匹配={len(unmatched)}")
        for sid in unmatched:
            _log_append(UNMATCHED_PATH, f"{date} sid={sid} reason=jc_match_id NULL")

    log(f"===== backfill {date} done {dt.datetime.now():%Y-%m-%d %H:%M:%S} =====")
    _log_append(day_log, "\n".join(log_lines))
    return 0


def main():
    p = argparse.ArgumentParser(description="历史赛程回填（单日）")
    p.add_argument("--date", required=True, help="业务日期 YYYY-MM-DD")
    p.add_argument("--no-write", action="store_true", help="只抓取不写库（dry-run）")
    p.add_argument("--skip-mapping", action="store_true", help="跳过 mapping 调用")
    args = p.parse_args()
    try:
        dt.date.fromisoformat(args.date)
    except ValueError:
        print("非法日期:", args.date)
        sys.exit(2)
    sys.exit(backfill_date(args.date, args.no_write, args.skip_mapping))


if __name__ == "__main__":
    main()
