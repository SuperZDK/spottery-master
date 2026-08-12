import { useQuery } from "@tanstack/react-query"
import { analysisApi } from "@/api/analysis"

const STATIC_STALE = 3_600_000
const SLOW_STALE = 1_800_000

export function usePrediction(matchId: number, staleTime: number = STATIC_STALE) {
  return useQuery({
    queryKey: ["prediction", matchId],
    queryFn: () => analysisApi.getPrediction(matchId),
    enabled: !!matchId,
    staleTime,
  })
}

export function useH2H(team1Id: number, team2Id: number, staleTime: number = SLOW_STALE) {
  return useQuery({
    queryKey: ["h2h", team1Id, team2Id],
    queryFn: () => analysisApi.getH2H(team1Id, team2Id),
    enabled: !!team1Id && !!team2Id,
    staleTime,
  })
}

export function useTeamForm(teamId: number, staleTime: number = SLOW_STALE) {
  return useQuery({
    queryKey: ["team-form", teamId],
    queryFn: () => analysisApi.getTeamForm(teamId),
    enabled: !!teamId,
    staleTime,
  })
}

export function useBriefing(matchId: number, staleTime: number = STATIC_STALE) {
  return useQuery({
    queryKey: ["briefing", matchId],
    queryFn: () => analysisApi.getBriefing(matchId),
    enabled: !!matchId,
    staleTime,
  })
}

export function useMatchComparison(matchId: number, staleTime: number = SLOW_STALE) {
  return useQuery({
    queryKey: ["match-comparison", matchId],
    queryFn: () => analysisApi.getComparison(matchId),
    enabled: !!matchId,
    staleTime,
  })
}

export function useMatchInjuries(matchId: number, staleTime: number = SLOW_STALE) {
  return useQuery({
    queryKey: ["match-injuries", matchId],
    queryFn: () => analysisApi.getInjuries(matchId),
    enabled: !!matchId,
    staleTime,
  })
}
