from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class Odds3(BaseModel):
    home: Optional[float] = None
    draw: Optional[float] = None
    away: Optional[float] = None


class RqSpfOdds(Odds3):
    goal_line: Optional[str] = None


class BetOption(BaseModel):
    label: str
    odds: float


class MatchOdds(BaseModel):
    spf: Optional[Odds3] = None
    rqspf: Optional[RqSpfOdds] = None
    ttg: Optional[List[BetOption]] = None
    hafu: Optional[List[BetOption]] = None
    crs: Optional[List[BetOption]] = None


class DailyMatch(BaseModel):
    match_id: int
    match_num: str
    league: str
    home_team: str
    away_team: str
    kickoff_time: str
    status: str
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    singles: dict = {}
    odds: MatchOdds


class DailyMatchesResponse(BaseModel):
    date: str
    weekday: str
    source: str  # "workset" | "db"
    matches: List[DailyMatch]


# ── 比赛详情（统一详情接口 /matches/{id}?source=jingcai|titan|sofascore）─────────

class MatchInfo(BaseModel):
    id: int
    match_num: str
    league: str
    home_team: str
    away_team: str
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    half_score: Optional[str] = None
    match_time: Optional[str] = None
    status: str
    pool_status: Optional[str] = None
    league_id: Optional[int] = None
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None
    singles: Dict[str, int] = {}


class OddsHistoryPoint(BaseModel):
    time: Optional[str] = None
    home: Optional[float] = None
    draw: Optional[float] = None
    away: Optional[float] = None
    handicap: Optional[str] = None
    options: Optional[Dict[str, Any]] = None


class OddsItem(BaseModel):
    id: int
    match_id: int
    bookmaker: str
    odds_type: str
    initial_home: Optional[float] = None
    initial_draw: Optional[float] = None
    initial_away: Optional[float] = None
    current_home: Optional[float] = None
    current_draw: Optional[float] = None
    current_away: Optional[float] = None
    update_time: Optional[str] = None


class MatchOddsDetail(BaseModel):
    current: List[OddsItem] = []
    history: Dict[str, List[OddsHistoryPoint]] = {}


class Briefing(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class H2HItem(BaseModel):
    match_time: Optional[str] = None
    league: Optional[str] = None
    home_team: Optional[str] = None
    away_team: Optional[str] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None


class FormItem(BaseModel):
    match_time: Optional[str] = None
    league: Optional[str] = None
    opponent: Optional[str] = None
    is_home: Optional[bool] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None


class TeamFormBlock(BaseModel):
    home: List[FormItem] = []
    away: List[FormItem] = []


class StandingSnapshot(BaseModel):
    team_name: Optional[str] = None
    position: Optional[int] = None
    points: Optional[int] = None
    played: Optional[int] = None
    wins: Optional[int] = None
    draws: Optional[int] = None
    losses: Optional[int] = None
    goals_for: Optional[int] = None
    goals_against: Optional[int] = None
    goal_diff: Optional[int] = None


class StandingsBlock(BaseModel):
    home: Optional[StandingSnapshot] = None
    away: Optional[StandingSnapshot] = None


class MatchDetailResponse(BaseModel):
    match: MatchInfo
    odds: MatchOddsDetail
    source: str = "workset"  # "workset"（在售）| "db"（已排干）
    briefing: Optional[Briefing] = None
    h2h: List[H2HItem] = []
    form: Optional[TeamFormBlock] = None
    standings: Optional[StandingsBlock] = None
