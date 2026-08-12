"""
Parse analysis page HTML - extract JS variables and DOM elements.
Handles all template versions with version-specific column mappings.
"""
import re
from typing import Optional, Any
from . import models
from .version_detector import detect_version


# ──────────────────────────────────────────────
# JS array parsing utilities
# ──────────────────────────────────────────────

def _find_matching_bracket(text: str, start: int) -> int:
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '[':
            depth += 1
        elif text[i] == ']':
            depth -= 1
            if depth == 0:
                return i
    return -1


def extract_js_var_array(html: str, var_name: str) -> Optional[str]:
    """Extract the raw array text of a JS variable from HTML."""
    m = re.search(rf'{var_name}\s*=\s*(\[)', html, re.DOTALL)
    if not m:
        return None
    start = m.start(1)
    end = _find_matching_bracket(html, start)
    if end < 0:
        return None
    return html[start + 1:end]


def parse_js_2d(text: str) -> list:
    """Parse JS 2D array into Python list of lists. Input has outer brackets."""
    text = text.strip()
    if not text.startswith("[") or not text.endswith("]"):
        return []
    result = []
    inner = 1
    n = len(text)
    while inner < n:
        if text[inner] == '[':
            inner_start = inner + 1
            inner_end = _find_matching_bracket(text, inner)
            if inner_end < 0:
                break
            row_text = text[inner_start:inner_end]
            row = _parse_flat_array(row_text)
            if row:
                result.append(row)
            inner = inner_end + 1
        else:
            inner += 1
    return result


def _parse_flat_array(text: str) -> list:
    """Parse a flat JS array (e.g. 1,'abc',null) into Python list."""
    result = []
    token = ""
    in_str, str_char = False, None
    depth = 0
    for ch in text:
        if in_str:
            if ch == '\\':
                pass
            elif ch == str_char:
                in_str = False
            token += ch
        elif ch in ('"', "'"):
            in_str = True
            str_char = ch
            token += ch
        elif ch in '([':
            depth += 1
            token += ch
        elif ch in ')]':
            depth -= 1
            token += ch
        elif ch == ',' and depth == 0:
            result.append(_parse_val(token))
            token = ""
        else:
            token += ch
    if token.strip():
        result.append(_parse_val(token))
    return result


def _parse_val(token: str):
    token = token.strip()
    if not token:
        return None
    if (token.startswith("'") and token.endswith("'")) or \
       (token.startswith('"') and token.endswith('"')):
        return token[1:-1]
    if token in ("null", "undefined", ""):
        return None
    try:
        return int(token) if "." not in token else float(token)
    except ValueError:
        return token


# ──────────────────────────────────────────────
# Version-specific column mappings
# ──────────────────────────────────────────────

# h_data / a_data / h2_data / a2_data column indices
# These are the recent match result arrays

HDATA_V1 = {
    "cols": 16,
    "date": 0, "comp_type": 1, "comp_name": 2, "color": 3,
    "home_id": 4, "home_name": 5, "away_id": 6, "away_name": 7,
    "home_score": 8, "away_score": 9, "full_score": 10, "handicap": 11,
    "result1": 12, "result2": 13, "result3": 14, "schedule_id": 15,
}

HDATA_V1_5_TRANS = {
    "cols": 18,
    **HDATA_V1,
    "extra1": 16, "extra2": 17,
}

HDATA_V1_5 = {
    "cols": 20,
    **HDATA_V1,
    "extra1": 16, "extra2": 17, "rank_url": 18, "extra3": 19,
}

HDATA_V2 = {
    "cols": 20,
    "date": 0, "comp_type": 1, "comp_name": 2, "color": 3,
    "home_id": 4, "home_name": 5, "away_id": 6, "away_name": 7,
    "home_score": 8, "away_score": 9, "full_score": 10, "handicap": 11,
    "odds_result": 12, "home_red": 13, "away_red": 14, "schedule_id": 15,
    "home_rank": 16, "away_rank": 17, "rank_url": 18, "match_type": 19,
}

HDATA_V3 = {
    "cols": 20,
    **HDATA_V2,
}

HDATA_V3_1 = {
    "cols": 22,
    **HDATA_V2,
    "home_pos": 20, "away_pos": 21,
}

HDATA_MAP = {
    "V1": HDATA_V1,
    "V1.5_transition": HDATA_V1_5_TRANS,
    "V1.5": HDATA_V1_5,
    "V1.5c": HDATA_V1_5,
    "V2": HDATA_V2,
    "V2.5": HDATA_V2,
    "V3": HDATA_V3,
    "V3.1": HDATA_V3_1,
}


# v_data (head-to-head) has similar but simpler structure
VDATA_MAP = HDATA_MAP.copy()

# ──────────────────────────────────────────────
# Parse JS variables into structured data
# ──────────────────────────────────────────────

def parse_js_variables(html: str, version: str) -> dict:
    """Extract all JS variables from analysis page HTML."""
    js_vars = ["hometeam", "guestteam", "strTime", "scheduleID",
               "h_data", "a_data", "h2_data", "a2_data", "v_data"]

    result = {}
    for var in js_vars:
        raw = extract_js_var_array(html, var)
        if raw:
            if var in ("hometeam", "guestteam"):
                # Single string value: hometeam = '曼联'
                m = re.search(rf'{var}\s*=\s*["\']([^"\']+)["\']', html)
                result[var] = m.group(1) if m else None
            elif var == "strTime":
                m = re.search(rf'{var}\s*=\s*["\']([^"\']+)["\']', html)
                result[var] = m.group(1) if m else None
            elif var == "scheduleID":
                m = re.search(rf'{var}\s*=\s*["\']?(\d+)["\']?', html)
                result[var] = int(m.group(1)) if m else None
            else:
                parsed = parse_js_2d(f"[{raw}]")
                result[var] = parsed
        else:
            # Try non-array format for simple variables
            if var in ("hometeam", "guestteam"):
                m = re.search(rf'{var}\s*=\s*["\']([^"\']+)["\']', html)
                result[var] = m.group(1) if m else None
            elif var == "scheduleID":
                m = re.search(rf'{var}\s*=\s*["\']?(\d+)["\']?', html)
                result[var] = int(m.group(1)) if m else None
            else:
                result[var] = []

    return result


# ──────────────────────────────────────────────
# Convert raw JS arrays to model objects
# ──────────────────────────────────────────────

def parse_recent_matches(raw_data: list, version: str, is_home_side: bool) -> list:
    """Convert raw h_data/a_data arrays to RecentMatch objects."""
    col_map = HDATA_MAP.get(version, HDATA_V2)
    matches = []
    for row in raw_data:
        if not row or len(row) < 10:
            continue
        m = models.RecentMatch(
            date=_safe_get(row, col_map.get("date")),
            comp_type=_safe_get(row, col_map.get("comp_type"), 0),
            comp_name=_safe_get(row, col_map.get("comp_name"), ""),
            home_team=_strip_team(_safe_get(row, col_map.get("home_name"), "")),
            away_team=_strip_team(_safe_get(row, col_map.get("away_name"), "")),
            home_score=_safe_int(row, col_map.get("home_score")),
            away_score=_safe_int(row, col_map.get("away_score")),
            full_score=_safe_get(row, col_map.get("full_score"), ""),
            handicap=_safe_get(row, col_map.get("handicap"), ""),
            schedule_id=_safe_int(row, col_map.get("schedule_id")),
            home_team_id=_safe_int(row, col_map.get("home_id")),
            away_team_id=_safe_int(row, col_map.get("away_id")),
            is_home_side=is_home_side,
            extra={},
        )
        matches.append(m)
    return matches


def parse_h2h(raw_data: list, version: str) -> list:
    """Convert raw v_data array to H2HMatch objects."""
    col_map = HDATA_MAP.get(version, HDATA_V2)
    matches = []
    for row in raw_data:
        if not row or len(row) < 10:
            continue
        m = models.H2HMatch(
            date=_safe_get(row, col_map.get("date")),
            comp_type=_safe_get(row, col_map.get("comp_type"), 0),
            comp_name=_safe_get(row, col_map.get("comp_name"), ""),
            home_team=_strip_team(_safe_get(row, col_map.get("home_name"), "")),
            away_team=_strip_team(_safe_get(row, col_map.get("away_name"), "")),
            home_score=_safe_int(row, col_map.get("home_score")),
            away_score=_safe_int(row, col_map.get("away_score")),
            full_score=_safe_get(row, col_map.get("full_score"), ""),
            handicap=_safe_get(row, col_map.get("handicap"), ""),
            schedule_id=_safe_int(row, col_map.get("schedule_id")),
            home_team_id=_safe_int(row, col_map.get("home_id")),
            away_team_id=_safe_int(row, col_map.get("away_id")),
        )
        matches.append(m)
    return matches


def _strip_team(name: str) -> str:
    """Remove HTML tags and (中) suffix from team name."""
    name = re.sub(r'<[^>]+>', '', name)
    name = re.sub(r'\([^)]*\)', '', name)
    return name.strip()


def _safe_get(row: list, idx, default=None):
    if idx is None or idx >= len(row):
        return default
    return row[idx] if row[idx] is not None else default


def _safe_int(row: list, idx, default=0):
    val = _safe_get(row, idx)
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return int(val)
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


# ──────────────────────────────────────────────
# DOM parsing functions
# ──────────────────────────────────────────────

def parse_standings(html: str) -> Optional[models.Standings]:
    """Extract league standings table from HTML."""
    home_name = _extract_team_name(html, "hometeam")
    away_name = _extract_team_name(html, "guestteam")
    if not home_name and not away_name:
        return None

    # Find all standings subtables - they contain '积分' in header and team name link
    standings_tables = _find_standings_tables(html)
    home_standing = None
    away_standing = None

    for tbl in standings_tables:
        rows = _parse_standings_table(tbl)
        if not rows:
            continue
        # First row should contain team name
        first_cell = rows[0][0] if rows[0] else ""
        # Data rows come after header rows - look for rows with numeric data
        data_row = None
        for row in rows[2:]:  # Skip team name + column header rows
            if len(row) >= 10:
                # Index 0 is label (总/主/客), index 1+ is data
                try:
                    int(row[1])
                    data_row = row
                    break
                except (ValueError, TypeError):
                    continue

        if not data_row:
            continue

        # Column order (index 1+): 赛, 胜, 平, 负, 得, 失, 净, 积分, 排名
        # Index 0 is the label (总/主/客/近6)
        standing = models.StandingRow(
            played=_safe_int_parse(data_row[1]) if len(data_row) > 1 else 0,
            won=_safe_int_parse(data_row[2]) if len(data_row) > 2 else 0,
            drawn=_safe_int_parse(data_row[3]) if len(data_row) > 3 else 0,
            lost=_safe_int_parse(data_row[4]) if len(data_row) > 4 else 0,
            goals_for=_safe_int_parse(data_row[5]) if len(data_row) > 5 else 0,
            goals_against=_safe_int_parse(data_row[6]) if len(data_row) > 6 else 0,
            goal_diff=_safe_int_parse(data_row[7]) if len(data_row) > 7 else 0,
            points=_safe_int_parse(data_row[8]) if len(data_row) > 8 else 0,
            rank=_safe_int_parse(data_row[9]) if len(data_row) > 9 else 0,
            team_name="",
        )

        # Get team name from the first row
        team_name_text = re.sub(r'<[^>]+>', '', first_cell)
        # Extract team name after ']' if bracket style: [英超-8]曼彻斯特联
        if ']' in team_name_text:
            team_name_text = team_name_text.split(']', 1)[1]
        standing.team_name = team_name_text.strip()

        # Match to home or away team
        if home_name and (home_name[:4] in team_name_text or 
                         any(p in team_name_text for p in home_name.split() if len(p) > 2)):
            home_standing = standing
        elif away_name and (away_name[:4] in team_name_text or 
                           any(p in team_name_text for p in away_name.split() if len(p) > 2)):
            away_standing = standing

    if home_standing or away_standing:
        return models.Standings(
            home_team=home_name or "",
            away_team=away_name or "",
            home_standing=home_standing,
            away_standing=away_standing,
        )
    return None


def _find_standings_tables(html: str) -> list:
    """Find all team standings sub-tables from analysis page."""
    tables = []
    # Find positions of bracket-style team names: [联赛名-排名]队名
    # Pattern: <b>[英超-8]曼彻斯特联</b>
    for m in re.finditer(r'\[[^\]]+\][^<]*?</b>', html):
        pos = m.end()
        # Search backward for the containing <TABLE (inner table, not container)
        table_start = html.rfind('<TABLE', max(0, pos - 800), pos)
        if table_start < 0:
            continue
        # Find matching </TABLE> with depth tracking
        depth = 0
        table_end = -1
        search_start = html.find('>', table_start) + 1
        for i in range(search_start, min(search_start + 3000, len(html))):
            if html[i:i+6].upper() == '<TABLE':
                depth += 1
            elif html[i:i+7].upper() == '</TABLE':
                depth -= 1
                if depth < 0:
                    table_end = html.index('>', i) + 1
                    break
        if table_end > 0:
            tbl = html[table_start:table_end]
            if '积分' in tbl or '得分' in tbl:
                tables.append(tbl)
    return tables


def _parse_standings_table(table_html: str) -> list:
    """Parse a standings table into rows of cell texts."""
    rows = []
    for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL):
        cells = []
        for td in re.finditer(r'<t[dh][^>]*>(.*?)</t[dh]>', tr.group(1), re.DOTALL):
            cell_text = re.sub(r'<[^>]+>', '', td.group(1)).strip()
            cells.append(cell_text)
        if cells:
            rows.append(cells)
    return rows


def _safe_int_parse(val) -> int:
    try:
        return int(val) if val else 0
    except (ValueError, TypeError):
        return 0


def _extract_team_name(html: str, var_name: str) -> Optional[str]:
    """Extract team name from JS variable."""
    m = re.search(rf'{var_name}\s*=\s*["\']([^"\']+)["\']', html)
    return m.group(1) if m else None


# ══════════════════════════════════════════════
# Main extraction entry point
# ══════════════════════════════════════════════

def extract_analysis(html: str) -> models.AnalysisPage:
    """Extract all data from an analysis page HTML."""
    version_info = detect_version(html)
    version = version_info["version"]
    js = parse_js_variables(html, version)

    # Match info
    hometeam = _extract_team_name(html, "hometeam") or ""
    guestteam = _extract_team_name(html, "guestteam") or ""
    str_time = _extract_team_name(html, "strTime") or ""
    sid = js.get("scheduleID", 0)

    match_info = models.MatchInfo(
        schedule_id=sid or 0,
        hometeam=hometeam,
        guestteam=guestteam,
        match_time=str_time,
        league_id=0,
        league_name_cn="",
        season="",
        weather=_extract_weather(html),
    )

    # Recent matches
    recent_home = parse_recent_matches(js.get("h_data", []), version, is_home_side=True)
    recent_away = parse_recent_matches(js.get("a_data", []), version, is_home_side=False)
    recent_home_home = parse_recent_matches(js.get("h2_data", []), version, is_home_side=True)
    recent_away_away = parse_recent_matches(js.get("a2_data", []), version, is_home_side=False)
    h2h = parse_h2h(js.get("v_data", []), version)

    # DOM sections
    standings = parse_standings(html)
    tip = _extract_tip(html)
    preview = _extract_preview(html)
    lineup = _extract_lineup(html, version)

    page = models.AnalysisPage(
        version=version,
        match_info=match_info,
        recent_home=recent_home,
        recent_away=recent_away,
        recent_home_home=recent_home_home,
        recent_away_away=recent_away_away,
        h2h=h2h,
        standings=standings,
        lineup=lineup,
        match_preview=preview,
        tip=tip,
        raw_js_data=js,
    )

    return page


def _extract_weather(html: str) -> Optional[str]:
    """Extract weather info from HTML."""
    m = re.search(r'天气[：:]\s*([^<\n]+)', html)
    if m:
        return m.group(1).strip()
    m = re.search(r'(?:<td[^>]*>)\s*天气\s*</td>\s*<td[^>]*>(.*?)</td>', html, re.DOTALL)
    if m:
        return re.sub(r'<[^>]+>', '', m.group(1)).strip()
    return None


def _extract_tip(html: str) -> Optional[models.TipRecommendation]:
    """Extract structured tip recommendation from porlet_25 div."""
    idx = html.find('id="porlet_25"')
    if idx < 0:
        idx = html.find('porlet_25')
    if idx < 0:
        return None
    h2_end = html.find('</h2>', idx)
    if h2_end < 0:
        return None
    start = h2_end + 5
    next_porlet = html.find('porlet_', start + 10)
    chunk = html[start:next_porlet] if next_porlet > 0 else html[start:start + 3000]

    text = re.sub(r'<[^>]+>', '', chunk)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) < 10:
        return None

    tip = models.TipRecommendation()

    # Extract fields by simple label search
    m_ci = re.search(r'信心指数\s*[-:]\s*(.{3,80}?)(?:\s{10,}|对赛成绩|$)', text)
    if m_ci:
        tip.confidence_index = m_ci.group(1).strip()

    m_h2h = re.search(r'对赛成绩\s*[-:]\s*(\S+?\s+\d+[胜负平勝負和]\s+\d+[胜负平勝負和]\s+\d+[胜负平勝負和])', text)
    if m_h2h:
        tip.h2h_record = m_h2h.group(1).strip()

    # Analysis starts after the last known field's value
    analysis_start = 0
    if m_h2h:
        analysis_start = m_h2h.end()
    elif m_ci:
        analysis_start = m_ci.end()

    if analysis_start > 10:
        analysis = text[analysis_start:].strip()
    else:
        # Check for 没有推荐 marker (V1.5/V2 format)
        m_nr = re.search(r'没有推荐[^)]*\)', text)
        if m_nr:
            analysis = text[m_nr.end():].strip()
        else:
            analysis = text

    analysis = re.sub(r'\s*<div\s+class="porletP".*', '', analysis).strip()
    analysis = re.sub(r'\s*www\.\S+', '', analysis).strip()
    analysis = re.sub(r'^[\W\d_]{0,30}', '', analysis).strip()
    if len(analysis) >= 5:
        tip.analysis = analysis

    if not tip.confidence_index and not tip.h2h_record and not tip.analysis:
        tip.analysis = text

    return tip if (tip.confidence_index or tip.h2h_record or tip.analysis) else None


def _extract_preview(html: str) -> Optional[str]:
    """Fallback: plain text from porlet_25 div."""
    tip = _extract_tip(html)
    if tip:
        parts = [p for p in [tip.confidence_index, tip.h2h_record, tip.analysis] if p]
        return ' | '.join(parts) if parts else None
    return None


# ──────────────────────────────────────────────
# Lineup parsing (injuries + last match ratings)
# ──────────────────────────────────────────────

def _extract_porlet_content(html: str, porlet_id: str) -> Optional[str]:
    """Extract content inside a porlet div by its id."""
    m = re.search(r'<div[^>]*\bid=["\']' + porlet_id + r'["\']', html)
    if not m:
        m = re.search(porlet_id, html)
        if not m:
            return None
        idx = m.start()
    else:
        idx = m.start()
    start = html.find('>', idx) + 1
    depth = 0
    pos = start
    while pos < len(html):
        next_open = html.find('<div', pos)
        next_close = html.find('</div>', pos)
        if next_close == -1:
            return html[start:]
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = next_open + 1
        else:
            if depth == 0:
                return html[start:next_close]
            depth -= 1
            pos = next_close + 1
    return html[start:]


_TEAM_TABLE_RE = re.compile(
    r'(<table\s+width=[\'"]100%[\'"]\s+border=0\s+cellpadding=3[^>]*>)',
    re.IGNORECASE
)


def _extract_team_tables(porlet_html: str) -> list:
    """Extract individual team sub-tables from porlet content."""
    tables = []
    for m in _TEAM_TABLE_RE.finditer(porlet_html):
        start = m.start()
        tbl_start = m.end()
        depth = 0
        pos = tbl_start
        end = -1
        while pos < len(porlet_html):
            next_open = porlet_html.find('<table', pos)
            next_close = porlet_html.find('</table>', pos)
            if next_close == -1:
                break
            if next_open != -1 and next_open < next_close:
                depth += 1
                pos = next_open + 1
            else:
                if depth == 0:
                    end = next_close + 8
                    break
                depth -= 1
                pos = next_close + 1
        if end > 0:
            tables.append(porlet_html[start:end])
    return tables


def _classify_team_table(tbl: str) -> tuple:
    """Classify table as (side, table_type) where side='home'/'away', type='injury'/'rating'/'unknown'."""
    first_300 = tbl[:300].lower()
    is_red = 'red_t1' in first_300
    is_blue = 'blue_t1' in first_300
    side = 'home' if is_red else ('away' if is_blue else 'unknown')

    # Check for injury vs rating by looking at headers
    has_injury = '缺阵' in tbl or 'ȱ��' in tbl
    has_rating = '评分' in tbl or '����' in tbl

    # Count colspan in first header row
    header_colspan = 0
    for m in re.finditer(r'colspan\s*=\s*["\'](\d+)["\']', tbl[:500]):
        header_colspan = max(header_colspan, int(m.group(1)))

    if has_injury:
        return side, 'injury'
    if has_rating or header_colspan >= 4:
        return side, 'rating'
    if header_colspan == 2:
        return side, 'injury'
    return side, 'unknown'


def _parse_injury_table(tbl: str) -> list:
    """Parse injury rows from a team's injury table."""
    results = []
    pattern = re.compile(
        r'<tr\s+align="middle"\s+bgcolor="#FFFFFF">'
        r'<td[^>]*><a[^>]*title=[\'"]([^\'"]*)[\'"][^>]*>.*?</a></td>'
        r'<td[^>]*>(.*?)</td></tr>',
        re.IGNORECASE | re.DOTALL
    )
    for m in pattern.finditer(tbl):
        player = m.group(1).strip()
        reason = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        if player and player != '&nbsp;' and reason != '&nbsp;':
            results.append({"player": player, "reason": reason})
    return results


def _parse_rating_table(tbl: str) -> list:
    """Parse V3/V3.1 rating rows (5 cols) or V2 (4 cols)."""
    results = []
    # Try V3 style first (5 cols with style='line-height:16px;')
    pattern_v3 = re.compile(
        r'<tr\s+style=[\'"]line-height:16px;[\'"]\s+bgcolor="[^"]*">'
        r'<td>(.*?)</td>'
        r'<td><a[^>]*>(.*?)</a></td>'
        r'<td>(.*?)</td>'
        r'<td>(.*?)</td>'
        r'<td>(.*?)</td></tr>',
        re.IGNORECASE | re.DOTALL
    )
    matches = list(pattern_v3.finditer(tbl))
    if matches:
        for m in matches:
            number = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            name = re.sub(r'<[^>]+>', '', m.group(2)).strip()
            position = re.sub(r'<[^>]+>', '', m.group(3)).strip()
            starter_raw = re.sub(r'<[^>]+>', '', m.group(4)).strip()
            rating = re.sub(r'<[^>]+>', '', m.group(5)).strip()
            if not name or name == '&nbsp;' or '平均评分' in number:
                continue
            if number == '&nbsp;' or rating == '&nbsp;':
                continue
            results.append({
                "number": number,
                "name": name,
                "position": position,
                "is_starter": starter_raw == '*',
                "rating": rating,
            })
        return results

    # Fallback: V2 style (4 cols, bgcolor only)
    pattern_v2 = re.compile(
        r'<tr\s*bgcolor="[^"]*">'
        r'<td>(.*?)</td>'
        r'<td><a[^>]*>(.*?)</a></td>'
        r'<td>(.*?)</td>'
        r'<td>(.*?)</td></tr>',
        re.IGNORECASE | re.DOTALL
    )
    for m in pattern_v2.finditer(tbl):
        number = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        name = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        position = re.sub(r'<[^>]+>', '', m.group(3)).strip()
        rating = re.sub(r'<[^>]+>', '', m.group(4)).strip()
        if not name or name == '&nbsp;' or '平均评分' in number:
            continue
        if number == '&nbsp;' or rating == '&nbsp;':
            continue
        results.append({
            "number": number,
            "name": name,
            "position": position,
            "is_starter": None,
            "rating": rating,
        })
    return results


def _extract_lineup(html: str, version: str) -> Optional[models.Lineup]:
    """Extract lineup section: injuries and player ratings from last match."""
    porlet21 = _extract_porlet_content(html, "porlet_21")
    if not porlet21:
        return None

    lineup = models.Lineup()
    tables = _extract_team_tables(porlet21)
    if not tables:
        return None

    for tbl in tables:
        side, tbl_type = _classify_team_table(tbl)
        if tbl_type == 'injury':
            rows = _parse_injury_table(tbl)
            if side == 'home':
                lineup.home_injuries = rows
            else:
                lineup.away_injuries = rows
        elif tbl_type == 'rating':
            rows = _parse_rating_table(tbl)
            if side == 'home':
                lineup.home_ratings = rows
            else:
                lineup.away_ratings = rows

    # For V2/V2.5: ratings may be in separate porlet_28 instead
    if version.startswith('V2') and not lineup.home_ratings and not lineup.away_ratings:
        porlet28 = _extract_porlet_content(html, "porlet_28")
        if porlet28:
            for tbl in _extract_team_tables(porlet28):
                side, tbl_type = _classify_team_table(tbl)
                if tbl_type == 'rating':
                    rows = _parse_rating_table(tbl)
                    if side == 'home':
                        lineup.home_ratings = rows
                    else:
                        lineup.away_ratings = rows

    return lineup
