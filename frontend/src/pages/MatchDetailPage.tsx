import { useState, lazy, Suspense } from "react"
import { useParams } from "react-router-dom"
import { SearchX } from "lucide-react"
import { useMatchDetail } from "@/hooks/useMatches"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import MatchDetailSkeleton from "@/components/shared/MatchDetailSkeleton"
import { MATCH_STATUS } from "@/lib/constants"
import BasicTab from "@/features/matches/detail/BasicTab"

const OddsTab = lazy(() => import("@/features/matches/detail/OddsTab"))
const PredictionTab = lazy(() => import("@/features/matches/detail/PredictionTab"))
const SentimentTab = lazy(() => import("@/features/matches/detail/SentimentTab"))
const ChartTab = lazy(() => import("@/features/matches/detail/ChartTab"))

const TABS = [
  { key: "basic", label: "基本数据" },
  { key: "odds", label: "赔率数据" },
  { key: "chart", label: "可视化分析" },
  { key: "sentiment", label: "舆情分析" },
  { key: "prediction", label: "预测分析" },
] as const

type TabKey = (typeof TABS)[number]["key"]

function TabFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="加载中">
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    </div>
  )
}

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const { data: detail, isLoading: matchLoading } = useMatchDetail(matchId)
  const [activeTab, setActiveTab] = useState<TabKey>("basic")
  const [showScore, setShowScore] = useState(false)

  if (matchLoading) return <MatchDetailSkeleton />
  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="text-4xl"><SearchX className="mx-auto h-10 w-10 text-muted-foreground" /></div>
        <p className="text-sm font-medium">赛事不存在</p>
        <p className="text-xs text-muted-foreground">该比赛可能尚未导入或已被移除</p>
        <a href="/matches" className="mt-2 inline-flex items-center rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted">
          返回赛事列表
        </a>
      </div>
    )
  }

  const { match } = detail

  return (
    <div className="lg:px-4">
      {/* Match Header */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>{match.league}</span>
            {match.match_num && <span>{match.match_num}</span>}
            <Badge>{MATCH_STATUS[match.status as keyof typeof MATCH_STATUS] ?? match.status}</Badge>
          </div>
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-1 flex-col items-center gap-1">
              <span className="text-lg font-bold">{match.home_team}</span>
            </div>
            <div className="text-center">
              {match.home_score != null ? (
                <button
                  onClick={() => setShowScore((v) => !v)}
                  title="点击显示/隐藏比分"
                  className="relative inline-block text-4xl font-extrabold tracking-wider transition-colors hover:text-primary"
                >
                  <span className="invisible">{match.home_score} : {match.away_score}</span>
                  <span className="absolute inset-0 flex items-center justify-center">
                    {showScore ? `${match.home_score} : ${match.away_score}` : "VS"}
                  </span>
                </button>
              ) : (
                <div className="text-4xl font-extrabold tracking-wider">VS</div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(match.match_time).toLocaleString("zh-CN", {
                  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            </div>
            <div className="flex flex-1 flex-col items-center gap-1">
              <span className="text-lg font-bold">{match.away_team}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <div className="flex border-b mt-6 mb-6 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-w-0 space-y-6">
        {activeTab === "basic" && (
          <BasicTab detail={detail} />
        )}
        {activeTab === "odds" && (
          <Suspense fallback={<TabFallback />}>
            <OddsTab odds={detail.odds} />
          </Suspense>
        )}
        {activeTab === "chart" && (
          <Suspense fallback={<TabFallback />}>
            <ChartTab />
          </Suspense>
        )}
        {activeTab === "sentiment" && (
          <Suspense fallback={<TabFallback />}>
            <SentimentTab briefing={detail.briefing ?? null} />
          </Suspense>
        )}
        {activeTab === "prediction" && (
          <Suspense fallback={<TabFallback />}>
            <PredictionTab prediction={null} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
