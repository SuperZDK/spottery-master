"""
Analysis 三表写入层（psycopg3 直连 titan 库）。

表：
  titan_analysis_matches — 主表（比赛信息 + 赛前情报 + standings/lineup JSONB）
  titan_analysis_h2h     — 交锋每条一行
  titan_analysis_recent  — 近期每条一行

输入：ns_parser.extract_analysis() 的返回 dict。
幂等：全部 ON CONFLICT 更新，重复调用安全。
"""
import json

from core import db as _db


def _connect():
    return _db.connect()


def upsert_analysis(schedule_id: int, matches: dict, h2h: list,
                    recent_home: list, recent_away: list) -> dict:
    """写入一场比赛的三表数据。返回 {matches, h2h, recent} 实际影响行数。"""
    conn = _connect()
    stats = {"matches": 0, "h2h": 0, "recent": 0}
    try:
        with conn.cursor() as cur:
            # 1) 主表
            cur.execute(
                """INSERT INTO titan_analysis_matches
                     (schedule_id, competition_id, competition_name_en, season,
                      home_team_id, away_team_id, home_team, away_team, match_time,
                      media_home_trend, media_home_path, media_away_trend, media_away_path,
                      confidence_index, h2h_record, media_analysis,
                      standings)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (schedule_id) DO UPDATE SET
                     competition_id=EXCLUDED.competition_id,
                     competition_name_en=EXCLUDED.competition_name_en,
                     season=EXCLUDED.season, home_team_id=EXCLUDED.home_team_id,
                     away_team_id=EXCLUDED.away_team_id, home_team=EXCLUDED.home_team,
                     away_team=EXCLUDED.away_team, match_time=EXCLUDED.match_time,
                     media_home_trend=EXCLUDED.media_home_trend, media_home_path=EXCLUDED.media_home_path,
                     media_away_trend=EXCLUDED.media_away_trend, media_away_path=EXCLUDED.media_away_path,
                     confidence_index=EXCLUDED.confidence_index, h2h_record=EXCLUDED.h2h_record,
                     media_analysis=EXCLUDED.media_analysis, standings=EXCLUDED.standings,
                     scraped_at=now()""",
                [schedule_id,
                 matches.get("competition_id"), matches.get("competition_name_en"), matches.get("season"),
                 matches.get("home_team_id"), matches.get("away_team_id"),
                 matches.get("home_team"), matches.get("away_team"), matches.get("match_time"),
                 matches.get("media_home_trend"), matches.get("media_home_path"),
                 matches.get("media_away_trend"), matches.get("media_away_path"),
                 matches.get("confidence_index"), matches.get("h2h_record"),
                 matches.get("media_analysis"),
                 json.dumps(matches["standings"], ensure_ascii=False) if matches.get("standings") else None])
            stats["matches"] = cur.rowcount

            # 2) h2h
            for h in h2h:
                cur.execute(
                    """INSERT INTO titan_analysis_h2h
                         (schedule_id, match_date, sclass_id, home_team_id, away_team_id,
                          home_team, away_team, home_score, away_score, half_score, ref_schedule_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (schedule_id, match_date, home_team_id, away_team_id) DO UPDATE SET
                         sclass_id=EXCLUDED.sclass_id, home_team=EXCLUDED.home_team,
                         away_team=EXCLUDED.away_team, home_score=EXCLUDED.home_score,
                         away_score=EXCLUDED.away_score, half_score=EXCLUDED.half_score,
                         ref_schedule_id=EXCLUDED.ref_schedule_id""",
                    [schedule_id, h.get("match_date"), h.get("sclass_id"),
                     h.get("home_team_id"), h.get("away_team_id"),
                     h.get("home_team"), h.get("away_team"),
                     h.get("home_score"), h.get("away_score"),
                     h.get("half_score"), h.get("ref_schedule_id")])
                stats["h2h"] += cur.rowcount

            # 3) recent
            for side, recs in (("home", recent_home), ("away", recent_away)):
                for r in recs:
                    cur.execute(
                        """INSERT INTO titan_analysis_recent
                             (schedule_id, side, match_date, sclass_id, home_team_id, away_team_id,
                              home_team, away_team, home_score, away_score, half_score, ref_schedule_id)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (schedule_id, side, match_date, home_team_id, away_team_id) DO UPDATE SET
                             sclass_id=EXCLUDED.sclass_id, home_team=EXCLUDED.home_team,
                             away_team=EXCLUDED.away_team, home_score=EXCLUDED.home_score,
                             away_score=EXCLUDED.away_score, half_score=EXCLUDED.half_score,
                             ref_schedule_id=EXCLUDED.ref_schedule_id""",
                        [schedule_id, side, r.get("match_date"), r.get("sclass_id"),
                         r.get("home_team_id"), r.get("away_team_id"),
                         r.get("home_team"), r.get("away_team"),
                         r.get("home_score"), r.get("away_score"),
                         r.get("half_score"), r.get("ref_schedule_id")])
                    stats["recent"] += cur.rowcount

            conn.commit()
    finally:
        conn.close()
    return stats


def analysis_exists(schedule_id: int) -> bool:
    """主表是否已有该场。"""
    try:
        conn = _connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM titan_analysis_matches WHERE schedule_id=%s", [schedule_id])
                return cur.fetchone() is not None
        finally:
            conn.close()
    except Exception:
        return False
