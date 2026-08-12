import { useQuery } from "@tanstack/react-query"
import { teamsApi } from "@/api/teams"

export function useTeams(leagueId?: number) {
  return useQuery({
    queryKey: ["teams", { leagueId }],
    queryFn: () => teamsApi.list(leagueId),
  })
}

export function useTeam(id: number) {
  return useQuery({
    queryKey: ["team", id],
    queryFn: () => teamsApi.getById(id),
    enabled: !!id,
  })
}

export function useStandings(leagueId: number) {
  return useQuery({
    queryKey: ["standings", leagueId],
    queryFn: () => teamsApi.getStandings(leagueId),
    enabled: !!leagueId,
    staleTime: 300_000,
  })
}

export function useLeagues() {
  return useQuery({
    queryKey: ["leagues"],
    queryFn: () => teamsApi.listLeagues(),
  })
}
