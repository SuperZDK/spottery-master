import { useQuery } from "@tanstack/react-query"
import { oddsApi } from "@/api/odds"

export function useOdds(matchId: number, staleTime?: number) {
  return useQuery({
    queryKey: ["odds", matchId],
    queryFn: () => oddsApi.getByMatch(matchId),
    enabled: !!matchId,
    staleTime,
  })
}

export function useOddsHistory(matchId: number, oddsType: string = "SPF", bookmaker?: string, enabled: boolean = true, staleTime?: number) {
  return useQuery({
    queryKey: ["odds-history", matchId, oddsType, bookmaker],
    queryFn: () => oddsApi.getHistory(matchId, oddsType, bookmaker),
    enabled: !!matchId && enabled,
    staleTime,
  })
}
