"""
Fetch titan analysis page (standings + h2h/recent) + nowscore media supplement.

仅服务 jc-workset 一条线：
  - titan 页提供 standings + 本场信息 + h2h/recent
  - nowscore 只补 media（心水推荐：趋势/盘路/信心指数/对赛成绩/正文）
  - titan 页失败 → 返回 None（不做 nowscore 完整回退）
"""
import datetime as dt
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import js_fetcher
from core import models
from core.parser import extract_analysis


def _normalize_date(d):
    """'15-12-30' / '2015-12-30' → 4-digit 'YYYY-MM-DD'。失败返回原值。"""
    if not d:
        return d
    s = str(d).strip()
    m = re.match(r"^(\d{2})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        y = int(m.group(1))
        if y < 100:
            year = 2000 + y
            if year > dt.date.today().year:
                year -= 100
        else:
            year = y
        try:
            return f"{year:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        except ValueError:
            return s
    return s


def analysis_to_dict(page: models.AnalysisPage) -> dict:
    """整页 → dict（standings + h2h/recent）。"""
    return {
        "h2h": [_h2h_to_dict(m) for m in page.h2h],
        "recent_home": [_recent_to_dict(m) for m in page.recent_home],
        "recent_away": [_recent_to_dict(m) for m in page.recent_away],
        "standings": _standings_to_dict(page.standings),
    }


def _recent_to_dict(m):
    return {
        "date": m.date, "comp_type": m.comp_type, "comp_name": m.comp_name,
        "home_team": m.home_team, "away_team": m.away_team,
        "home_team_id": m.home_team_id, "away_team_id": m.away_team_id,
        "home_score": m.home_score, "away_score": m.away_score,
        "full_score": m.full_score, "handicap": m.handicap,
        "schedule_id": m.schedule_id, "is_home_side": m.is_home_side,
    }


def _h2h_to_dict(m):
    return {
        "date": m.date, "comp_type": m.comp_type, "comp_name": m.comp_name,
        "home_team": m.home_team, "away_team": m.away_team,
        "home_team_id": m.home_team_id, "away_team_id": m.away_team_id,
        "home_score": m.home_score, "away_score": m.away_score,
        "full_score": m.full_score, "handicap": m.handicap,
        "schedule_id": m.schedule_id,
    }


def _standings_to_dict(st):
    if not st:
        return None
    return {
        "home_team": st.home_team, "away_team": st.away_team,
        "home_standing": _standing_row_to_dict(st.home_standing),
        "away_standing": _standing_row_to_dict(st.away_standing),
    }


def _standing_row_to_dict(sr):
    if not sr:
        return None
    return {
        "rank": sr.rank, "team_name": sr.team_name,
        "played": sr.played, "won": sr.won, "drawn": sr.drawn, "lost": sr.lost,
        "goals_for": sr.goals_for, "goals_against": sr.goals_against,
        "goal_diff": sr.goal_diff, "points": sr.points,
    }


def fetch_analysis(schedule_id: int, match_in: dict = None):
    """抓取并解析一场分析（titan 页 + nowscore 补 media），不写库。

    - titan 页提供：standings + 本场信息 + h2h/recent
    - nowscore 只补 media（心水推荐：趋势/盘路/信心指数/对赛成绩/正文）
    - titan 页失败 → 返回 None（不做完整回退 nowscore）

    返回 (matches, h2h, recent_home, recent_away) 或 None。
    供 workset 流程暂存 matches/{sid}.json，排干时统一写 DB。
    """
    page, raw_html = _fetch_titan_page(schedule_id)
    if not page:
        return None

    record = analysis_to_dict(page)
    m = {
        "competition_id": match_in.get("sclass_id") if match_in else None,
        "competition_name_en": match_in.get("competition_name_en") if match_in else None,
        "season": match_in.get("season") if match_in else None,
        "home_team_id": match_in.get("home_team_id") if match_in else None,
        "away_team_id": match_in.get("away_team_id") if match_in else None,
        "home_team": match_in.get("home_team") if match_in else None,
        "away_team": match_in.get("away_team") if match_in else None,
        "match_time": match_in.get("kickoff") if match_in else None,
        "standings": record.get("standings"),
    }
    h2h, rh, ra = _titan_record_to_rows(record)

    # nowscore 补 media（心水推荐，titan 页无此字段；尽力抓取，失败不阻塞）
    try:
        from core import ns_parser
        media = ns_parser.extract_media_only(schedule_id)
        if media:
            m.update(media)
    except Exception as e:  # noqa: BLE001
        print(f"    [nowscore media] {schedule_id} supplement error: {e}")

    # 野鸡赛过滤：黑名单（ignore_sclass）+ 开赛前 5 年（按 match_date 年份）
    try:
        from core import ns_parser as _np
        ref = None
        if match_in and match_in.get("kickoff"):
            try:
                ref = dt.date.fromisoformat(str(match_in["kickoff"])[:10])
            except ValueError:
                ref = None
        _ignore = _np.load_ignore_sclass()
        h2h = _np.filter_records(h2h, _ignore, ref)
        rh = _np.filter_records(rh, _ignore, ref)
        ra = _np.filter_records(ra, _ignore, ref)
    except Exception as e:  # noqa: BLE001
        print(f"    [filter] {schedule_id} filter error: {e}")

    return m, h2h, rh, ra


def _fetch_titan_page(schedule_id: int):
    """抓 titan 分析页并解析，返回 (page, html) 或 (None, None)。"""
    url = f"https://zq.titan007.com/analysis/{schedule_id}cn.htm"
    print(f"    Fetching titan analysis page: /analysis/{schedule_id}cn.htm")
    html = js_fetcher.fetch_url(url)
    if not html:
        print(f"    ERROR: Failed to fetch analysis page")
        return None, None
    try:
        page = extract_analysis(html)
        return page, html
    except Exception as e:  # noqa: BLE001
        print(f"    ERROR: titan analysis parse error: {e}")
        return None, None


def _titan_record_to_rows(record: dict) -> tuple:
    """analysis_to_dict 结果 → (h2h_rows, recent_home_rows, recent_away_rows)."""
    h2h = []
    for h in record.get("h2h") or []:
        h2h.append({
            "match_date": _normalize_date(h.get("date")),
            "sclass_id": h.get("comp_type"),
            "home_team": h.get("home_team"), "away_team": h.get("away_team"),
            "home_team_id": h.get("home_team_id"), "away_team_id": h.get("away_team_id"),
            "home_score": h.get("home_score"), "away_score": h.get("away_score"),
            "half_score": h.get("full_score"), "ref_schedule_id": h.get("schedule_id"),
        })
    rh = [_recent_to_row(m, "home") for m in (record.get("recent_home") or [])]
    ra = [_recent_to_row(m, "away") for m in (record.get("recent_away") or [])]
    return h2h, rh, ra


def _recent_to_row(m: dict, side: str) -> dict:
    return {
        "match_date": _normalize_date(m.get("date")), "sclass_id": m.get("comp_type"),
        "home_team": m.get("home_team"), "away_team": m.get("away_team"),
        "home_team_id": m.get("home_team_id"), "away_team_id": m.get("away_team_id"),
        "home_score": m.get("home_score"), "away_score": m.get("away_score"),
        "half_score": m.get("full_score"), "ref_schedule_id": m.get("schedule_id"),
    }
