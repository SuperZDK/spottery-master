export interface RoundInfo {
  round: number
  slug?: string
  name?: string
  prefix?: string
  nameCn?: string
}

export interface LeagueConfig {
  id: number
  name: string
  shortName: string
  slug: string
  country: string
  countryId: number
  tier: number
  type: "league" | "cup"
  rounds?: RoundInfo[]
  seasonRounds?: Record<string, RoundInfo[]>
  seasonIds: Record<string, number>
}

export interface SourceConfig {
  id: string
  name: string
  enabled: boolean
  baseUrl: string
  apiBaseUrl: string
  leagues: LeagueConfig[]
}

export interface ScraperEndpoint {
  path: string
  method: "GET" | "POST"
  description: string
}

export interface RateLimitConfig {
  requestsPerSecond: number
  maxConcurrency: number
  retryCount: number
  retryDelayMs: number
}

export interface ScraperIntervals {
  liveMatches: string
  dailyMatches: string
  leagueStandings: string
  oddsUpdate: string
  teamInfo: string
}

export interface RequestConfig {
  headers: Record<string, string>
  referer: string
  userAgents: string[]
  deviceId?: string
}

export interface AntiDetectionConfig {
  enableStealth: boolean
  randomDelayMs: [number, number]
  rotateUserAgent: boolean
  useProxy: boolean
}

export interface ScraperConfig {
  source: SourceConfig
  endpoints: Record<string, ScraperEndpoint>
  request: RequestConfig
  antiDetection: AntiDetectionConfig
  rateLimit: RateLimitConfig
  intervals: ScraperIntervals
}

export interface TeamInfo {
  name: string
  slug: string
  shortName: string
  userCount: number
  nameCode: string
  country: { alpha2: string; alpha3: string; name: string; slug: string }
  id: number
  teamColors: { primary?: string; secondary?: string; text?: string }
}

export interface ScoreInfo {
  current?: number
  display?: number
  period1?: number
  period2?: number
  normaltime?: number
}

export interface MatchRecord {
  id: number
  slug: string
  tournament: { name: string; slug: string; category: { name: string; slug: string } }
  season: { name: string; year: string; id: number }
  roundInfo: { round: number; name?: string; slug?: string; prefix?: string; cupRoundType?: number }
  status: { code: number; description: string; type: string }
  winnerCode: number
  homeTeam: TeamInfo
  awayTeam: TeamInfo
  homeScore: ScoreInfo
  awayScore: ScoreInfo
  hasXg: boolean
  hasEventPlayerStatistics: boolean
  hasEventPlayerHeatMap: boolean
  startTimestamp: number
  date: string
  finalResultOnly: boolean
}

export interface SeasonSchedule {
  league: { id: number; name: string; shortName: string; slug: string; country: string }
  season: string
  seasonId: number
  matches: MatchRecord[]
}

// ============ Match Detail Types ============

export interface PregameForm {
  homeTeam: { avgRating: string; position: number; value: string; form: string[] }
  awayTeam: { avgRating: string; position: number; value: string; form: string[] }
  label: string
}

export interface MatchVotes {
  vote: { vote1: number; vote2: number; voteX: number }
  bothTeamsToScoreVote: { voteYes: number; voteNo: number }
  firstTeamToScoreVote: { voteHome: number; voteAway: number; voteNoGoal: number }
}

export interface LineupPlayer {
  player: { name: string; id: number; slug?: string }
  shirtNumber: number
  position: "G" | "D" | "M" | "F"
  substitute: boolean
  statistics: { rating: number | null; minutesPlayed?: number } & Record<string, any>
}

export interface MissingPlayer {
  player: { name: string; id: number; position?: string }
  type: string
  description?: string
  expectedEndDate?: string
}

export interface LineupSide {
  formation: string
  players: LineupPlayer[]
  missingPlayers: MissingPlayer[]
}

export interface MatchLineups {
  confirmed: boolean
  home: LineupSide
  away: LineupSide
}

export interface Incident {
  id: number
  time: number
  incidentType: string
  incidentClass?: string
  isHome: boolean
  player?: { name: string; id: number }
  homeScore?: number
  awayScore?: number
  reason?: string
  text?: string
  assist1?: { name: string; id: number }
  replacementPlayer?: { name: string; id: number }
}

export interface StatGroup {
  groupName: string
  statisticsItems: {
    name: string
    home: string
    away: string
    homeValue: number
    awayValue: number
  }[]
}

export interface MatchPeriodStats {
  period: string
  groups: StatGroup[]
}

export interface MatchDetail {
  matchId: number
  league: { id: number; name: string; shortName: string }
  season: string
  seasonId: number
  slug?: string
  startTimestamp?: number
  status?: string
  homeScore?: number | null
  awayScore?: number | null
  referee?: string
  venue?: string
  attendance?: number
  pregameForm?: PregameForm
  votes?: MatchVotes
  lineups?: MatchLineups
  statistics?: MatchPeriodStats[]
  incidents?: Incident[]
}

export interface TeamSeasonStats {
  teamId: number
  leagueId: number
  seasonId: number
  statistics: Record<string, any>
}
