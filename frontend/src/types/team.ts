export interface Team {
  id: number
  name: string
  short_name: string | null
  logo_url: string | null
  league_id: number | null
  country: string | null
}

export interface League {
  id: number
  name: string
  country: string | null
  season: string | null
  logo_url: string | null
}

export interface Standing {
  position: number
  team_id: number
  team_name: string
  played: number
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
  home_played: number
  home_wins: number
  home_draws: number
  home_losses: number
  home_goals_for: number
  home_goals_against: number
  away_played: number
  away_wins: number
  away_draws: number
  away_losses: number
  away_goals_for: number
  away_goals_against: number
  form: string[]
}

export interface StatRow {
  played: number
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
  rank: number | null
  win_rate: number
}

export interface TeamComparison {
  league_label: string
  team_name: string
  fulltime: {
    total: StatRow
    home: StatRow
    away: StatRow
    recent6: StatRow
  }
  halftime: {
    total: StatRow
    home: StatRow
    away: StatRow
    recent6: StatRow
  }
}

export interface MatchComparison {
  match_id: number
  home: TeamComparison
  away: TeamComparison
}

export interface InjuryPlayer {
  name: string
  position: string
  tag: "主力" | "核心" | null
}

export interface MatchInjuries {
  match_id: number
  home: InjuryPlayer[]
  away: InjuryPlayer[]
}
