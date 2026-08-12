import client from "./client"
import type { Prediction, H2HRecord, TeamForm, Briefing } from "@/types/analysis"
import type { MatchComparison, MatchInjuries } from "@/types/team"

export const analysisApi = {
  getPrediction: (matchId: number) =>
    client.get<Prediction>(`/matches/${matchId}/analysis`).then((r) => r.data),

  getBriefing: (matchId: number) =>
    client.get<Briefing>(`/matches/${matchId}/briefing`).then((r) => r.data),

  getH2H: (team1Id: number, team2Id: number) =>
    client.get<H2HRecord[]>("/analysis/h2h", {
      params: { team1_id: team1Id, team2_id: team2Id },
    }).then((r) => r.data),

  getTeamForm: (teamId: number) =>
    client.get<TeamForm>(`/analysis/teams/${teamId}/form`).then((r) => r.data),

  getComparison: (matchId: number) =>
    client.get<MatchComparison>(`/matches/${matchId}/comparison`).then((r) => r.data),

  getInjuries: (matchId: number) =>
    client.get<MatchInjuries>(`/matches/${matchId}/injuries`).then((r) => r.data),
}
