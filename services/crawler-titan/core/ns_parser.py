"""
Nowscore media supplement (for jc-workset).

仅服务 jc-workset 一条线：titan 分析页没有 media 字段
（趋势/盘路/信心指数/对赛成绩/媒体分析正文），这些只在
nowscore 的 analysis 页面 `live.nowscore.com/analysis/{sid}cn.html` 上。
本模块只负责"补 media" + 野鸡赛过滤（黑名单 + 年限），
不做 h2h/recent 解析（那些由 titan 页 `core/parser.py` 负责）。
"""
import datetime as dt
import json
import os
import re
from typing import Optional

from core import playwright_fetcher

ANALYSIS_PAGE_BASE = "https://live.nowscore.com/analysis"
ANALYSIS_REFERER = "https://live.nowscore.com/"

# h2h/recent 年限上限（基准=本场开赛年份，按 match_date 年份过滤）
H2H_YEARS = 5


def _decode_page(data: bytes) -> str:
    """BOM/GBK/UTF-8 混合解码：nowscore 页面多为 UTF-8 BOM。"""
    if data[:3] == b"\xef\xbb\xbf":
        return data[3:].decode("utf-8", errors="replace")
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        try:
            return data.decode("gbk", errors="replace")
        except UnicodeDecodeError:
            return data.decode("utf-8-sig", errors="replace")


def _fetch_text(url: str) -> Optional[str]:
    # 快 HTTP 优先（处理 BOM/GBK），失败再 Playwright
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
            "Referer": ANALYSIS_REFERER,
            "Accept": "text/html,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=20) as r:
            return _decode_page(r.read())
    except Exception:
        pass
    return playwright_fetcher.fetch_text(url, referer=ANALYSIS_REFERER, timeout=30000)


def fetch_analysis_page(schedule_id: int) -> Optional[str]:
    """Fetch analysis/{sid}cn.html."""
    return _fetch_text(f"{ANALYSIS_PAGE_BASE}/{schedule_id}cn.html")


# ─── 赛前情报（media） ─────────────────────────────────────────

def _table_block_end(html: str, start: int) -> int:
    """从 `start`（'<table' 起点）深度配对，返回容器 '</table>' 结束位置。"""
    depth, i = 0, start
    while i < len(html):
        o = html.find("<table", i)
        c = html.find("</table>", i)
        if o != -1 and (c == -1 or o < c):
            depth += 1
            i = o + 6
        elif c != -1:
            depth -= 1
            if depth == 0:
                return c + 8
            i = c + 8
        else:
            break
    return -1


def _extract_media_block(html: str) -> Optional[str]:
    """按容器定位心水推荐/媒体分析板块，返回容器内去标签纯文本。

    定位优先级：
      1. 容器 id：porlet_18（近年主流）优先，porlet_xs（老页面）兜底；
         以标题校验确认是心水/推荐/媒体分析板块。
      2. 无 id 的布局 table（老页面 width=940）：按标题文本定位，
         取标题前最近的 <table 为容器起点做深度配对。
    找不到 → 返回 None（页面无该板块，宁缺毋滥，不用标题乱猜其它板块）。
    """
    # 1) 按容器 id 定位
    for cid in ("porlet_18", "porlet_xs"):
        m = re.search(r'<table[^>]*id="' + cid + r'"', html)
        if not m:
            continue
        head = html[m.end():m.end() + 400]
        if not re.search(r"心水|媒体分析|媒體分析", head):
            continue
        end = _table_block_end(html, m.start())
        if end < 0:
            continue
        block = html[m.start():end]
        return re.sub(r"<[^>]+>", "", block)
    # 2) 兜底：无 id 布局 table，按标题定位
    # 标题"心水推荐/心水推薦/媒体分析/媒體分析"存在多种字形变体
    # （"荐"有 U+4ECB/U+8350 两种字形），故用前缀"心水"或"媒体分析"锚定，
    # 后跟"推"（推/推薦任意字形），避免字形差异导致匹配失败。
    for anchor in ("心水", "媒体分析", "媒體分析"):
        m = re.search(r"<h3[^>]*>\s*" + re.escape(anchor) + r"[^<]*</h3>", html)
        if not m:
            continue
        start = html.rfind("<table", 0, m.start())
        if start < 0:
            continue
        end = _table_block_end(html, start)
        if end < 0:
            continue
        block = html[start:end]
        return re.sub(r"<[^>]+>", "", block)
    return None


def _norm_text(s: str) -> str:
    s = re.sub(r"&nbsp;", " ", s or "")
    # 保留全角空格 \u3000（用于标题/正文分隔），只压缩 ASCII 空白
    s = re.sub(r"[ \t\r\n]+", " ", s).strip()
    return s


def parse_media(html: str) -> dict:
    """媒体分析 → {home_trend, home_path, away_trend, away_path,
                 confidence_index, h2h_record, media_analysis}."""
    block = _extract_media_block(html)
    if not block:
        return {}
    text = _norm_text(block)
    # 去掉板块标题本身（媒体分析 / 心水推荐，兼容"荐"字形变体）
    text = re.sub(r"心水[^\s]{0,2}|媒體分析|媒体分析", "", text, count=1)
    text = text.strip()
    res = {}
    # 通用：匹配 "X 近况走势 - A 盘路(赢输)? - B" 两组（主客）
    # 兼容繁简体 + 同字异码点："走势/走勢"、"盘路/盤路"、"赢输/贏輸"（赢输存在多种字形变体，
    # 故"盘"后用懒匹配容忍任意 0~4 个非分隔字符，再要求 [-:]）
    _trend_pat = r"([^\s]{2,20}?)\s*近[况況]走[势勢]\s*[-:]\s*(\S+)\s*[盘盤][^-\s]{0,4}?\s*[-:]\s*(\S+)"
    trends = re.findall(_trend_pat, text)
    if len(trends) >= 1:
        res["media_home_trend"], res["media_home_path"] = trends[0][1], trends[0][2]
    if len(trends) >= 2:
        res["media_away_trend"], res["media_away_path"] = trends[1][1], trends[1][2]
    # 信心指数 / 信心指數
    m = re.search(r"信[心]指[数數]\s*[-:]\s*([^\s]+(?:\s*[^\s]+)?)", text)
    if m:
        res["confidence_index"] = m.group(1).strip()
    # 对赛成绩 / 對賽成績
    m = re.search(r"对[赛賽]成[绩績]\s*[-:]\s*([^\s]+(?:\s*[^\s]+)*?)(?=\s*[^\s]{2,}?乃|\s*$)", text)
    if m:
        res["h2h_record"] = m.group(1).strip()
    # 分析正文 = 去掉已知标签后的剩余长文本
    body = re.sub(_trend_pat, "", text)
    body = re.sub(r"信[心]指[数數]\s*[-:]\s*[^\s]+(?:\s*[^\s]+)?", "", body)
    body = re.sub(r"对[赛賽]成[绩績]\s*[-:]\s*[^\s]+(?:\s*[^\s]+)*?", "", body)
    body = _norm_text(body)
    if len(body) >= 10:
        res["media_analysis"] = body
    return res


def extract_media_only(schedule_id: int) -> dict:
    """只抓 nowscore 心水推荐/媒体分析（media），供 titan 页面补充。

    titan 分析页没有 media 字段（趋势/信心指数/对赛成绩/媒体分析），
    这些只在 nowscore analysis 页面上。失败返回空 dict，不阻塞。
    """
    out = {}
    try:
        html = fetch_analysis_page(schedule_id)
        if html:
            out.update(parse_media(html))
    except Exception:  # noqa: BLE001
        pass
    return out


# ─── 过滤（黑名单 + 年限） ─────────────────────────────────

def load_ignore_sclass() -> set:
    """加载 config/ignore_sclass.json 黑名单，返回 int set."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "config", "ignore_sclass.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {int(k) for k in (data.get("ignore_sclass") or {})}
    except (OSError, json.JSONDecodeError, ValueError):
        return {41}  # 至少球会友谊


def filter_records(rows: list, ignore: set, reference=None, years: int = H2H_YEARS) -> list:
    """剔除黑名单赛事 + 超年限记录（按 match_date 年份）。

    reference = 本场比赛开赛日期；保留 match_date.year >= reference.year - years。
    只比较年份，不精确到月/日（2015-08 开赛 → 2010 年 1~8 月记录也保留）。
    reference 缺省时退化为以今天为基准。
    """
    if reference is None:
        reference = dt.date.today()
    cutoff_year = reference.year - years
    out = []
    for r in rows:
        if r.get("sclass_id") in ignore:
            continue
        d = r.get("match_date")
        if d:
            try:
                if dt.date.fromisoformat(d).year < cutoff_year:
                    continue
            except ValueError:
                pass
        out.append(r)
    return out
