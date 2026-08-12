export type MatchStatus = "UPCOMING" | "LIVE" | "FINISHED" | string

export interface Match {
  id: number
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  half_score: string | null
  match_time: string
  status: MatchStatus
  league: string
  league_id: number | null
  home_team_id: number | null
  away_team_id: number | null
  match_num?: string
}

export interface MatchListParams {
  league?: string
  date?: string
  status?: MatchStatus
  page?: number
  page_size?: number
}

export interface StandingSnapshot {
  view: string
  team_name: string
  position: number | null
  points: number | null
  played: number | null
  wins: number | null
  draws: number | null
  losses: number | null
  goals_for: number | null
  goals_against: number | null
  goal_diff: number | null
}

export interface MatchStandings {
  home: StandingSnapshot[]
  away: StandingSnapshot[]
}

export interface MatchOdds {
  current: import("@/types/odds").OddsItem[]
  history: Record<string, import("@/types/odds").OddsHistoryPoint[]>
}

export interface Briefing {
  title: string | null
  content: string | null
}

export interface H2HItem {
  match_time: string | null
  league: string | null
  home_team: string | null
  away_team: string | null
  home_score: number | null
  away_score: number | null
}

export interface FormItem {
  match_time: string | null
  league: string | null
  opponent: string | null
  is_home: boolean | null
  home_score: number | null
  away_score: number | null
}

export interface TeamFormBlock {
  home: FormItem[]
  away: FormItem[]
}

export interface MatchDetail {
  match: Match
  odds: MatchOdds
  source: "workset" | "db"
  briefing?: Briefing | null
  h2h?: H2HItem[]
  form?: TeamFormBlock | null
  standings?: {
    home: StandingSnapshot | null
    away: StandingSnapshot | null
  } | null
}
