export interface Briefing {
  match_id?: number
  title?: string | null
  content: string | null
}

export interface Prediction {
  match_id: number
  home_prob: number
  draw_prob: number
  away_prob: number
  confidence: number
  model_version: string
  predicted_result: string
}

export interface H2HRecord {
  match_id: number
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  match_time: string
  league: string
  home_spf?: number | null
  draw_spf?: number | null
  away_spf?: number | null
}

export interface TeamForm {
  team_id: number
  team_name: string
  results: Array<{
    match_id: number
    result: "W" | "D" | "L"
    home: boolean
    opponent: string
    score: string
    match_time: string
    home_spf?: number | null
    draw_spf?: number | null
    away_spf?: number | null
  }>
}
