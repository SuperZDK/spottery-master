"""
Detect analysis page template version from HTML markers.
"""
import re
from typing import Optional


def detect_version(html: str) -> dict:
    """Detect template version and return all markers plus version string."""
    h = html

    # ── Header template (most reliable) ──
    has_odds_top = bool(re.search(r'id\s*=\s*["\']odds_top["\']', h))
    has_odds_top2 = bool(re.search(r'id\s*=\s*["\']odds_top2["\']', h))
    has_analyhead_new = 'analyhead new' in h

    if has_analyhead_new:
        header_type = "analyhead_new"
    elif has_odds_top2:
        header_type = "odds_top2"
    elif has_odds_top:
        header_type = "odds_top"
    elif re.search(r'<div[^>]*class\s*=\s*["\']header["\']', h):
        header_type = "class_header"
    else:
        header_type = "unknown"

    # ── h_data column count ──
    hdata_cols = _count_hdata_cols(h)

    # ── Standings terminology ──
    has_score_pts = "得分" in h
    has_jifen = "积分" in h

    # ── Previous lineup ──
    has_prev_lineup = "上一场阵容" in h

    # ── Weather ──
    has_weather = bool(re.search(r'<td[^>]*>[^<]*天气[^<]*</td>', h))
    if not has_weather:
        has_weather = bool(re.search(r'天气[^<>]{0,20}(?:</td>|</div>|<br)', h))

    # ── VIP (exclude URL references) ──
    h_no_urls = re.sub(r'//[^\s"\'<>]+', '', h)
    has_vip = bool(re.search(r'(?:VIP方案|会员方案|VIP推荐|VIP會員)', h_no_urls))

    # ── Determine version ──
    version = _determine_version(header_type, hdata_cols, has_score_pts, has_jifen,
                                  has_prev_lineup, has_vip, has_weather)

    return {
        "version": version,
        "header_type": header_type,
        "hdata_cols": hdata_cols,
        "has_score_pts": has_score_pts,
        "has_jifen": has_jifen,
        "has_prev_lineup": has_prev_lineup,
        "has_weather": has_weather,
        "has_vip": has_vip,
    }


def _count_hdata_cols(html: str) -> Optional[int]:
    """Count columns in the first inner array of h_data."""
    m = re.search(r'[hH]_data\s*=\s*(\[)', html, re.DOTALL)
    if not m:
        return None
    start = m.start(1)
    depth, i = 0, start
    while i < len(html):
        if html[i] == '[':
            depth += 1
        elif html[i] == ']':
            depth -= 1
            if depth == 0:
                outer = html[start + 1:i]
                break
        i += 1
    else:
        return None

    inner_m = re.match(r'\s*\[(.*?)\]\s*[,]', outer, re.DOTALL)
    if not inner_m:
        inner_m = re.match(r'\s*\[(.*?)\]\s*\]', outer, re.DOTALL)
    if not inner_m:
        return None
    inner = inner_m.group(1)
    return _count_elements(inner)


def _count_elements(text: str) -> int:
    """Count comma-separated elements at depth 0."""
    d, count = 0, 1
    in_str, sc = False, None
    for ch in text:
        if in_str:
            if ch == '\\':
                pass
            elif ch == sc:
                in_str = False
        elif ch in ("'", '"'):
            in_str = True
            sc = ch
        elif ch == '[':
            d += 1
        elif ch == ']':
            d -= 1
        elif ch == ',' and d == 0:
            count += 1
    return count


def _determine_version(header_type: str, hdata_cols: Optional[int],
                       has_score: bool, has_jifen: bool,
                       has_prev: bool, has_vip: bool, has_weather: bool) -> str:
    if hdata_cols == 16:
        return "V1"
    if hdata_cols == 18:
        return "V1.5_transition"
    if hdata_cols == 22:
        return "V3.1"

    if header_type == "odds_top":
        if hdata_cols == 20:
            return "V1.5c" if has_weather else "V1.5"
        return "V1.5"

    if header_type == "odds_top2":
        return "V1.5"

    if header_type == "analyhead_new":
        return "V3"

    if header_type == "class_header":
        if not has_score and has_jifen and not has_vip:
            return "V2.5"
        if has_vip:
            return "V3"
        return "V2"

    return "unknown"
