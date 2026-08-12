import { useQuery } from "@tanstack/react-query"
import { matchesApi } from "@/api/matches"
import type { MatchListParams } from "@/types/match"

export function useMatches(params?: MatchListParams) {
  return useQuery({
    queryKey: ["matches", params],
    queryFn: () => matchesApi.list(params),
  })
}

export function useMatchDetail(id: number) {
  return useQuery({
    queryKey: ["match-detail", id],
    queryFn: () => matchesApi.getById(id),
    enabled: !!id,
    staleTime: (query) => (query.state.data?.source === "workset" ? 30_000 : 300_000),
    refetchInterval: (query) => (query.state.data?.source === "workset" ? 60_000 : false),
  })
}
