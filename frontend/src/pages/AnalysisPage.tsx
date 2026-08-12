import { useState } from "react"
import { useMatches } from "@/hooks/useMatches"
import { useOddsHistory } from "@/hooks/useOdds"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LoadingSpinner from "@/components/shared/LoadingSpinner"
import { Select } from "@/components/ui/select"
import { BarChart3, TrendingUp, Lock } from "lucide-react"
import { useAuthStore } from "@/stores/authStore"
import ReactECharts from "echarts-for-react"
import type { OddsHistoryPoint } from "@/types/odds"

function OddsHistoryChart({
  matchId,
  matchName,
}: {
  matchId: number
  matchName: string
}) {
  const { data: history, isLoading } = useOddsHistory(matchId)

  if (isLoading) return <LoadingSpinner />
  if (!history?.history?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        暂无赔率走势数据
      </div>
    )
  }

  const times = history.history.map((p: OddsHistoryPoint) =>
    new Date(p.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  )
  const homeOdds = history.history.map((p: OddsHistoryPoint) => p.home)
  const drawOdds = history.history.map((p: OddsHistoryPoint) => p.draw)
  const awayOdds = history.history.map((p: OddsHistoryPoint) => p.away)

  const option = {
    tooltip: {
      trigger: "axis" as const,
    },
    legend: {
      data: ["主胜", "平局", "客胜"],
      bottom: 0,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "12%",
      top: "5%",
      containLabel: true,
    },
    xAxis: {
      type: "category" as const,
      boundaryGap: false,
      data: times,
    },
    yAxis: {
      type: "value" as const,
      min: (value: { min: number }) => Math.floor(value.min * 10) / 10,
    },
    series: [
      {
        name: "主胜",
        type: "line" as const,
        data: homeOdds,
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: "#ef4444" },
      },
      {
        name: "平局",
        type: "line" as const,
        data: drawOdds,
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: "#eab308" },
      },
      {
        name: "客胜",
        type: "line" as const,
        data: awayOdds,
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: "#3b82f6" },
      },
    ],
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        {matchName} · {history.bookmaker} · {history.odds_type}
      </p>
      <ReactECharts option={option} style={{ height: 300 }} />
    </div>
  )
}

function PredictionModelCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          预测模型说明
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4">
          <h4 className="mb-2 font-medium">模型版本 v1.0</h4>
          <p className="text-sm text-muted-foreground">
            基于历史交锋数据、近期战绩、主客场表现等多维度特征，采用逻辑回归算法进行比赛结果预测。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950">
            <div className="text-2xl font-bold text-green-600">72%</div>
            <div className="text-xs text-muted-foreground">平均置信度</div>
          </div>
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950">
            <div className="text-2xl font-bold text-blue-600">8场</div>
            <div className="text-xs text-muted-foreground">已分析比赛</div>
          </div>
          <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-950">
            <div className="text-2xl font-bold text-purple-600">16支</div>
            <div className="text-xs text-muted-foreground">追踪球队</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          * 预测结果仅供参考，不构成任何投注建议。请理性看待数据分析结果。
        </div>
      </CardContent>
    </Card>
  )
}

export default function AnalysisPage() {
  const user = useAuthStore((s) => s.user)
  const isVIP = user?.role === "VIP"
  const { data: matches, isLoading } = useMatches()
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null)

  const finishedMatches = matches?.filter((m) => m.status === "FINISHED") ?? []
  const selectedMatchData = finishedMatches.find((m) => m.id === selectedMatch)

  if (!isVIP) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Lock className="mb-4 h-12 w-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">VIP 专属功能</h1>
        <p className="text-muted-foreground">数据分析功能仅对VIP会员开放</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">数据分析</h1>
        <p className="text-muted-foreground">深度数据分析与赔率走势</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Odds history chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                赔率走势
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedMatch?.toString() ?? ""}
                onChange={(e) => setSelectedMatch(Number(e.target.value) || null)}
              >
                <option value="">选择已结束的比赛</option>
                {finishedMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.home_team} vs {m.away_team} ({new Date(m.match_time).toLocaleDateString("zh-CN")})
                  </option>
                ))}
              </Select>

              <div className="mt-4">
                {isLoading ? (
                  <LoadingSpinner />
                ) : selectedMatch && selectedMatchData ? (
                  <OddsHistoryChart
                    matchId={selectedMatch}
                    matchName={`${selectedMatchData.home_team} vs ${selectedMatchData.away_team}`}
                  />
                ) : (
                  <div className="flex h-48 items-center justify-center text-muted-foreground">
                    请选择一场比赛查看赔率走势
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <PredictionModelCard />
        </div>
      </div>
    </div>
  )
}
