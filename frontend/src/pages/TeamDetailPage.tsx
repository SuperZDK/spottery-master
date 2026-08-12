import { useParams, Link } from "react-router-dom"
import { useTeam, useLeagues } from "@/hooks/useTeams"
import { useTeamForm } from "@/hooks/useAnalysis"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LoadingSpinner from "@/components/shared/LoadingSpinner"
import { ArrowLeft, Users, MapPin, Trophy } from "lucide-react"

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const teamId = Number(id)
  const { data: team, isLoading: teamLoading } = useTeam(teamId)
  const { data: leagues } = useLeagues()
  const { data: form, isLoading: formLoading } = useTeamForm(teamId)

  const leagueName = leagues?.find((l) => l.id === team?.league_id)?.name ?? "-"

  if (teamLoading) return <LoadingSpinner />
  if (!team) return <p className="text-destructive">球队不存在</p>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/teams"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回球队列表
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{team.name}</h1>
          <p className="text-muted-foreground">
            {team.short_name} · {leagueName}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Team info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">球队全称</span>
                <span className="font-medium">{team.name}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">简称</span>
                <span className="font-medium">{team.short_name || "-"}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">所属联赛</span>
                <span className="font-medium">{leagueName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">国家/地区</span>
                <span className="flex items-center gap-1 font-medium">
                  <MapPin className="h-3 w-3" />
                  {team.country || "-"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>近期战绩</CardTitle>
            </CardHeader>
            <CardContent>
              {formLoading ? (
                <LoadingSpinner />
              ) : !form?.results?.length ? (
                <p className="text-center text-muted-foreground">暂无近期战绩数据</p>
              ) : (
                <div className="space-y-3">
                  {/* Form indicators */}
                  <div className="flex gap-2">
                    {form.results.map((r) => (
                      <span
                        key={r.match_id}
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${
                          r.result === "W"
                            ? "bg-green-500"
                            : r.result === "D"
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                      >
                        {r.result}
                      </span>
                    ))}
                  </div>

                  {/* Match details */}
                  <div className="space-y-2">
                    {form.results.map((r) => (
                      <div
                        key={r.match_id}
                        className="flex items-center justify-between rounded-lg border p-3 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white ${
                              r.result === "W"
                                ? "bg-green-500"
                                : r.result === "D"
                                  ? "bg-yellow-500"
                                  : "bg-red-500"
                            }`}
                          >
                            {r.result}
                          </span>
                          <span className="text-muted-foreground">vs {r.opponent}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold">{r.score}</span>
                          <span className="text-muted-foreground">
                            {new Date(r.match_time).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
