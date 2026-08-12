"""比赛详情：统一详情接口 /matches/{id}?source=... 的数据装配。

双源判据（与 jc_daily.get_daily 一致，按排干状态决定数据源）：
- 该场次仍在 workset（在售，未排干）→ workset 模式：读 crawler-sporttery JSON
- 已排干（业务日 <= completeDate）→ DB 模式：读 sporttery 源库
- 两处均无 → 404

- (id, source) → core.cross_source_matches 反查 jc_match_id
- source=jingcai 直接用 id；titan/sofascore 通过跨源映射表反查
- titan/sofascore 域数据（情报/统计等）后续按同接口分域接入
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from app.cache import TTLCache
from app.db import core_engine, sporttery_engine, titan_engine
from app.schemas.matches import (
    Briefing,
    FormItem,
    H2HItem,
    MatchDetailResponse,
    MatchInfo,
    MatchOddsDetail,
    OddsHistoryPoint,
    OddsItem,
    StandingSnapshot,
    StandingsBlock,
    TeamFormBlock,
)

# titan 侧公司（crawler-titan 只落这两个公司）
ASIAN_COMPANY = 1       # 澳门
EURO_COMPANY = 115      # 威廉希尔
from app.services.jc_daily import _derive_status, _load_detail, _load_workset, _single_map, _singles_from_workset

# ── 多选池 label 映射（与 jc_daily.py 保持一致）────────────────────────
CRS_OTHER = {"s-1sh": "胜其他", "s-1sd": "平其他", "s-1sa": "负其他"}
TTG_LABELS = {f"s{i}": f"{i}球" for i in range(7)}
TTG_LABELS["s7"] = "7+球"
HAFU_LABELS = {
    "hh": "胜-胜", "hd": "胜-平", "ha": "胜-负",
    "dh": "平-胜", "dd": "平-平", "da": "平-负",
    "ah": "负-胜", "ad": "负-平", "aa": "负-负",
}

CRS_COLS = [
    "odds_s00s00", "odds_s00s01", "odds_s00s02", "odds_s00s03", "odds_s00s04", "odds_s00s05",
    "odds_s01s00", "odds_s01s01", "odds_s01s02", "odds_s01s03", "odds_s01s04", "odds_s01s05",
    "odds_s02s00", "odds_s02s01", "odds_s02s02", "odds_s02s03", "odds_s02s04", "odds_s02s05",
    "odds_s03s00", "odds_s03s01", "odds_s03s02", "odds_s03s03", "odds_s03s04", "odds_s03s05",
    "odds_s04s00", "odds_s04s01", "odds_s04s02", "odds_s04s03", "odds_s04s04", "odds_s04s05",
    "odds_s05s05",
    "odds_s-1sh", "odds_s-1sd", "odds_s-1sa",
]

TTG_COLS = [f"odds_{i}" for i in range(8)]
HAFU_COLS = [f"odds_{k}" for k in ("hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa")]


def _crs_label(col: str) -> str:
    key = col.replace("odds_", "")
    if key in CRS_OTHER:
        return CRS_OTHER[key]
    h, _, a = key[1:].partition("s")
    return f"{int(h)}:{int(a)}"


def _fmt_time(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    return str(v)


def _num(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _status(pool_status: Optional[str], home_score, away_score, kickoff) -> str:
    if pool_status == "Refund":
        return "CANCELLED"
    if home_score is not None and away_score is not None:
        return "FINISHED"
    return "SCHEDULED"


# ── workset 模式（在售场次，读 crawler-sporttery JSON）────────────────

def _find_in_workset(match_id: int) -> Optional[Dict[str, Any]]:
    """在 workset.json 里按 matchId 查找（在售/未排干场次必在此）。"""
    ws = _load_workset()
    if not ws:
        return None
    for day in (ws.get("dates") or {}).values():
        for m in day.get("matches") or []:
            if m.get("matchId") == match_id:
                return m
    return None


def _ws_time(item: Dict[str, Any]) -> Optional[str]:
    d = item.get("updateDate")
    t = item.get("updateTime")
    if d and t:
        return f"{d} {t}"
    return d or t or None


def _points_from_ws(items: List[Dict[str, Any]], kind: str) -> List[OddsHistoryPoint]:
    """把 matches/{id}.json 的 oddsHistory 列表转成统一 OddsHistoryPoint 序列。"""
    out: List[OddsHistoryPoint] = []
    for it in items or []:
        time = _ws_time(it)
        if kind == "SPF":
            out.append(OddsHistoryPoint(time=time, home=_num(it.get("h")), draw=_num(it.get("d")), away=_num(it.get("a"))))
        elif kind == "RQSPF":
            gl = it.get("goalLine")
            out.append(OddsHistoryPoint(
                time=time,
                home=_num(it.get("h")),
                draw=_num(it.get("d")),
                away=_num(it.get("a")),
                handicap=str(gl) if gl not in (None, "") else None,
            ))
        elif kind == "TTG":
            opts = {TTG_LABELS[f"s{i}"]: _num(it.get(f"s{i}")) for i in range(8) if it.get(f"s{i}") is not None}
            opts = {k: v for k, v in opts.items() if v is not None}
            out.append(OddsHistoryPoint(time=time, options=opts or None))
        elif kind == "HAFU":
            opts = {HAFU_LABELS[k]: _num(it.get(k)) for k in ("hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa") if it.get(k) is not None}
            opts = {k: v for k, v in opts.items() if v is not None}
            out.append(OddsHistoryPoint(time=time, options=opts or None))
        elif kind == "BF":
            opts = {}
            for k, v in it.items():
                if k in ("updateDate", "updateTime", "goalLine") or k.endswith("f"):
                    continue
                nv = _num(v)
                if nv is not None:
                    opts[_crs_label(k)] = nv
            out.append(OddsHistoryPoint(time=time, options=opts or None))
    return out


def _query_workset_detail(match_id: int) -> Optional[MatchDetailResponse]:
    """workset 模式：workset.json 比赛信息头 + matches/{id}.json 赔率全纪录。"""
    m = _find_in_workset(match_id)
    if m is None:
        return None

    detail = _load_detail(match_id)
    inner = {}
    if detail:
        inner = detail.get("detail", {}).get("oddsHistory", {}).get("oddsHistory", {}) or {}

    spf = _points_from_ws(inner.get("hadList"), "SPF")
    rqspf = _points_from_ws(inner.get("hhadList"), "RQSPF")
    ttg = _points_from_ws(inner.get("ttgList"), "TTG")
    hafu = _points_from_ws(inner.get("hafuList"), "HAFU")
    crs = _points_from_ws(inner.get("crsList"), "BF")

    if not spf and m.get("had", {}).get("odds"):
        o = m["had"]["odds"]
        spf = [OddsHistoryPoint(home=_num(o.get("home")), draw=_num(o.get("draw")), away=_num(o.get("away")))]
    if not rqspf and m.get("handicap", {}).get("odds"):
        h = m["handicap"]
        o = h["odds"]
        gl = h.get("goalLine")
        rqspf = [OddsHistoryPoint(
            home=_num(o.get("home")),
            draw=_num(o.get("draw")),
            away=_num(o.get("away")),
            handicap=str(gl) if gl not in (None, "") else None,
        )]

    current: List[OddsItem] = []
    if spf:
        current.append(_current_item(match_id, "SPF", spf, len(current)))
    if rqspf:
        current.append(_current_item(match_id, "RQSPF", rqspf, len(current)))

    odds = MatchOddsDetail(
        current=current,
        history={"SPF": spf, "RQSPF": rqspf, "BF": crs, "ZJQ": ttg, "BQC": hafu},
    )

    home_score = away_score = None
    mr = m.get("matchResult") or ""
    if mr:
        parts = str(mr).split(":")
        if len(parts) == 2:
            try:
                home_score, away_score = int(parts[0]), int(parts[1])
            except ValueError:
                pass

    match = MatchInfo(
        id=match_id,
        match_num=m.get("matchNum") or "",
        league=m.get("league") or "",
        home_team=m.get("homeTeam") or "",
        away_team=m.get("awayTeam") or "",
        home_score=home_score,
        away_score=away_score,
        half_score=None,
        match_time=m.get("kickoffTime") or None,
        status=_derive_status(m.get("poolStatus"), m.get("matchResult"), m.get("kickoffTime")),
        pool_status=m.get("poolStatus"),
        league_id=m.get("leagueId") or None,
        home_team_id=m.get("homeTeamId") or None,
        away_team_id=m.get("awayTeamId") or None,
        singles=_singles_from_workset(_single_map(inner.get("singleList"))),
    )
    return MatchDetailResponse(match=match, odds=odds, source="workset")


def resolve_jc_match_id(source: str, match_id: int) -> Optional[int]:
    """任意源 id → 竞彩 match_id；jingcai 直接用自身 id。"""
    if source == "jingcai":
        return match_id
    if source == "titan":
        where = "titan_jc_sid = :id OR titan_schedule_id = :id"
    elif source == "sofascore":
        where = "sofa_match_id = :id"
    else:
        return None
    with core_engine.connect() as conn:
        row = conn.execute(
            text(f"SELECT jc_match_id FROM cross_source_matches WHERE {where}"),
            {"id": match_id},
        ).mappings().first()
    if row is None:
        return None
    return row["jc_match_id"]


def _load_schedule(conn, match_id: int) -> Optional[dict]:
    row = conn.execute(
        text(
            """SELECT match_id, match_num, league, home_team, away_team,
                      home_score, away_score, pool_status, kickoff_time,
                      single_spf, single_rqspf, single_ttg, single_hafu, single_crs
               FROM jingcai_schedules
               WHERE match_id = :id"""
        ),
        {"id": match_id},
    ).mappings().first()
    if row is None:
        return None
    return dict(row)


def _load_series(conn, table: str, match_id: int, cols: list[str], handicap_col: Optional[str] = None) -> list[OddsHistoryPoint]:
    select_cols = cols + ([handicap_col] if handicap_col else [])
    col_sql = ", ".join(f'"{c}"' for c in select_cols)
    rows = conn.execute(
        text(f"SELECT snapshot_at, {col_sql} FROM {table} WHERE match_id = :id ORDER BY snapshot_at"),
        {"id": match_id},
    ).mappings().all()
    out: list[OddsHistoryPoint] = []
    for r in rows:
        options = None
        home = draw = away = None
        handicap = None
        if handicap_col:
            handicap = str(r[handicap_col]) if r[handicap_col] is not None else None
        if cols and cols[0].startswith("odds_s"):
            options = {_crs_label(c): _num(r[c]) for c in cols if r[c] is not None}
        elif cols == TTG_COLS:
            options = {TTG_LABELS[f"s{i}"]: _num(r[f"odds_{i}"]) for i in range(8) if r[f"odds_{i}"] is not None}
        elif cols == HAFU_COLS:
            options = {HAFU_LABELS[k]: _num(r[f"odds_{k}"]) for k in ("hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa") if r[f"odds_{k}"] is not None}
        else:
            home = _num(r.get("odds_home"))
            draw = _num(r.get("odds_draw"))
            away = _num(r.get("odds_away"))
        out.append(OddsHistoryPoint(
            time=_fmt_time(r["snapshot_at"]),
            home=home,
            draw=draw,
            away=away,
            handicap=handicap,
            options=options,
        ))
    return out


def _current_item(match_id: int, odds_type: str, points: list[OddsHistoryPoint], idx: int) -> OddsItem:
    first = points[0]
    last = points[-1]
    return OddsItem(
        id=idx + 1,
        match_id=match_id,
        bookmaker="竞彩",
        odds_type=odds_type,
        initial_home=first.home,
        initial_draw=first.draw,
        initial_away=first.away,
        current_home=last.home,
        current_draw=last.draw,
        current_away=last.away,
        update_time=last.time,
    )


def _load_odds(conn, match_id: int) -> MatchOddsDetail:
    history: dict[str, list[OddsHistoryPoint]] = {}
    current: list[OddsItem] = []

    spf = _load_series(conn, "jingcai_odds_spf", match_id, ["odds_home", "odds_draw", "odds_away"])
    rqspf = _load_series(conn, "jingcai_odds_rqspf", match_id, ["odds_home", "odds_draw", "odds_away"], handicap_col="goal_line")
    history["SPF"] = spf
    history["RQSPF"] = rqspf
    if spf:
        current.append(_current_item(match_id, "SPF", spf, len(current)))
    if rqspf:
        current.append(_current_item(match_id, "RQSPF", rqspf, len(current)))

    history["BF"] = _load_series(conn, "jingcai_odds_crs", match_id, CRS_COLS)
    history["ZJQ"] = _load_series(conn, "jingcai_odds_ttg", match_id, TTG_COLS)
    history["BQC"] = _load_series(conn, "jingcai_odds_hafu", match_id, HAFU_COLS)

    return MatchOddsDetail(current=current, history=history)


_db_detail_cache: "TTLCache[MatchDetailResponse]" = TTLCache(ttl=86400)


def _query_db_detail(jc_id: int) -> Optional[MatchDetailResponse]:
    cached = _db_detail_cache.get(jc_id)
    if cached is not None:
        return cached

    with sporttery_engine.connect() as conn:
        row = _load_schedule(conn, jc_id)
        if row is None:
            return None
        odds = _load_odds(conn, jc_id)

    match = MatchInfo(
        id=row["match_id"],
        match_num=row["match_num"] or "",
        league=row["league"] or "",
        home_team=row["home_team"] or "",
        away_team=row["away_team"] or "",
        home_score=row["home_score"],
        away_score=row["away_score"],
        half_score=None,
        match_time=_fmt_time(row["kickoff_time"]),
        status=_status(row["pool_status"], row["home_score"], row["away_score"], row["kickoff_time"]),
        pool_status=row["pool_status"],
        singles={
            "spf": row["single_spf"] or 0,
            "rqspf": row["single_rqspf"] or 0,
            "ttg": row["single_ttg"] or 0,
            "hafu": row["single_hafu"] or 0,
            "crs": row["single_crs"] or 0,
        },
    )
    detail = MatchDetailResponse(match=match, odds=odds, source="db")
    _db_detail_cache.set(jc_id, detail)
    return detail


# ── titan 域数据（titan_engine，schedule_id = titan_jc_sid）──────────

def resolve_titan_sid(jc_id: int) -> Optional[int]:
    """竞彩 match_id → titan_jc_sid（cross_source_matches 反查）。"""
    with core_engine.connect() as conn:
        row = conn.execute(
            text("SELECT titan_jc_sid FROM cross_source_matches WHERE jc_match_id = :id"),
            {"id": jc_id},
        ).mappings().first()
    if row is None:
        return None
    return row["titan_jc_sid"]


def _load_titan_analysis(sid: int) -> Optional[dict]:
    with titan_engine.connect() as conn:
        row = conn.execute(
            text(
                """SELECT competition_name_cn, home_team, away_team, standings,
                          media_analysis, confidence_index, h2h_record
                   FROM titan_analysis_matches
                   WHERE schedule_id = :id"""
            ),
            {"id": sid},
        ).mappings().first()
    return dict(row) if row else None


def _load_titan_h2h(sid: int) -> list[H2HItem]:
    with titan_engine.connect() as conn:
        rows = conn.execute(
            text(
                """SELECT match_date, home_team, away_team, home_score, away_score
                   FROM titan_analysis_h2h
                   WHERE schedule_id = :id
                   ORDER BY match_date DESC, id DESC
                   LIMIT 20"""
            ),
            {"id": sid},
        ).mappings().all()
    out: list[H2HItem] = []
    for r in rows:
        out.append(H2HItem(
            match_time=r["match_date"].isoformat() if r["match_date"] else None,
            home_team=r["home_team"],
            away_team=r["away_team"],
            home_score=r["home_score"],
            away_score=r["away_score"],
        ))
    return out


def _load_titan_recent(sid: int) -> TeamFormBlock:
    with titan_engine.connect() as conn:
        mrow = conn.execute(
            text("SELECT home_team, away_team FROM titan_analysis_matches WHERE schedule_id = :id"),
            {"id": sid},
        ).mappings().first()

        def _fetch(side: str) -> list[FormItem]:
            rows = conn.execute(
                text(
                    """SELECT match_date, home_team, away_team, home_score, away_score
                       FROM titan_analysis_recent
                       WHERE schedule_id = :id AND side = :side
                       ORDER BY match_date DESC, id DESC
                       LIMIT 10"""
                ),
                {"id": sid, "side": side},
            ).mappings().all()
            out: list[FormItem] = []
            tracked = mrow["home_team"] if side == "home" else mrow["away_team"]
            for r in rows:
                is_home = r["home_team"] == tracked
                out.append(FormItem(
                    match_time=r["match_date"].isoformat() if r["match_date"] else None,
                    opponent=r["away_team"] if is_home else r["home_team"],
                    is_home=is_home,
                    home_score=r["home_score"],
                    away_score=r["away_score"],
                ))
            return out

        home = _fetch("home")
        away = _fetch("away")
    return TeamFormBlock(home=home, away=away)


def _standing_snapshot(v: Any) -> Optional[StandingSnapshot]:
    if not v or not isinstance(v, dict):
        return None
    return StandingSnapshot(
        team_name=v.get("team_name"),
        position=v.get("rank"),
        points=v.get("points"),
        played=v.get("played"),
        wins=v.get("won"),
        draws=v.get("drawn"),
        losses=v.get("lost"),
        goals_for=v.get("goals_for"),
        goals_against=v.get("goals_against"),
        goal_diff=v.get("goal_diff"),
    )


def _load_titan_standings(sid: int) -> Optional[StandingsBlock]:
    analysis = _load_titan_analysis(sid)
    if not analysis or not analysis.get("standings"):
        return None
    standings = analysis["standings"]
    if not isinstance(standings, dict):
        return None
    return StandingsBlock(
        home=_standing_snapshot(standings.get("home_standing")),
        away=_standing_snapshot(standings.get("away_standing")),
    )


def _load_titan_briefing(sid: int) -> Optional[Briefing]:
    analysis = _load_titan_analysis(sid)
    if not analysis:
        return None
    # 旧 briefing_title/briefing_text 已删；现以 media_analysis（心水推荐正文）作为简报内容
    content = analysis.get("media_analysis")
    if not content:
        return None
    return Briefing(title=None, content=content)


def _load_titan_odds(sid: int) -> tuple[list[OddsHistoryPoint], list[OddsHistoryPoint]]:
    """返回 (欧赔历史, 亚盘历史)，均按 change_time 升序。"""
    euro: list[OddsHistoryPoint] = []
    with titan_engine.connect() as conn:
        rows = conn.execute(
            text(
                """SELECT change_time, home_win, draw, away_win
                   FROM titan_euro_odds
                   WHERE schedule_id = :id AND company_id = :cid
                   ORDER BY change_time"""
            ),
            {"id": sid, "cid": EURO_COMPANY},
        ).mappings().all()
        for r in rows:
            euro.append(OddsHistoryPoint(
                time=_fmt_time(r["change_time"]),
                home=_num(r["home_win"]),
                draw=_num(r["draw"]),
                away=_num(r["away_win"]),
            ))
    asian: list[OddsHistoryPoint] = []
    with titan_engine.connect() as conn:
        rows = conn.execute(
            text(
                """SELECT change_time, line_raw, home_odds, away_odds
                   FROM titan_asian_odds
                   WHERE schedule_id = :id AND company_id = :cid
                   ORDER BY change_time"""
            ),
            {"id": sid, "cid": ASIAN_COMPANY},
        ).mappings().all()
        for r in rows:
            asian.append(OddsHistoryPoint(
                time=_fmt_time(r["change_time"]),
                home=_num(r["home_odds"]),
                away=_num(r["away_odds"]),
                handicap=r["line_raw"],
            ))
    return euro, asian


def _titan_current_item(match_id: int, bookmaker: str, odds_type: str,
                        points: list[OddsHistoryPoint], idx: int) -> Optional[OddsItem]:
    if not points:
        return None
    first, last = points[0], points[-1]
    return OddsItem(
        id=idx + 1,
        match_id=match_id,
        bookmaker=bookmaker,
        odds_type=odds_type,
        initial_home=first.home,
        initial_draw=first.draw,
        initial_away=first.away,
        current_home=last.home,
        current_draw=last.draw,
        current_away=last.away,
        update_time=last.time,
    )


def _merge_titan(detail: Optional[MatchDetailResponse], jc_id: int) -> Optional[MatchDetailResponse]:
    """把 titan 域数据并入详情响应（可选模块，查不到返回 None/[]）。"""
    if detail is None:
        return None
    sid = resolve_titan_sid(jc_id)
    if sid is None:
        return detail

    detail.briefing = _load_titan_briefing(sid)
    detail.h2h = _load_titan_h2h(sid)
    detail.form = _load_titan_recent(sid)
    detail.standings = _load_titan_standings(sid)

    euro, asian = _load_titan_odds(sid)
    if euro:
        detail.odds.history["oupei"] = euro
        item = _titan_current_item(jc_id, "威廉希尔", "oupei", euro, len(detail.odds.current))
        if item is not None:
            detail.odds.current.append(item)
    if asian:
        detail.odds.history["yapan"] = asian
        item = _titan_current_item(jc_id, "澳门", "yapan", asian, len(detail.odds.current))
        if item is not None:
            detail.odds.current.append(item)
    return detail


def get_match_detail(match_id: int, source: str) -> Optional[MatchDetailResponse]:
    """统一详情入口。返回 None 表示该比赛不存在（路由层转 404）。"""
    jc_id = resolve_jc_match_id(source, match_id)
    if jc_id is None:
        return None

    ws_detail = _query_workset_detail(jc_id)
    if ws_detail is not None:
        return _merge_titan(ws_detail, jc_id)

    return _merge_titan(_query_db_detail(jc_id), jc_id)
