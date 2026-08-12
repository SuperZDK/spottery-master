import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useLeagues, useTeams } from "@/hooks/useTeams"
import { Card, CardContent } from "@/components/ui/card"
import LoadingSpinner from "@/components/shared/LoadingSpinner"
import { Users, ChevronRight } from "lucide-react"

export default function TeamsPage() {
  const navigate = useNavigate()
  const { data: leagues, isLoading: leaguesLoading } = useLeagues()
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null)
  const { data: teams, isLoading: teamsLoading } = useTeams(selectedLeague ?? undefined)

  if (leaguesLoading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">球队档案</h1>
        <p className="text-muted-foreground">浏览各联赛球队数据与历史战绩</p>
      </div>

      {/* League tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedLeague(null)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            selectedLeague === null
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          全部
        </button>
        {leagues?.map((league) => (
          <button
            key={league.id}
            onClick={() => setSelectedLeague(league.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedLeague === league.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {league.name}
          </button>
        ))}
      </div>

      {/* Teams grid */}
      {teamsLoading ? (
        <LoadingSpinner />
      ) : !teams?.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">暂无球队数据</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((team) => (
            <Card
              key={team.id}
              className="cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => navigate(`/teams/${team.id}`)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{team.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {team.short_name} · {team.country}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
