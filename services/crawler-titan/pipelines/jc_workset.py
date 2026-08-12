"""
竞彩每日自动化 workset（titan 侧）——常驻 daemon。

titan 的作用是与竞彩对接：只做三件事
  1. 获取赛程（bf_jc 在售，每业务日只读一次）
  2. 获取详情（analysis，每场一次）
  3. 获取比赛开始前的赔率（亚盘/大小球 + 欧赔，按开赛时间轮询）

不再在本侧查询赛果/比分/完赛状态——赛果/延期/取消直接与 sporttery 爬虫
（workset.json + DB）对齐；排干以 sporttery.completeDate 为准。

运行形态：常驻 daemon（loop 算 nextDue 精确睡眠，浏览器常驻）。

每场独立赔率时间表（锚定 first_odds_at）：
  - 首抓：进场时刻（first_odds_at）
  - 常规 30 分钟：first_odds_at + 30m·k，取 ≤ T-1h
  - 关键点：T-1h / T-30m / T-15m / T-5m / T（T 真正执行）
  - T = 开赛时间（完全以开赛时间为基准，不再用停售时间）

每次 odds 轮询 = 2 次抓取（亚大澳门 1 请求 + 欧赔威廉希尔 JS/OddsHistory 2 请求）。
亚盘/大小球在存储前按时间过滤：只保留 change_time <= kickoff 的赛前变动
（titan 的"即"标注不可靠），欧赔不过滤（无滚球）。过滤后为空 → 保留全部 + log 容忍。

兜底：每场在 kickoff + 1h 抓一次终盘（补赛前赔率，标记 backup_done）。

排干：sporttery.completeDate >= 业务日 且 每场 analysis + odds 齐 → 整日写 DB；
写库前按 sporttery 赛果填充 status/比分（Refund → -10，Payout → -1 + 比分），
并对齐校验缺场次（sporttery 有而 titan 无 → 记 pending）。

发现节奏：11:00 开市；11:00~11:30 每 5 分钟突发；之后每小时兜底；次日 11:00 前睡眠。

运行：python -m pipelines.jc_workset            （启动常驻 daemon）
      python -m pipelines.jc_workset --once --dry-run   （单 cycle 测试，不落盘不联网爬）
"""
import argparse
import datetime as dt
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import jc_db, jc_parser, playwright_fetcher, sporttery_ref
from core.drain import (
    ASIAN_COMPANY, DEFAULT_COMPLETE_DATE, EURO_COMPANY, SUBTYPE,
    advance_complete_date, drain_date,
)
from core.odds_parser import fetch_euro_js_data, scrape_dual_odds, scrape_euro_from_oddslist
from core.workset import Workset, is_terminal
from pipelines import analysis_euro

# ─── 节奏参数 ─────────────────────────────────────────────────
ODD_INTERVAL = 30 * 60             # 常规 30 分钟
MIN_WAIT = 60                      # 最短睡眠 60 秒
MAX_WAIT = 2 * 60 * 60             # 最长睡眠 2 小时
DISCOVERY_BURST_STEP = 5 * 60      # 11:00~11:30 每 5 分钟
DISCOVERY_FALLBACK_STEP = 60 * 60  # 11:30 后每小时
OPEN_HOUR = 11                     # 开市时间
BACKUP_AFTER_KICKOFF_H = 1         # 兜底：开赛 +1h 抓一次终盘

BF_JC_URL = "http://jc.titan007.com/xml/bf_jc.txt"


# ─── 时间工具 ──────────────────────────────────────────────────

def _parse_iso(s) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


def _kickoff_dt(s) -> dt.datetime:
    try:
        return dt.datetime.strptime((s or "")[:16], "%Y-%m-%d %H:%M")
    except ValueError:
        return None


def _effective_stop(business_date: str, kickoff):
    """T 完全以开赛时间为基准（不再 min 停售）。"""
    return _kickoff_dt(kickoff)


def _add_days_str(date_str: str, days: int) -> str:
    d = dt.date.fromisoformat(date_str)
    return (d + dt.timedelta(days=days)).isoformat()


def _open_time(date_str: str) -> dt.datetime:
    d = dt.date.fromisoformat(date_str)
    return dt.datetime(d.year, d.month, d.day, OPEN_HOUR, 0, 0)


def _filter_prematch(changes: list, kickoff, sid) -> list:
    """亚盘/大小球赛前过滤：保留 change_time <= kickoff；转换失败保留；
    过滤后为空 → 保留全部 + log（赛前不缺失优先）。"""
    if not changes:
        return changes
    kd = _kickoff_dt(kickoff)
    if not kd:
        return changes
    kept = []
    for ch in changes:
        t = jc_db._infer_year(kickoff, ch.get("time"))
        if t is None:
            kept.append(ch)
            continue
        try:
            td = dt.datetime.strptime(t, "%Y-%m-%d %H:%M")
        except ValueError:
            kept.append(ch)
            continue
        if td <= kd:
            kept.append(ch)
    if not kept:
        print(f"  [odds] #{sid} 过滤后赛前为空，保留全部 {len(changes)} 条（容忍）")
        return changes
    return kept


# ─── 数据源抓取 ────────────────────────────────────────────────

def fetch_bf_jc() -> dict:
    """抓 bf_jc.txt（当日在售），返回 parse_jc_result 结构（business_date 取自 field[21]）。"""
    req = __import__("urllib.request", fromlist=["Request", "urlopen"]).Request(
        BF_JC_URL, headers={"User-Agent": jc_parser._UA, "Referer": jc_parser.JC_REFERER,
                            "Accept": "text/html,*/*"})
    with __import__("urllib.request", fromlist=["urlopen"]).urlopen(req, timeout=30) as resp:
        raw = resp.read()
    text = raw.decode("utf-8", errors="replace")
    today = dt.date.today().isoformat()
    return jc_parser.parse_jc_result(text, today)


def fetch_jc_result(date: str) -> dict:
    text = jc_parser.fetch_jc_result(date)
    if not text:
        return None
    return jc_parser.parse_jc_result(text, date)


# ─── 单场爬取 ──────────────────────────────────────────────────

def _crawl_analysis(ws: Workset, m: dict) -> bool:
    """analysis 抓一次（titan 为主 + nowscore 补 media），存 matches/{sid}.json。"""
    data = analysis_euro.fetch_analysis(m.get("sid"), m)
    if data is None:
        return False
    matches_dict, h2h, rh, ra = data
    jf = ws.read_match(m["sid"]) or ws.new_match_file(m["sid"], m["business_date"], m.get("kickoff"))
    jf["detail"]["analysis"] = {
        "matches": matches_dict, "h2h": h2h, "recent_home": rh, "recent_away": ra,
    }
    ws.save_match(jf)
    return True


def _crawl_odds(ws: Workset, m: dict, now: dt.datetime) -> None:
    """爬一场 odds = 2 次抓取（亚大澳门 / 欧赔威廉希尔），仅全场。

    亚盘/大小球存前做赛前时间过滤；欧赔不过滤。
    """
    if not m.get("first_odds_at"):
        m["first_odds_at"] = now.isoformat()
    sid = m["sid"]
    both = scrape_dual_odds(sid, ASIAN_COMPANY, is_half=False)
    jf = ws.read_match(sid) or ws.new_match_file(sid, m["business_date"], m.get("kickoff"))
    odds = jf["detail"].setdefault("odds", {})
    if both.get("asian") and both["asian"].changes:
        odds["asian"] = _filter_prematch(both["asian"].changes, m.get("kickoff"), sid)
    if both.get("over_under") and both["over_under"].changes:
        odds["over_under"] = _filter_prematch(both["over_under"].changes, m.get("kickoff"), sid)
    js = fetch_euro_js_data(sid)
    if js:
        item = scrape_euro_from_oddslist(sid, EURO_COMPANY, js)
        if item and item.changes:
            odds["european"] = item.changes
    jf["last_odds_at"] = now.isoformat()
    m["last_odds_at"] = now.isoformat()
    ws.save_match(jf)


# ─── 常驻服务 ──────────────────────────────────────────────────

class JcWorksetService:
    def __init__(self, dry_run: bool = False):
        self.ws = Workset()
        self.running = False
        self.dry_run = dry_run

    # ─── 生命周期 ────────────────────────────────────────────

    def start(self) -> None:
        self.ws.load()
        if self.ws.complete_date is None:
            self.ws.set_complete_date(DEFAULT_COMPLETE_DATE)
            if not self.dry_run:
                self.ws.save()
        self.running = True
        print("[JC-Workset] workset 驱动实时爬虫已启动")
        self.loop()

    def stop(self) -> None:
        self.running = False

    def loop(self) -> None:
        while self.running:
            try:
                next_due = self._cycle(dt.datetime.now())
                wait = min(MAX_WAIT, max(MIN_WAIT, (next_due - dt.datetime.now()).total_seconds()))
                time.sleep(wait)
            except Exception as e:  # noqa: BLE001
                print(f"[JC-Workset] 周期异常: {e}")
                try:
                    playwright_fetcher.close()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(60)

    # ─── cycle ───────────────────────────────────────────────

    def _cycle(self, now: dt.datetime) -> dt.datetime:
        self.ws.load()
        if self.ws.complete_date is None:
            self.ws.set_complete_date(DEFAULT_COMPLETE_DATE)

        if self.ws.total_matches() == 0:
            return self._discovery_cycle(now)

        self._normal_cycle(now)

        if self.ws.total_matches() == 0:
            return self._next_discovery_at(now)
        return self._next_wake(now)

    # ─── DISCOVERY（workset 空 → 扫 [completeDate+1 .. 今天]，只读一次）──

    def _discovery_cycle(self, now: dt.datetime) -> dt.datetime:
        self.ws.prune_empty_dates()
        targets = self.discovery_targets(now)
        if not targets:
            return self._next_day_open(now)
        print(f"[discovery] 区间 {targets[0]} ~ {targets[-1]}")
        for date in reversed(targets):   # 从今天往前
            try:
                self._discover_date(date, now)
            except Exception as e:  # noqa: BLE001
                print(f"[discovery] {date} 失败: {e}")
                try:
                    playwright_fetcher.close()
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(random.uniform(1.0, 3.0))
        if not self.dry_run:
            self.ws.save()
        return self._next_discovery_at(now)

    def _discover_date(self, date: str, now: dt.datetime) -> None:
        """每业务日只读一次赛程：今天用 bf_jc（在售），历史日用 JcResult（赛程列表）。"""
        if self.dry_run:
            return
        today = now.date().isoformat()
        if date == today:
            try:
                bf = fetch_bf_jc()
            except Exception as e:  # noqa: BLE001
                print(f"[discovery] bf_jc 失败: {e}")
                return
            if bf:
                for m in bf.get("matches", []):
                    self._upsert_with_anchor(m, now)
        else:
            res = fetch_jc_result(date)
            if res:
                for m in res.get("matches", []):
                    self._upsert_with_anchor(m, now)

    def discovery_targets(self, now: dt.datetime) -> list:
        today = now.date().isoformat()
        base = self.ws.complete_date or DEFAULT_COMPLETE_DATE
        out = []
        cur = _add_days_str(base, 1)
        while cur <= today:
            out.append(cur)
            cur = _add_days_str(cur, 1)
        return out

    def _next_day_open(self, now: dt.datetime) -> dt.datetime:
        return _open_time(_add_days_str(now.date().isoformat(), 1))

    def _next_discovery_at(self, now: dt.datetime) -> dt.datetime:
        if not self.discovery_targets(now):
            return self._next_day_open(now)
        open_ = _open_time(now.date().isoformat())
        if now < open_:
            return open_
        if (now - open_).total_seconds() < 30 * 60:
            return now + dt.timedelta(seconds=DISCOVERY_BURST_STEP)
        return now + dt.timedelta(seconds=DISCOVERY_FALLBACK_STEP)

    def _upsert_with_anchor(self, m: dict, now: dt.datetime):
        self.ws.upsert_match(m)
        wm = self.ws.matches_of(m.get("business_date")).get(str(m.get("sid")))
        if wm and not wm.get("first_odds_at"):
            wm["first_odds_at"] = now.isoformat()
        return wm

    # ─── NORMAL ──────────────────────────────────────────────

    def _normal_cycle(self, now: dt.datetime) -> None:
        # 1) 赔率：每场独立时间表（T = 开赛时间）
        for date in self.ws.dates():
            for m in list(self.ws.matches_of(date).values()):
                if is_terminal(m):
                    continue
                due = self._next_odds_due(m, now)
                if due is None or due > now:
                    continue
                try:
                    self._poll_odds(m, now)
                except Exception as e:  # noqa: BLE001
                    print(f"[odds] #{m['sid']} 失败: {e}")
                    try:
                        playwright_fetcher.close()
                    except Exception:  # noqa: BLE001
                        pass
                time.sleep(random.uniform(1.0, 3.0))

        # 2) analysis：只抓一次
        for date in self.ws.dates():
            for m in list(self.ws.matches_of(date).values()):
                if m.get("analysis_done"):
                    continue
                if self.dry_run:
                    print(f"  [analysis] #{m['sid']}")
                    m["analysis_done"] = True
                    continue
                try:
                    ok = _crawl_analysis(self.ws, m)
                    if ok:
                        m["analysis_done"] = True
                except Exception as e:  # noqa: BLE001
                    print(f"[analysis] #{m['sid']} 失败: {e}")
                time.sleep(random.uniform(1.0, 3.0))

        # 3) 兜底：开赛 +1h 抓一次终盘（补赛前赔率）
        self._backup_odds(now)

        # 4) 排干（sporttery.completeDate >= 业务日 且 数据齐）
        drained = []
        sporttery_cd = None if self.dry_run else sporttery_ref.get_complete_date()
        for date in self.ws.dates():
            if sporttery_cd is None or date > sporttery_cd:
                continue
            if self.dry_run:
                drained.append(date)
                continue
            self._fill_results_at_drain(date)
            ok = drain_date(self.ws, date)
            if ok:
                self.ws.delete_match_files(date)
                self.ws.remove_date(date)
                drained.append(date)
                print(f"[drain] {date} 导入并排干")
            else:
                self.ws.increment_attempts(date)
                print(f"[drain] {date} 未通过复核，保留重试")
            time.sleep(random.uniform(1.0, 3.0))

        if drained:
            advance_complete_date(self.ws, drained)
        if not self.dry_run:
            self.ws.save()

    def _backup_odds(self, now: dt.datetime) -> None:
        """兜底：每场 kickoff + 1h 抓一次终盘，补赛前赔率。"""
        for date in self.ws.dates():
            for m in list(self.ws.matches_of(date).values()):
                if m.get("backup_done"):
                    continue
                kickoff = _kickoff_dt(m.get("kickoff"))
                if not kickoff or now < kickoff + dt.timedelta(hours=BACKUP_AFTER_KICKOFF_H):
                    continue
                if self.dry_run:
                    print(f"  [backup] #{m['sid']}")
                    m["backup_done"] = True
                    continue
                try:
                    self._poll_odds(m, now)
                    m["backup_done"] = True
                    print(f"[backup] #{m['sid']} 开赛+1h 终盘")
                except Exception as e:  # noqa: BLE001
                    print(f"[backup] #{m['sid']} 失败: {e}")
                    try:
                        playwright_fetcher.close()
                    except Exception:  # noqa: BLE001
                        pass
                time.sleep(random.uniform(1.0, 3.0))

    # ─── 每场独立赔率时间表（T = 开赛时间）─────────────────

    def _next_odds_due(self, m: dict, now: dt.datetime):
        if is_terminal(m):
            return None
        if not m.get("first_odds_at"):
            return now                     # 未排程 → 立即首抓
        first_at = _parse_iso(m["first_odds_at"])
        t = _effective_stop(m.get("business_date"), m.get("kickoff"))
        if t is None:
            return None
        if not m.get("last_odds_at"):
            return min(first_at, now)      # 首抓在进场时刻
        return self._next_odds_point(_parse_iso(m["last_odds_at"]), first_at, t)

    def _next_odds_point(self, prev_at, first_at, t):
        """常规 30 分钟格（firstAt + 30m·k，取 ≤ T-1h）+ 关键点 T-1h/T-30/T-15/T-5/T。
        返回 > prev_at 的最小下一格；走完返回 None。"""
        cands = []
        t_minus_1h = t - dt.timedelta(minutes=60)
        slot = first_at
        while slot <= prev_at:
            slot += dt.timedelta(seconds=ODD_INTERVAL)
        while slot <= t_minus_1h:
            cands.append(slot)
            slot += dt.timedelta(seconds=ODD_INTERVAL)
        for off in (60 * 60, 30 * 60, 15 * 60, 5 * 60, 0):
            p = t - dt.timedelta(seconds=off)
            if p > prev_at:
                cands.append(p)
        cands.sort()
        return cands[0] if cands else None

    def _poll_odds(self, m: dict, now: dt.datetime) -> None:
        if self.dry_run:
            print(f"  [odds] #{m['sid']} poll")
            if not m.get("first_odds_at"):
                m["first_odds_at"] = now.isoformat()
            m["last_odds_at"] = now.isoformat()
            return
        _crawl_odds(self.ws, m, now)

    # ─── 排干前的赛果填充（titan JcResult 一次 + sporttery Refund 兜底）──

    def _fill_results_at_drain(self, date: str) -> None:
        """排干时拉一次 titan 当日 JcResult 填赛果（含半场比分）。

        - 出现在 JcResult（正常完赛）→ status=-1 + 全场/半场比分 + home/away_score
        - 未出现（无效/取消）→ 查 sporttery：Refund → -10/-1:-1；其他 → 记 pending
        - 覆盖对齐：sporttery 有而 titan 无 → 记 pending（可多不可少）
        """
        if self.dry_run:
            return
        jr = fetch_jc_result(date)
        by_sid = {str(m["sid"]): m for m in (jr.get("matches", []) if jr else [])}
        results = sporttery_ref.get_day_results(date)   # {match_num: {pool_status, ...}}
        matches = self.ws.matches_of(date)
        for m in list(matches.values()):
            r = by_sid.get(str(m.get("sid")))
            if r:
                m["status"] = -1
                m["full_score"] = r.get("full_score")
                m["half_score"] = r.get("half_score")
                m["home_score"], m["away_score"] = jc_db._parse_score(r.get("full_score"))
            else:
                sp = results.get(m.get("match_num"))
                if sp and sp["pool_status"] == "Refund":
                    m["status"] = -10
                    m["full_score"] = "-1:-1"
                    m["half_score"] = None
                    m["home_score"], m["away_score"] = -1, -1
                else:
                    sporttery_ref.append_pending(
                        m["sid"], date, m.get("match_num"), m.get("home_team"), m.get("away_team"),
                        m.get("kickoff"), "JcResult 无该场且 sporttery 非 Refund，待核查",
                        sp.get("pool_status") if sp else None)
            self.ws.upsert_match(m)
        # 覆盖对齐：sporttery 有而 titan 无 → 记 pending（可多不可少）
        titan_nums = {m.get("match_num") for m in matches.values()}
        for mn in results:
            if mn not in titan_nums:
                sporttery_ref.append_pending(
                    f"cov-{date}-{mn}", date, mn, None, None, None,
                    "覆盖对齐缺场次：sporttery 有而 titan 无", results[mn]["pool_status"])

    # ─── 下一唤醒 ────────────────────────────────────────────

    def _next_wake(self, now: dt.datetime) -> dt.datetime:
        next_ = now + dt.timedelta(seconds=MAX_WAIT)
        for date in self.ws.dates():
            for m in self.ws.matches_of(date).values():
                if is_terminal(m):
                    continue
                due = self._next_odds_due(m, now)
                if due is not None:
                    next_ = min(next_, due)
                if not m.get("backup_done"):
                    kickoff = _kickoff_dt(m.get("kickoff"))
                    if kickoff:
                        next_ = min(next_, kickoff + dt.timedelta(hours=BACKUP_AFTER_KICKOFF_H))
        return next_


# ─── CLI ───────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="jc workset 每日自动化（常驻 daemon）")
    p.add_argument("--once", action="store_true", help="跑一个 cycle 后退出（测试）")
    p.add_argument("--dry-run", action="store_true", help="不联网不写库不落盘（仅测试状态机）")
    p.add_argument("--now", default=None, help="覆盖当前时间 YYYY-MM-DD HH:MM（配合 --once）")
    args = p.parse_args()

    service = JcWorksetService(dry_run=args.dry_run)

    if args.once:
        now = dt.datetime.strptime(args.now, "%Y-%m-%d %H:%M") if args.now else dt.datetime.now()
        service.ws.load()
        if service.ws.complete_date is None:
            service.ws.set_complete_date(DEFAULT_COMPLETE_DATE)
        if service.ws.total_matches() == 0:
            service._discovery_cycle(now)
        else:
            service._normal_cycle(now)
        print(f"cycle done. completeDate={service.ws.complete_date} "
              f"dates={service.ws.dates()} total={service.ws.total_matches()}")
    else:
        service.start()


if __name__ == "__main__":
    main()
