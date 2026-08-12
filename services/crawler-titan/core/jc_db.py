"""jc_workset 的 DB 写入层：赛程 + 赔率直写 titan 库（废弃 JSON 落盘）。

表：
  titan_jc_schedule     — 竞彩赛程（upsert，ON CONFLICT (sid) DO UPDATE）
  titan_competitions    — 赛事维度（upsert）
  titan_teams           — 球队维度（upsert）
  titan_euro_odds       — 欧赔快照（append-only，ON CONFLICT DO NOTHING）
  titan_asian_odds      — 亚盘快照（append-only）
  titan_over_under_odds — 大小球快照（append-only）

列映射 / 值转换与 scripts/import-to-pg.ts 保持一致：
  - change_time 用 infer_year 补年份（球探原始时间 "M-d HH:MM" 无年份）
  - 亚盘盘口中文 → 数值走 asian_line_to_value
"""
import re

from core import db


def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return f if f == f else None
    except (ValueError, TypeError):
        return None


def _int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _ts(v):
    """'2026-08-01 18:30' / ISO 原样；纯日期 '2026-08-01' 补 ' 00:00'；校验月/日合法。"""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", s):
        s += " 00:00"
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}:\d{2})", s)
    if not m:
        return None
    mon, day = int(m.group(2)), int(m.group(3))
    if mon < 1 or mon > 12 or day < 1 or day > 31:
        return None
    return s


def _parse_score(s):
    """'0-3' → (0,3)；空/非法 → (None,None)。"""
    if not s or not isinstance(s, str):
        return None, None
    p = s.split("-")
    if len(p) != 2:
        return None, None
    return _int(p[0]), _int(p[1])


def _infer_year(match_time, mdy):
    """赔率时间 'M-d HH:MM'（可带 (初盘) 后缀）结合本场 kickoff 推断年份。"""
    if not match_time or not mdy:
        return None
    mt = re.match(r"^(\d{4})-(\d{1,2})", str(match_time))
    if not mt:
        return None
    Y, M0 = int(mt.group(1)), int(mt.group(2))
    c = re.match(r"^(\d{1,2})-(\d{1,2})\s+(\d{1,2}:\d{2})",
                 str(mdy).replace("(初盘)", "").strip())
    if not c:
        return None
    M, D = int(c.group(1)), int(c.group(2))
    if M < 1 or M > 12 or D < 1 or D > 31:
        return None
    year = Y - 1 if M > M0 else Y
    return f"{year}-{M:02d}-{D:02d} {c.group(3)}"


CN_NUM = {"平": 0, "半": 0.5, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4,
          "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _term_value(t):
    if t == "平手":
        return 0
    if t == "半球":
        return 0.5
    if t == "球半":
        return 1.5
    if t == "平":
        return 0
    if t == "半":
        return 0.5
    if t.endswith("球半"):
        n = CN_NUM.get(t[0])
        return None if n is None else n + 0.5
    if t.endswith("球"):
        n = CN_NUM.get(t[0])
        return None if n is None else n
    if len(t) == 1 and t in CN_NUM:
        return CN_NUM[t]
    return None


def asian_line_to_value(line):
    """亚盘盘口中文 → 数值（'受让'前缀取负；'X/Y'取中点；'平手'=0）。"""
    if line is None:
        return None
    s = str(line).strip()
    if not s:
        return None
    neg = False
    if s.startswith("受让"):
        neg, s = True, s[2:]
    elif s.startswith("受"):
        neg, s = True, s[1:]
    parts = s.split("/")
    if len(parts) == 1:
        v = _term_value(parts[0])
    elif len(parts) == 2:
        a, b = _term_value(parts[0]), _term_value(parts[1])
        v = (a + b) / 2 if (a is not None and b is not None) else None
    else:
        v = None
    if v is None:
        return None
    return -v if neg else v


# ─── 赛程 / 维度 ─────────────────────────────────────────────

JC_COLS = ["sid", "business_date", "kickoff_time", "status", "match_num", "sclass_id",
           "sub_id", "home_team_id", "away_team_id", "home_team", "away_team",
           "home_team_en", "away_team_en", "full_score", "half_score", "home_score", "away_score"]
JC_TAIL = ("ON CONFLICT (sid) DO UPDATE SET "
           + ", ".join(f"{c}=EXCLUDED.{c}" for c in JC_COLS[1:])
           + ", updated_at=now()")


def upsert_jc_schedule(conn, m):
    """upsert 一条竞彩赛程（bf_jc 在售 / JcResult 完赛 / 无效场次 -10 皆可）。"""
    if not m or m.get("sid") is None:
        return False
    hs, as_ = _parse_score(m.get("full_score"))
    if hs is None and m.get("home_score") is not None:
        hs, as_ = m.get("home_score"), m.get("away_score")
    row = [m.get("sid"), m.get("business_date"), _ts(m.get("kickoff")), m.get("status"),
           m.get("match_num"), m.get("sclass_id"), m.get("sub_id"),
           m.get("home_team_id"), m.get("away_team_id"),
           m.get("home_team"), m.get("away_team"),
           m.get("home_team_en"), m.get("away_team_en"),
           m.get("full_score"), m.get("half_score"), hs, as_]
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO titan_jc_schedule ({','.join(JC_COLS)}) "
            f"VALUES ({','.join(['%s'] * len(JC_COLS))}) {JC_TAIL}", row)
    return True


def upsert_competition(conn, c):
    if not c or not c.get("sclass_id"):
        return
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO titan_competitions (competition_id, name_cn, is_cup)
               VALUES (%s, %s, %s)
               ON CONFLICT (competition_id) DO UPDATE SET
                 name_cn=EXCLUDED.name_cn, is_cup=EXCLUDED.is_cup, updated_at=now()""",
            [c["sclass_id"], c.get("name_cn"), bool(c.get("is_cup"))])


def upsert_team(conn, team_id, name_cn, name_en=None):
    if not team_id:
        return
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO titan_teams (team_id, name_cn, name_en)
               VALUES (%s, %s, %s)
               ON CONFLICT (team_id) DO UPDATE SET
                 name_cn=EXCLUDED.name_cn, name_en=EXCLUDED.name_en, updated_at=now()""",
            [team_id, name_cn, name_en])


# ─── 赔率三表（append-only）───────────────────────────────────

EURO_COLS = ["schedule_id", "company_id", "change_time", "home_win", "draw", "away_win",
             "home_win_rate", "draw_rate", "away_win_rate", "payout_rate",
             "kelly_home", "kelly_draw", "kelly_away", "is_initial"]
ASIAN_COLS = ["schedule_id", "company_id", "subtype", "change_time",
              "line_raw", "line_value", "home_odds", "away_odds", "status"]
OU_COLS = ["schedule_id", "company_id", "subtype", "change_time",
           "score", "line_raw", "over_odds", "under_odds", "status"]


def insert_odds(conn, odds_type, schedule_id, company_id, subtype, change, kickoff):
    """插入一条赔率快照（append-only）。重复键直接忽略。"""
    if schedule_id is None or company_id is None:
        return False
    ct = _infer_year(kickoff, change.get("time"))
    if not ct:
        return False
    with conn.cursor() as cur:
        if odds_type == "european":
            cur.execute(
                f"INSERT INTO titan_euro_odds ({','.join(EURO_COLS)}) "
                f"VALUES ({','.join(['%s'] * len(EURO_COLS))}) ON CONFLICT DO NOTHING",
                [schedule_id, company_id, ct,
                 _num(change.get("home_win")), _num(change.get("draw")), _num(change.get("away_win")),
                 _num(change.get("home_win_rate")), _num(change.get("draw_rate")), _num(change.get("away_win_rate")),
                 _num(change.get("payout_rate")),
                 _num(change.get("kelly_home")), _num(change.get("kelly_draw")), _num(change.get("kelly_away")),
                 bool(change["is_initial"]) if change.get("is_initial") is not None else None])
        elif odds_type == "asian":
            cur.execute(
                f"INSERT INTO titan_asian_odds ({','.join(ASIAN_COLS)}) "
                f"VALUES ({','.join(['%s'] * len(ASIAN_COLS))}) ON CONFLICT DO NOTHING",
                [schedule_id, company_id, subtype, ct,
                 change.get("line"), asian_line_to_value(change.get("line")),
                 _num(change.get("home")), _num(change.get("away")), change.get("status")])
        elif odds_type == "over_under":
            cur.execute(
                f"INSERT INTO titan_over_under_odds ({','.join(OU_COLS)}) "
                f"VALUES ({','.join(['%s'] * len(OU_COLS))}) ON CONFLICT DO NOTHING",
                [schedule_id, company_id, subtype, ct,
                 change.get("score"), change.get("line"),
                 _num(change.get("big")), _num(change.get("small")), change.get("status")])
        else:
            return False
        return cur.rowcount > 0
