export enum OddsType {
  SPF = "SPF",
  RQSPF = "RQSPF",
  BF = "BF",
  ZJQ = "ZJQ",
  BQC = "BQC",
}

export interface OddsItem {
  id: number
  match_id: number
  bookmaker: string
  odds_type: OddsType
  initial_home: number | null
  initial_draw: number | null
  initial_away: number | null
  current_home: number | null
  current_draw: number | null
  current_away: number | null
  update_time: string
}

export interface OddsHistoryPoint {
  home: number | null
  draw: number | null
  away: number | null
  time: string
  handicap?: string | null
  options?: Record<string, number | null>
}

export interface OddsHistoryResponse {
  match_id: number
  bookmaker: string
  odds_type: string
  history: OddsHistoryPoint[]
}

export interface BetOption {
  label: string
  odds: number
}

export interface SpfOdds {
  home: number
  draw: number
  away: number
}

export interface RqSpfOdds extends SpfOdds {
  goal_line: string | null
}

export interface MatchOddsBlock {
  spf: SpfOdds | null
  rqspf: RqSpfOdds | null
  ttg: BetOption[] | null
  hafu: BetOption[] | null
  crs: BetOption[] | null
}

export interface BettingMatch {
  match_id: number
  match_num: string
  league: string
  home_team: string
  away_team: string
  kickoff_time: string
  status: string
  home_score: number | null
  away_score: number | null
  singles: Record<string, number>
  odds: MatchOddsBlock
}

export interface BettingResponse {
  date: string
  weekday: string
  source: "workset" | "db" | "empty"
  matches: BettingMatch[]
}
