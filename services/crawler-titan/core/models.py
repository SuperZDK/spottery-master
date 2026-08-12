from dataclasses import dataclass, field
from typing import Optional, Any

@dataclass
class MatchInfo:
    schedule_id: int
    hometeam: str
    guestteam: str
    match_time: str
    league_id: int
    league_name_cn: str
    season: str
    weather: Optional[str] = None
    temperature: Optional[str] = None
    referee: Optional[str] = None
    venue: Optional[str] = None

@dataclass
class RecentMatch:
    date: str
    comp_type: int
    comp_name: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    full_score: str
    handicap: str
    schedule_id: int
    is_home_side: bool
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None
    extra: dict = field(default_factory=dict)

@dataclass
class H2HMatch:
    date: str
    comp_name: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    full_score: str
    handicap: str
    schedule_id: int
    comp_type: Optional[int] = None
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None
    extra: dict = field(default_factory=dict)

@dataclass
class StandingRow:
    rank: int
    team_name: str
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    goal_diff: int
    points: int
    extra: dict = field(default_factory=dict)

@dataclass
class Standings:
    home_team: str
    away_team: str
    home_standing: Optional[StandingRow] = None
    away_standing: Optional[StandingRow] = None

@dataclass
class TipRecommendation:
    confidence_index: Optional[str] = None
    h2h_record: Optional[str] = None
    analysis: Optional[str] = None

@dataclass
class Lineup:
    home_formation: Optional[str] = None
    away_formation: Optional[str] = None
    home_starting: list = field(default_factory=list)
    away_starting: list = field(default_factory=list)
    home_subs: list = field(default_factory=list)
    away_subs: list = field(default_factory=list)
    home_coach: Optional[str] = None
    away_coach: Optional[str] = None
    home_injuries: list = field(default_factory=list)
    away_injuries: list = field(default_factory=list)
    home_ratings: list = field(default_factory=list)
    away_ratings: list = field(default_factory=list)
    raw_html: Optional[str] = None

# ─── Asian Handicap Odds ───

@dataclass
class AsianOddsItem:
    company_id: int
    company_name: str = ""
    changes: list = field(default_factory=list)

# ─── Over/Under Odds ───

@dataclass
class OverUnderItem:
    company_id: int
    company_name: str = ""
    changes: list = field(default_factory=list)

# ─── European Odds ───

@dataclass
class EuroOddsItem:
    company_id: int
    company_name: str = ""
    changes: list = field(default_factory=list)

# ─── OddsData (keep for backward compat) ───

@dataclass
class OddsData:
    asian: list = field(default_factory=list)

# ─── Analysis Page ───

@dataclass
class AnalysisPage:
    version: str
    match_info: MatchInfo
    recent_home: list = field(default_factory=list)
    recent_away: list = field(default_factory=list)
    recent_home_home: list = field(default_factory=list)
    recent_away_away: list = field(default_factory=list)
    h2h: list = field(default_factory=list)
    standings: Optional[Standings] = None
    lineup: Optional[Lineup] = None
    match_preview: Optional[str] = None
    odds: Optional[OddsData] = None
    tip: Optional[TipRecommendation] = None
    raw_js_data: dict = field(default_factory=dict)

@dataclass
class MatchSchedule:
    schedule_id: int
    league_id: int
    round: Optional[int] = None
    match_time: str = ""
    home_id: int = 0
    away_id: int = 0
    home_team: str = ""
    away_team: str = ""
    home_score: Optional[str] = None
    away_score: Optional[str] = None
    half_score: Optional[str] = None
    status: int = 0
    extra: dict = field(default_factory=dict)

@dataclass
class SeasonData:
    competition_id: int
    competition_name: str
    season: str
    rounds: dict = field(default_factory=dict)
    matches: list = field(default_factory=list)
