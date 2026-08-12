import { useMatches } from "@/hooks/useMatches"
import { useMatchStore } from "@/stores/matchStore"
import MatchCard from "@/components/shared/MatchCard"
import LoadingSpinner from "@/components/shared/LoadingSpinner"

export default function MatchList() {
  const filters = useMatchStore()
  const { data: matches, isLoading, error } = useMatches({
    league: filters.league ?? undefined,
    date: filters.date ?? undefined,
    status: filters.status ?? undefined,
  })

  if (isLoading) return <LoadingSpinner />
  if (error) return <p className="text-destructive">加载失败</p>
  if (!matches?.length) return <p className="py-8 text-center text-muted-foreground">暂无赛事</p>

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} />
      ))}
    </div>
  )
}
