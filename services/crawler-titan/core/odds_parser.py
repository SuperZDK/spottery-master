import re, random, time
from typing import Optional
from core import models
from core import playwright_fetcher
from core import utils

HANDICAP_BASE = "https://vip.titan007.com/changeDetail"
EURO_BASE = "http://1x2.titan007.com"
EURO_JS_BASE = "https://1x2d.titan007.com"
VIP_REFERER = "https://vip.titan007.com/"
EURO_REFERER = "http://1x2.titan007.com/"
NOWSCORE_BASE = "https://live.nowscore.com/odds"
NOWSCORE_REFERER = "https://live.nowscore.com/odds/"


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return text.strip()


def _safe_f(val: str) -> float:
    val = val.strip()
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _fill_odds_row(cols: list[str], min_cols: int = 7) -> list[str]:
    while len(cols) < min_cols:
        cols.append("")
    return cols[:min_cols]


# ═════════════════════════════════════════════
# 1. Asian Handicap
# ═════════════════════════════════════════════

def _parse_handicap_html(html: str) -> Optional[models.AsianOddsItem]:
    m = re.search(r'<span\s+id="odds2">(.*?)</span>', html, re.DOTALL | re.IGNORECASE)
    if not m:
        return None
    content = m.group(1)

    changes = []
    for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', content, re.DOTALL | re.IGNORECASE):
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr.group(1), re.DOTALL | re.IGNORECASE)
        cols = [_strip_html(c) for c in cells]
        if len(cols) < 5:
            continue
        cols = _fill_odds_row(cols)

        time_val = cols[5].strip()
        if not time_val or time_val in ("时间", "变化时间"):
            continue

        status = cols[6].strip() if len(cols) > 6 else ""
        if status == "滚":
            continue

        home_str = cols[2].strip() if len(cols) > 2 else ""
        line_str = cols[3].strip() if len(cols) > 3 else ""
        away_str = cols[4].strip() if len(cols) > 4 else ""

        if not home_str and not line_str and not away_str:
            continue

        changes.append({
            "time": time_val,
            "line": line_str,
            "home": _safe_f(home_str),
            "away": _safe_f(away_str),
            "status": status,
        })

    if not changes:
        return None

    return models.AsianOddsItem(company_id=0, company_name="", changes=changes)


def _set_company_info(item, odds_type: str, company_id: int):
    if item:
        item.company_id = company_id
        if not item.company_name:
            item.company_name = utils.get_company_name(odds_type, company_id)
    return item


def scrape_asian_handicap(schedule_id: int, company_id: int = 1) -> Optional[models.AsianOddsItem]:
    url = f"{HANDICAP_BASE}/handicap.aspx?id={schedule_id}&companyID={company_id}&l=0"
    html = playwright_fetcher.fetch_text(url, referer=VIP_REFERER, timeout=30000)
    if html:
        return _set_company_info(_parse_handicap_html(html), "asian", company_id)
    return None


def scrape_asian_handicap_half(schedule_id: int, company_id: int = 1) -> Optional[models.AsianOddsItem]:
    url = f"{HANDICAP_BASE}/handicapHalf.aspx?id={schedule_id}&companyID={company_id}&h=1&l=0"
    html = playwright_fetcher.fetch_text(url, referer=VIP_REFERER, timeout=30000)
    if html:
        return _set_company_info(_parse_handicap_html(html), "asian", company_id)
    return None


# ═════════════════════════════════════════════
# 2. Over/Under
# ═════════════════════════════════════════════

def _parse_over_under_html(html: str) -> Optional[models.OverUnderItem]:
    m = re.search(r'<span\s+id="odds2">(.*?)</span>', html, re.DOTALL | re.IGNORECASE)
    if not m:
        return None
    content = m.group(1)

    changes = []
    for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', content, re.DOTALL | re.IGNORECASE):
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr.group(1), re.DOTALL | re.IGNORECASE)
        cols = [_strip_html(c) for c in cells]
        if len(cols) < 5:
            continue
        cols = _fill_odds_row(cols)

        time_val = cols[5].strip()
        if not time_val or time_val in ("时间", "变化时间"):
            continue

        status = cols[6].strip() if len(cols) > 6 else ""
        if status == "滚":
            continue

        big_str = cols[2].strip() if len(cols) > 2 else ""
        line_str = cols[3].strip() if len(cols) > 3 else ""
        small_str = cols[4].strip() if len(cols) > 4 else ""

        if not big_str and not line_str and not small_str:
            continue

        changes.append({
            "time": time_val,
            "line": line_str,
            "big": _safe_f(big_str),
            "small": _safe_f(small_str),
            "status": status,
        })

    if not changes:
        return None

    return models.OverUnderItem(company_id=0, company_name="", changes=changes)


def scrape_over_under(schedule_id: int, company_id: int = 1) -> Optional[models.OverUnderItem]:
    url = f"{HANDICAP_BASE}/overunder.aspx?id={schedule_id}&companyID={company_id}&l=0"
    html = playwright_fetcher.fetch_text(url, referer=VIP_REFERER, timeout=30000)
    if html:
        return _set_company_info(_parse_over_under_html(html), "over_under", company_id)
    return None


def scrape_over_under_half(schedule_id: int, company_id: int = 1) -> Optional[models.OverUnderItem]:
    url = f"{HANDICAP_BASE}/overunderHalf.aspx?id={schedule_id}&companyID={company_id}&h=1&l=0"
    html = playwright_fetcher.fetch_text(url, referer=VIP_REFERER, timeout=30000)
    if html:
        return _set_company_info(_parse_over_under_html(html), "over_under", company_id)
    return None


# ═════════════════════════════════════════════
# 2.5 Nowscore fallback source (3in1Odds)
# ═════════════════════════════════════════════

def _normalize_ns_time(val: str) -> str:
    """Convert nowscore time '10-01<br />02:39' to titan-style '10-1 02:39'."""
    t = re.sub(r"<br\s*/?>", " ", val).strip()
    date_part, _, hm = t.partition(" ")
    date_part = re.sub(r"\b0(\d)", r"\1", date_part)
    return f"{date_part} {hm}".strip()


def _parse_nowscore_table(html: str, table_idx: int) -> Optional[list]:
    """Parse one table from the nowscore 3in1 page.

    table_idx: 0 = Asian handicap, 1 = Over/Under.
    Columns: [时, 比分, 主/大, 盘, 客/小, 变化, 状]
    Returns a list of change dicts (or None if no data).
    """
    tables = re.findall(r"<table[^>]*>.*?</table>", html, re.DOTALL)
    if len(tables) <= table_idx:
        return None

    changes = []
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", tables[table_idx], re.DOTALL):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr.group(1), re.DOTALL)
        cols = [c.strip() for c in cells]
        if len(cols) < 7:
            continue

        time_val = _normalize_ns_time(cols[5])
        status = cols[6].strip()
        if not time_val or time_val in ("变化", "变化时间", "时间"):
            continue
        if status in ("滚", "状", "状态"):
            continue

        home_str = cols[2].strip()
        line_str = cols[3].strip()
        away_str = cols[4].strip()
        if not home_str and not line_str and not away_str:
            continue

        changes.append({
            "time": time_val,
            "line": line_str,
            "home": _safe_f(home_str),
            "away": _safe_f(away_str),
            "status": status,
        })

    return changes or None


def scrape_asian_nowscore(schedule_id: int, company_id: int = 1,
                          is_half: bool = False) -> Optional[models.AsianOddsItem]:
    """Fetch Asian handicap odds from nowscore 3in1 page."""
    url = f"{NOWSCORE_BASE}/3in1Odds.aspx?companyid={company_id}&id={schedule_id}"
    if is_half:
        url += "&t=1"
    html = playwright_fetcher.fetch_text(url, referer=NOWSCORE_REFERER, timeout=30000)
    if not html:
        return None
    changes = _parse_nowscore_table(html, 0)
    if not changes:
        return None
    return _set_company_info(
        models.AsianOddsItem(company_id=0, changes=changes), "asian", company_id)


def scrape_over_under_nowscore(schedule_id: int, company_id: int = 1,
                               is_half: bool = False) -> Optional[models.OverUnderItem]:
    """Fetch Over/Under odds from nowscore 3in1 page."""
    url = f"{NOWSCORE_BASE}/3in1Odds.aspx?companyid={company_id}&id={schedule_id}"
    if is_half:
        url += "&t=1"
    html = playwright_fetcher.fetch_text(url, referer=NOWSCORE_REFERER, timeout=30000)
    if not html:
        return None
    changes = _parse_nowscore_table(html, 1)
    if not changes:
        return None
    for ch in changes:
        ch["big"] = ch.pop("home")
        ch["small"] = ch.pop("away")
    return _set_company_info(
        models.OverUnderItem(company_id=0, changes=changes), "over_under", company_id)


def scrape_nowscore_both(schedule_id: int, company_id: int = 1,
                         is_half: bool = False) -> dict:
    """Fetch the nowscore 3in1 page once and parse BOTH Asian and Over/Under tables.

    The page (3in1Odds.aspx) returns three tables in a single response:
      table 0 = Asian handicap, table 1 = Over/Under, table 2 = European.
    This avoids a second network request when both odds types need data.
    European (table 2) is intentionally not parsed here (euro keeps using titan).

    Returns {"asian": AsianOddsItem|None, "over_under": OverUnderItem|None}.
    """
    url = f"{NOWSCORE_BASE}/3in1Odds.aspx?companyid={company_id}&id={schedule_id}"
    if is_half:
        url += "&t=1"
    html = playwright_fetcher.fetch_text(url, referer=NOWSCORE_REFERER, timeout=30000)
    if not html:
        return {"asian": None, "over_under": None}

    asian_item = over_item = None

    asian_changes = _parse_nowscore_table(html, 0)
    if asian_changes:
        asian_item = _set_company_info(
            models.AsianOddsItem(company_id=0, changes=asian_changes), "asian", company_id)

    ou_changes = _parse_nowscore_table(html, 1)
    if ou_changes:
        for ch in ou_changes:
            ch["big"] = ch.pop("home")
            ch["small"] = ch.pop("away")
        over_item = _set_company_info(
            models.OverUnderItem(company_id=0, changes=ou_changes), "over_under", company_id)

    return {"asian": asian_item, "over_under": over_item}


# ═════════════════════════════════════════════
# 3. European Odds (from JS data file)
# ═════════════════════════════════════════════


def extract_euro_ids_from_js(js_text: str, company_ids: list[int]) -> dict[int, int]:
    """Parse 1x2d.titan007.com/{sid}.js to extract {company_id: euro_id}.

    var game=Array("cid|euro_id|name|...", "cid|euro_id|name|...", ...)
    Handles parentheses inside quoted company names.
    """
    mapping = {}
    m = re.search(r'var game=Array\(', js_text)
    if not m:
        return mapping

    start = m.end()
    depth = 1
    i = start
    in_str = False
    while i < len(js_text) and depth > 0:
        ch = js_text[i]
        if ch == '"' and (i == 0 or js_text[i - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
        i += 1
    array_content = js_text[start:i - 1]

    for entry in re.finditer(r'"([^"]*?)"', array_content):
        parts = entry.group(1).split('|')
        if len(parts) >= 2:
            try:
                cid = int(parts[0])
                euro_id = int(parts[1])
                if cid in company_ids:
                    mapping[cid] = euro_id
            except ValueError:
                continue
    return mapping


def fetch_euro_js_data(schedule_id: int) -> str:
    """Fetch https://1x2d.titan007.com/{sid}.js with random cache buster."""
    r = str(random.randint(100, 999)) + str(int(time.time() * 1000) % 100000000)
    url = f"{EURO_JS_BASE}/{schedule_id}.js?r={r}"
    return playwright_fetcher.fetch_text(url, referer=EURO_REFERER, timeout=30000)


def scrape_euro_from_oddslist(schedule_id: int, company_id: int,
                              js_text: str = None):
    """Fetch European odds for one company via the JS data file.

    1. Fetch {sid}.js (or reuse provided js_text)
    2. Extract euro_id for the given company_id from var game=Array(...)
    3. Fetch and parse OddsHistory.aspx
    Returns EuroOddsItem or None.
    """
    if js_text is None:
        js_text = fetch_euro_js_data(schedule_id)
        if not js_text:
            return None

    euro_ids = extract_euro_ids_from_js(js_text, [company_id])
    euro_id = euro_ids.get(company_id)
    if not euro_id:
        return None

    return scrape_european(euro_id, schedule_id, company_id)


def _parse_euro_html(html: str, company_id: int) -> Optional[models.EuroOddsItem]:
    """Parse European odds history HTML into EuroOddsItem.
    Expected columns: home_win, draw, away_win,
                      home_win_rate, draw_rate, away_win_rate,
                      payout_rate,
                      kelly_home, kelly_draw, kelly_away,
                      time
    """
    changes = []

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL | re.IGNORECASE)
    for row in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.DOTALL | re.IGNORECASE)
        if len(cells) < 7:
            continue
        vals = [_strip_html(c) for c in cells]

        home_win = _safe_f(vals[0]) if len(vals) > 0 else 0.0
        draw = _safe_f(vals[1]) if len(vals) > 1 else 0.0
        away_win = _safe_f(vals[2]) if len(vals) > 2 else 0.0

        if home_win == 0.0 and draw == 0.0 and away_win == 0.0:
            continue

        time_str = vals[10].strip() if len(vals) > 10 else (vals[5].strip() if len(vals) > 5 else "")
        if not time_str or time_str in ("变化时间", "时间"):
            continue

        change = {
            "time": time_str,
            "home_win": home_win,
            "draw": draw,
            "away_win": away_win,
        }

        if len(vals) > 3:
            change["home_win_rate"] = _parse_pct(vals[3])
        if len(vals) > 5:
            change["draw_rate"] = _parse_pct(vals[4])
            change["away_win_rate"] = _parse_pct(vals[5])
        if len(vals) > 6:
            payout_raw = vals[6].strip()
            try:
                change["payout_rate"] = float(payout_raw.rstrip("%"))
            except (ValueError, TypeError):
                pass
        if len(vals) > 9:
            change["kelly_home"] = _safe_f(vals[7])
            change["kelly_draw"] = _safe_f(vals[8])
            change["kelly_away"] = _safe_f(vals[9])

        is_initial = "(初盘)" in row or "initial" in row.lower()
        change["is_initial"] = is_initial

        changes.append(change)

    if not changes:
        return None

    return models.EuroOddsItem(company_id=company_id, changes=changes)


def _parse_pct(val: str) -> Optional[float]:
    val = val.strip().rstrip("%")
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def scrape_european(euro_id: int, schedule_id: int, company_id: int) -> Optional[models.EuroOddsItem]:
    url = f"{EURO_BASE}/OddsHistory.aspx?id={euro_id}&sid={schedule_id}&cid={company_id}&l=0"
    html = playwright_fetcher.fetch_text(url, referer=EURO_REFERER, timeout=30000)
    if html:
        return _set_company_info(_parse_euro_html(html, company_id), "european", company_id)
    return None


# ═════════════════════════════════════════════
# 4. Primary-source logic: nowscore first, titan fallback
# ═════════════════════════════════════════════
# 亚盘 + 大小球：优先 nowscore（3in1Odds 一次请求双盘），nowscore 空则回退 titan。
# 返回 dict: {"asian": item|None, "over_under": item|None, "sources": {...}}

def scrape_dual_odds(schedule_id: int, company_id: int = 1,
                     is_half: bool = False) -> dict:
    """Fetch Asian + Over/Under odds, nowscore first (one 3in1 request), titan fallback.

    Returns {"asian": AsianOddsItem|None, "over_under": OverUnderItem|None,
             "asian_source": "nowscore"|"titan"|None,
             "over_under_source": "nowscore"|"titan"|None}.
    """
    result = {"asian": None, "over_under": None,
              "asian_source": None, "over_under_source": None}

    both = scrape_nowscore_both(schedule_id, company_id, is_half=is_half)
    if both["asian"]:
        result["asian"] = both["asian"]
        result["asian_source"] = "nowscore"
    if both["over_under"]:
        result["over_under"] = both["over_under"]
        result["over_under_source"] = "nowscore"

    if not result["asian"]:
        if is_half:
            item = scrape_asian_handicap_half(schedule_id, company_id)
        else:
            item = scrape_asian_handicap(schedule_id, company_id)
        if item:
            result["asian"] = item
            result["asian_source"] = "titan"

    if not result["over_under"]:
        if is_half:
            item = scrape_over_under_half(schedule_id, company_id)
        else:
            item = scrape_over_under(schedule_id, company_id)
        if item:
            result["over_under"] = item
            result["over_under_source"] = "titan"

    return result
