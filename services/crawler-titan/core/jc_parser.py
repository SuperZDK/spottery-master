"""
Parse jingcai (竞彩) history schedule from jc.titan007.com.

Endpoint: http://jc.titan007.com/handle/JcResult.aspx?d={date}
Response is UTF-8 text:
  sections split by '$', records split by '!', fields split by '^'.

Competition header record:
  {sclass_id}^{color}^{order}^{name_cn},{name_tw}^{?}^{link}
  link contains cupmatch / subleague / league + "sclassid={id}"

Match record (history, ~24 fields):
  [0] sid, [1] scheduled 'YYYY,M,D,HH,MM,SS', [2] updated, [3] status,
  [4] match_num ('周六201'), [5] sclass_id, [6] sub_id,
  [7] home_team_id, [8] home names 'cn,tw,en',
  [9] away_team_id, [10] away names,
  [11] home full score, [12] away full score,
  [13] home half score, [14] away half score,
  ... [21] business date ...
"""
import re
import urllib.request
from typing import Optional

JC_RESULT_URL = "http://jc.titan007.com/handle/JcResult.aspx"
JC_REFERER = "http://jc.titan007.com/"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def _norm_date(dt_str: str) -> str:
    """'2026,6,4,18,30,00' -> '2026-06-04 18:30'。始终保留时间（00:00 是真实开赛时刻，不折叠）。"""
    if not dt_str:
        return ""
    parts = str(dt_str).split(",")
    if len(parts) < 6:
        return dt_str
    try:
        y, mo, d, h, mi = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
    except (ValueError, TypeError):
        return dt_str
    # JcResult month field is 0-based (0=1月 ... 11=12月).
    mo += 1
    date_part = f"{y:04d}-{mo:02d}-{d:02d}"
    return f"{date_part} {h:02d}:{mi:02d}"


def _parse_names(raw: str) -> dict:
    """'cn,tw,en' -> {'cn': ..., 'tw': ..., 'en': ...}"""
    parts = (raw or "").split(",")
    while len(parts) < 3:
        parts.append("")
    return {"cn": parts[0], "tw": parts[1], "en": parts[2]}


def _is_comp_header(fields: list) -> bool:
    return len(fields) >= 6 and "sclassid=" in fields[5].lower()


def _is_match_row(fields: list) -> bool:
    if len(fields) < 18:
        return False
    if not re.match(r"^\d{2,}$", str(fields[0])):
        return False
    mn = str(fields[4]) if len(fields) > 4 else ""
    if len(mn) != 5 or mn[0] != "\u5468":
        return False
    return True


def _int(fields: list, idx: int, default: int = 0) -> int:
    if idx >= len(fields):
        return default
    try:
        return int(fields[idx])
    except (ValueError, TypeError):
        return default


def _score(fields: list, idx_h: int, idx_a: int) -> Optional[str]:
    try:
        h, a = fields[idx_h], fields[idx_a]
    except IndexError:
        return None
    if h in (None, "") or a in (None, ""):
        return None
    try:
        return f"{int(h)}-{int(a)}"
    except (ValueError, TypeError):
        return None


def _parse_match_row(fields: list) -> Optional[dict]:
    try:
        sid = int(fields[0])
    except (ValueError, TypeError, IndexError):
        return None
    if sid < 100:
        return None

    home_names = _parse_names(fields[8]) if len(fields) > 8 else {"cn": "", "tw": "", "en": ""}
    away_names = _parse_names(fields[10]) if len(fields) > 10 else {"cn": "", "tw": "", "en": ""}

    # [21] = business date（"2026,7,8,00,00,00"），bf_jc 跨日场次以此为准
    biz = _norm_date(fields[21]) if len(fields) > 21 else ""
    return {
        "sid": sid,
        "kickoff": _norm_date(fields[1]) if len(fields) > 1 else "",
        "status": _int(fields, 3, 0),
        "match_num": fields[4] if len(fields) > 4 else "",
        "sclass_id": _int(fields, 5),
        "sub_id": _int(fields, 6),
        "home_team_id": _int(fields, 7),
        "home_team": home_names["cn"],
        "home_team_tw": home_names["tw"],
        "home_team_en": home_names["en"],
        "away_team_id": _int(fields, 9),
        "away_team": away_names["cn"],
        "away_team_tw": away_names["tw"],
        "away_team_en": away_names["en"],
        "full_score": _score(fields, 11, 12),
        "half_score": _score(fields, 13, 14),
        "business_date": biz[:10] if biz else None,
    }


def parse_jc_result(text: str, business_date: str) -> dict:
    """Parse the JcResult.aspx body for a business date."""
    competitions = {}
    matches = []
    for section in (text or "").split("$"):
        for record in section.split("!"):
            if not record.strip():
                continue
            fields = record.split("^")
            if _is_comp_header(fields):
                sid = _int(fields, 0)
                if not sid:
                    continue
                names = _parse_names(fields[3]) if len(fields) > 3 else {"cn": "", "tw": "", "en": ""}
                link = str(fields[5])
                competitions[sid] = {
                    "sclass_id": sid,
                    "name_cn": names["cn"],
                    "name_tw": names["tw"],
                    "is_cup": "cupmatch" in link.lower(),
                    "link": link,
                }
                continue
            if _is_match_row(fields):
                m = _parse_match_row(fields)
                if m:
                    if not m.get("business_date"):
                        m["business_date"] = business_date
                    matches.append(m)

    return {
        "business_date": business_date,
        "competitions": competitions,
        "matches": matches,
    }


def fetch_jc_result(business_date: str, max_retry: int = 5) -> Optional[str]:
    """Fetch JcResult.aspx?d={date}, returning the raw UTF-8 text.

    On repeated network failures (e.g. transient DNS errors) returns None
    instead of raising, so a single date's fetch failure does not abort the
    whole backfill run. The caller treats None as 'fetch_failed'.
    """
    url = f"{JC_RESULT_URL}?d={business_date}"
    req = urllib.request.Request(url, headers={
        "User-Agent": _UA,
        "Referer": JC_REFERER,
        "Accept": "text/html,*/*",
    })
    import time, random
    for _ in range(max_retry):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
            for enc in ("utf-8", "gbk"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    continue
            return raw.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - network retry
            time.sleep(random.uniform(2.0, 4.0))
    return None
