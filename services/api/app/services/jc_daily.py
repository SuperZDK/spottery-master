"""竞彩日赛查询：workset+matches JSON 与 sporttery 源库 双源。

判据（business_date 排干状态）：
- business_date ∈ workset.dates          → workset 模式（读 JSON）
- business_date <= workset.completeDate  → DB 模式（读 sporttery 源库）
- 其他（未来/空）                          → 空列表
"""
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from app.cache import TTLCache
from app.config import get_settings
from app.db import sporttery_engine
from app.schemas.matches import (
    BetOption,
    DailyMatch,
    DailyMatchesResponse,
    MatchOdds,
    Odds3,
    RqSpfOdds,
)

WEEKDAYS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

# ── 多选池的 label 映射（与旧 import_jingcai.py 保持一致）────────────
CRS_LABELS = {"s-1sh": "胜其他", "s-1sd": "平其他", "s-1sa": "负其他"}
_CRS_RE = re.compile(r"^s(\d+)s(\d+)$")
TTG_LABELS = {f"s{i}": f"{i}球" for i in range(7)}
TTG_LABELS["s7"] = "7+球"
HAFU_LABELS = {
    "hh": "胜-胜", "hd": "胜-平", "ha": "胜-负",
    "dh": "平-胜", "dd": "平-平", "da": "平-负",
    "ah": "负-胜", "ad": "负-平", "aa": "负-负",
}
_EXCLUDE_KEYS = ("updateDate", "updateTime", "goalLine")


# ── 通用 helper ─────────────────────────────────────────────────────
def _num(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        n = float(v)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _crs_label(key: str) -> str:
    if key in CRS_LABELS:
        return CRS_LABELS[key]
    m = _CRS_RE.match(key)
    if m:
        return f"{int(m.group(1))}:{int(m.group(2))}"
    return key


def _opts(options: Dict[str, Any], label_map: Any = None) -> List[BetOption]:
    out: List[BetOption] = []
    for k, v in options.items():
        if k.endswith("f") or k in _EXCLUDE_KEYS:
            continue
        val = _num(v)
        if val is None:
            continue
        if callable(label_map):
            label = label_map(k)
        elif isinstance(label_map, dict):
            label = label_map.get(k, k)
        else:
            label = _crs_label(k)
        out.append(BetOption(label=label, odds=val))
    return out


def _derive_status(pool_status: Optional[str], match_result: Any, kickoff: Any) -> str:
    if match_result:
        return "FINISHED"
    if pool_status == "Refund":
        return "CANCELLED"
    if pool_status == "Payout":
        return "FINISHED"
    if kickoff:
        try:
            kt = datetime.fromisoformat(str(kickoff).replace("T", " "))
            if kt <= datetime.now():
                return "LIVE"
        except ValueError:
            pass
    return "SCHEDULED"


def _single_map(single_list: List[Any]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for s in single_list or []:
        code = s.get("poolCode")
        if code:
            out[code] = int(s.get("single") or 0)
    return out


def _singles_from_db(row) -> Dict[str, int]:
    return {
        "spf": row.single_spf or 0,
        "rqspf": row.single_rqspf or 0,
        "ttg": row.single_ttg or 0,
        "hafu": row.single_hafu or 0,
        "crs": row.single_crs or 0,
    }


def _singles_from_workset(singles: Dict[str, int]) -> Dict[str, int]:
    key = {"HAD": "spf", "HHAD": "rqspf", "TTG": "ttg", "HAFU": "hafu", "CRS": "crs"}
    return {short: int(singles.get(code, 0)) for code, short in key.items()}


# ── workset 模式 ────────────────────────────────────────────────────
def _latest_of(lst: Optional[List[Any]]) -> Optional[Dict[str, Any]]:
    if not lst:
        return None
    return lst[-1]


def _match_from_json(m: Dict[str, Any]) -> Optional[DailyMatch]:
    match_id = int(m["matchId"])
    detail = _load_detail(match_id)
    if not detail:
        # workset 有但详情未抓取：SPF/RQSPF 用 workset 自身赔率兜底
        odds = MatchOdds(
            spf=_three_from_workset(m.get("had")),
            rqspf=_rqspf_from_workset(m.get("handicap")),
        )
        return DailyMatch(
            match_id=match_id,
            match_num=m.get("matchNum", ""),
            league=m.get("league", ""),
            home_team=m.get("homeTeam", ""),
            away_team=m.get("awayTeam", ""),
            kickoff_time=m.get("kickoffTime") or "",
            status=_derive_status(m.get("poolStatus"), m.get("matchResult"), m.get("kickoffTime")),
            home_score=None,
            away_score=None,
            singles=_singles_from_workset({}),
            odds=odds,
        )

    inner = detail.get("detail", {}).get("oddsHistory", {}).get("oddsHistory", {})
    had = _latest_of(inner.get("hadList"))
    hhad = _latest_of(inner.get("hhadList"))
    ttg = _latest_of(inner.get("ttgList"))
    hafu = _latest_of(inner.get("hafuList"))
    crs = _latest_of(inner.get("crsList"))
    singles = _single_map(inner.get("singleList"))

    spf = Odds3(home=_num(had.get("h")), draw=_num(had.get("d")), away=_num(had.get("a"))) if had else None
    rqspf = None
    if hhad:
        rqspf = RqSpfOdds(
            home=_num(hhad.get("h")),
            draw=_num(hhad.get("d")),
            away=_num(hhad.get("a")),
            goal_line=hhad.get("goalLine") or None,
        )

    odds = MatchOdds(
        spf=spf,
        rqspf=rqspf,
        ttg=_opts(ttg, TTG_LABELS) if ttg else None,
        hafu=_opts(hafu, HAFU_LABELS) if hafu else None,
        crs=_opts(crs) if crs else None,
    )

    # matchResult 形如 "1:0"
    home_score = away_score = None
    mr = m.get("matchResult") or ""
    if mr:
        parts = str(mr).split(":")
        if len(parts) == 2:
            try:
                home_score, away_score = int(parts[0]), int(parts[1])
            except ValueError:
                pass

    return DailyMatch(
        match_id=match_id,
        match_num=m.get("matchNum", ""),
        league=m.get("league", ""),
        home_team=m.get("homeTeam", ""),
        away_team=m.get("awayTeam", ""),
        kickoff_time=m.get("kickoffTime") or "",
        status=_derive_status(m.get("poolStatus"), m.get("matchResult"), m.get("kickoffTime")),
        home_score=home_score,
        away_score=away_score,
        singles=_singles_from_workset(singles),
        odds=odds,
    )


def _three_from_workset(w: Optional[Dict[str, Any]]) -> Optional[Odds3]:
    if not w or not w.get("odds"):
        return None
    o = w["odds"]
    return Odds3(home=_num(o.get("home")), draw=_num(o.get("draw")), away=_num(o.get("away")))


def _rqspf_from_workset(h: Optional[Dict[str, Any]]) -> Optional[RqSpfOdds]:
    if not h or not h.get("odds"):
        return None
    o = h["odds"]
    return RqSpfOdds(
        home=_num(o.get("home")),
        draw=_num(o.get("draw")),
        away=_num(o.get("away")),
        goal_line=h.get("goalLine") or None,
    )


_matches_dir: Optional[Path] = None


def _load_detail(match_id: int) -> Optional[Dict[str, Any]]:
    global _matches_dir
    if _matches_dir is None:
        _matches_dir = Path(get_settings().sporttery_matches)
    p = _matches_dir / f"{match_id}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _load_workset() -> Optional[Dict[str, Any]]:
    p = Path(get_settings().sporttery_workset)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _query_workset(business_date: str) -> List[DailyMatch]:
    ws = _load_workset()
    if not ws:
        return []
    day = ws.get("dates", {}).get(business_date)
    if not day:
        return []
    out: List[DailyMatch] = []
    for m in day.get("matches", []):
        dm = _match_from_json(m)
        if dm:
            out.append(dm)
    out.sort(key=lambda x: x.match_num)
    return out


# ── DB 模式 ─────────────────────────────────────────────────────────
_db_daily_cache: "TTLCache[List[DailyMatch]]" = TTLCache(ttl=86400)


def _query_db(business_date: str) -> List[DailyMatch]:
    cached = _db_daily_cache.get(business_date)
    if cached is not None:
        return cached
    with sporttery_engine.connect() as conn:
        rows = conn.execute(
            text(
                """SELECT match_id, business_date, match_date, match_num, home_team, away_team, league,
                          home_score, away_score, pool_status, kickoff_time,
                          single_spf, single_rqspf, single_ttg, single_hafu, single_crs
                   FROM jingcai_schedules
                   WHERE business_date = :d
                   ORDER BY match_num"""
            ),
            {"d": business_date},
        ).mappings().all()
        if not rows:
            return []

        match_ids = [r["match_id"] for r in rows]
        latest = _latest_odds(conn, match_ids)

    out: List[DailyMatch] = []
    for r in rows:
        odds = latest.get(r["match_id"], {})
        out.append(
            DailyMatch(
                match_id=r["match_id"],
                match_num=r["match_num"],
                league=r["league"] or "",
                home_team=r["home_team"],
                away_team=r["away_team"],
                kickoff_time=_dt_str(r["kickoff_time"]),
                status=_derive_status(r["pool_status"], r["home_score"], r["kickoff_time"]),
                home_score=r["home_score"],
                away_score=r["away_score"],
                singles={
                    "spf": r["single_spf"] or 0,
                    "rqspf": r["single_rqspf"] or 0,
                    "ttg": r["single_ttg"] or 0,
                    "hafu": r["single_hafu"] or 0,
                    "crs": r["single_crs"] or 0,
                },
                odds=odds,
            )
        )
    if out:
        _db_daily_cache.set(business_date, out)
    return out


def _dt_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    return str(v)


def _latest_odds(conn, match_ids: List[int]) -> Dict[int, MatchOdds]:
    """一次性取 5 池每场最后快照。"""
    result: Dict[int, MatchOdds] = {mid: MatchOdds() for mid in match_ids}
    ids_sql = ", ".join(str(i) for i in match_ids)

    def last(table: str, cols: str) -> List[Dict[str, Any]]:
        return conn.execute(
            text(
                f"""SELECT DISTINCT ON (match_id) match_id, {cols}
                    FROM {table}
                    WHERE match_id IN ({ids_sql})
                    ORDER BY match_id, snapshot_at DESC"""
            )
        ).mappings().all()

    for row in last("jingcai_odds_spf", "odds_home, odds_draw, odds_away"):
        result[row["match_id"]].spf = Odds3(home=row["odds_home"], draw=row["odds_draw"], away=row["odds_away"])
    for row in last("jingcai_odds_rqspf", "goal_line, odds_home, odds_draw, odds_away"):
        result[row["match_id"]].rqspf = RqSpfOdds(
            home=row["odds_home"], draw=row["odds_draw"], away=row["odds_away"], goal_line=str(row["goal_line"]) if row["goal_line"] is not None else None
        )
    for row in last("jingcai_odds_ttg", "odds_0, odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7"):
        result[row["match_id"]].ttg = [
            BetOption(label=TTG_LABELS[f"s{i}"], odds=row[f"odds_{i}"]) for i in range(8) if row[f"odds_{i}"] is not None
        ]
    for row in last("jingcai_odds_hafu", "odds_hh, odds_hd, odds_ha, odds_dh, odds_dd, odds_da, odds_ah, odds_ad, odds_aa"):
        items = []
        for k, label in HAFU_LABELS.items():
            v = row[f"odds_{k}"]
            if v is not None:
                items.append(BetOption(label=label, odds=v))
        result[row["match_id"]].hafu = items
    for row in last("jingcai_odds_crs", _CRS_COLS_SQL):
        items = []
        for col, v in row.items():
            if col == "match_id" or v is None:
                continue
            key = col.replace("odds_", "")
            label = _crs_label(key) if key.startswith("s") else key
            items.append(BetOption(label=label, odds=v))
        result[row["match_id"]].crs = items
    return result


_CRS_COLS_SQL = "odds_s00s00, odds_s00s01, odds_s00s02, odds_s00s03, odds_s00s04, odds_s00s05, odds_s01s00, odds_s01s01, odds_s01s02, odds_s01s03, odds_s01s04, odds_s01s05, odds_s02s00, odds_s02s01, odds_s02s02, odds_s02s03, odds_s02s04, odds_s02s05, odds_s03s00, odds_s03s01, odds_s03s02, odds_s03s03, odds_s03s04, odds_s03s05, odds_s04s00, odds_s04s01, odds_s04s02, odds_s04s03, odds_s04s04, odds_s04s05, odds_s05s05, \"odds_s-1sh\", \"odds_s-1sd\", \"odds_s-1sa\""


def get_daily(business_date: str) -> DailyMatchesResponse:
    """业务日（business_date）日赛查询。"""
    ws = _load_workset()
    # isoweekday: 周一=1...周日=7；WEEKDAYS_CN[0]="周日"，故取 %7
    weekday = WEEKDAYS_CN[date.fromisoformat(business_date).isoweekday() % 7]

    if ws and business_date in ws.get("dates", {}):
        matches = _query_workset(business_date)
        return DailyMatchesResponse(date=business_date, weekday=weekday, source="workset", matches=matches)

    if ws and business_date <= ws.get("completeDate", ""):
        matches = _query_db(business_date)
        return DailyMatchesResponse(date=business_date, weekday=weekday, source="db", matches=matches)

    return DailyMatchesResponse(date=business_date, weekday=weekday, source="empty", matches=[])
