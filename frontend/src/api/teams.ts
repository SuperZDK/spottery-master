import client from "./client"
import type { Team, League, Standing } from "@/types/team"

export const teamsApi = {
  list: (leagueId?: number) =>
    client
      .get<Team[]>("/teams", { params: leagueId ? { league_id: leagueId } : undefined })
      .then((r) => r.data),

  getById: (id: number) =>
    client.get<Team>(`/teams/${id}`).then((r) => r.data),

  listLeagues: () =>
    client.get<League[]>("/leagues").then((r) => r.data),

  getStandings: (leagueId: number) =>
    client.get<Standing[]>(`/leagues/${leagueId}/standings`).then((r) => r.data),
}
