import { useState, useMemo, useCallback, useEffect } from "react"
import { useQueries } from "@tanstack/react-query"
import type { BettingMatch } from "@/types/odds"
import { matchesApi } from "@/api/matches"
import { useBetSlipStore } from "@/stores/betSlipStore"
import LoadingSpinner from "@/components/shared/LoadingSpinner"
import { ChevronLeft, ChevronRight, Calendar, Search } from "lucide-react"

type TabKey = "spf" | "rqspf" | "bf" | "zjq" | "bqc"

const tabs: { key: TabKey; label: string }[] = [
  { key: "spf", label: "胜平负" },
  { key: "rqspf", label: "让球胜平负" },
  { key: "bf", label: "比分" },
  { key: "zjq", label: "总进球" },
  { key: "bqc", label: "半全场" },
]

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

const CRS_HOME = ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2", "胜其他", "胜其它"]
const CRS_DRAW = ["0:0", "1:1", "2:2", "3:3", "平其他", "平其它"]
const CRS_AWAY = ["0:1", "0:2", "1:2", "0:3", "1:3", "2:3", "0:4", "1:4", "2:4", "0:5", "1:5", "2:5", "负其他", "负其它"]

type CrsRow = "home" | "draw" | "away"

function classifyCrs(label: string): CrsRow {
  const m = label.match(/^(\d+):(\d+)$/)
  if (m) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a > b) return "home"
    if (a === b) return "draw"
    return "away"
  }
  if (label.startsWith("胜")) return "home"
  if (label.startsWith("负")) return "away"
  return "draw"
}

function orderCrsRows(crs: { label: string; odds: number }[]) {
  const byLabel = new Map(crs.map((o) => [o.label, o]))
  const pick = (ordered: string[]) => {
    const out: { label: string; odds: number }[] = []
    for (const l of ordered) {
      const item = byLabel.get(l)
      if (item) {
        out.push(item)
        byLabel.delete(l)
      }
    }
    return out
  }
  const home = pick(CRS_HOME)
  const draw = pick(CRS_DRAW)
  const away = pick(CRS_AWAY)
  for (const item of byLabel.values()) {
    const row = classifyCrs(item.label)
    if (row === "home") home.push(item)
    else if (row === "away") away.push(item)
    else draw.push(item)
  }
  return { home, draw, away }
}

const TTG_ORDER = ["0球", "1球", "2球", "3球", "4球", "5球", "6球", "7+球"]
const BQC_GROUPS = [
  ["胜-胜", "胜-平", "胜-负"],
  ["平-胜", "平-平", "平-负"],
  ["负-胜", "负-平", "负-负"],
]

function pickOrdered(items: { label: string; odds: number }[], order: string[]) {
  const byLabel = new Map(items.map((o) => [o.label, o]))
  const out: { label: string; odds: number }[] = []
  for (const l of order) {
    const item = byLabel.get(l)
    if (item) {
      out.push(item)
      byLabel.delete(l)
    }
  }
  for (const item of byLabel.values()) out.push(item)
  return out
}

function orderBqcGroups(items: { label: string; odds: number }[]) {
  const byLabel = new Map(items.map((o) => [o.label, o]))
  const groups = BQC_GROUPS.map((list) => {
    const out: { label: string; odds: number }[] = []
    for (const l of list) {
      const item = byLabel.get(l)
      if (item) {
        out.push(item)
        byLabel.delete(l)
      }
    }
    return out
  })
  const leftovers = [...byLabel.values()]
  if (leftovers.length > 0 && groups.length > 0) {
    groups[groups.length - 1] = [...groups[groups.length - 1], ...leftovers]
  }
  return groups.filter((g) => g.length > 0)
}

function formatDateLabel(dateStr: string, _isSelected: boolean): string {
  const d = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return `今天`
  if (diff === 1) return `明天`
  if (diff === -1) return `昨天`
  return `${WEEKDAYS[d.getDay()]}`
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

function nearbyDates(center: string, count: number): string[] {
  const result: string[] = []
  const half = Math.floor(count / 2)
  for (let i = -half; i <= half; i++) {
    result.push(addDays(center, i))
  }
  return result
}

function todayString(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

const BASE_DATE = todayString()

function fetchBetting(date: string) {
  return matchesApi.betting(date)
}

export default function TodayMatchList() {
  const [activeTab, setActiveTab] = useState<TabKey>("spf")
  const [selectedDate, setSelectedDate] = useState(BASE_DATE)
  const [dateInputValue, setDateInputValue] = useState(BASE_DATE)
  const addOption = useBetSlipStore((s) => s.addOption)

  useEffect(() => {
    setDateInputValue(selectedDate)
  }, [selectedDate])

  const prevDate = useMemo(() => addDays(selectedDate, -1), [selectedDate])
  const nextDate = useMemo(() => addDays(selectedDate, 1), [selectedDate])
  const datePills = useMemo(() => nearbyDates(selectedDate, 5), [selectedDate])

  const results = useQueries({
    queries: [
      { queryKey: ["betting-matches", prevDate], queryFn: () => fetchBetting(prevDate) },
      { queryKey: ["betting-matches", selectedDate], queryFn: () => fetchBetting(selectedDate) },
      { queryKey: ["betting-matches", nextDate], queryFn: () => fetchBetting(nextDate) },
    ],
  })

  const [prevResult, currentResult, nextResult] = results

  const prevEmpty = prevResult.data?.matches?.length === 0
  const nextEmpty = nextResult.data?.matches?.length === 0
  const matches = currentResult.data?.matches ?? []

  const handleDateChange = useCallback((newDate: string) => {
    if (newDate) {
      setSelectedDate(newDate)
      setDateInputValue(newDate)
    }
  }, [])

  const handleJumpDate = useCallback(() => {
    if (dateInputValue) {
      handleDateChange(dateInputValue)
    }
  }, [dateInputValue, handleDateChange])

  const handleDateInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleJumpDate()
    }
  }, [handleJumpDate])

  const handlePrev = useCallback(() => {
    if (!prevEmpty) setSelectedDate(prevDate)
  }, [prevEmpty, prevDate])

  const handleNext = useCallback(() => {
    if (!nextEmpty) setSelectedDate(nextDate)
  }, [nextEmpty, nextDate])

  const bettable = useMemo(
    () => matches.filter((m) => m.status === "SCHEDULED"),
    [matches]
  )
  const liveMatches = useMemo(
    () => matches.filter((m) => m.status === "LIVE"),
    [matches]
  )
  const finishedMatches = useMemo(
    () => matches.filter((m) => m.status === "FINISHED"),
    [matches]
  )

  if (currentResult.isLoading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* ─── Date Picker ─── */}
      <div className="flex items-center gap-2">
        <button
          onClick={handlePrev}
          disabled={prevEmpty}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
          {datePills.map((date) => (
            <button
              key={date}
              onClick={() => handleDateChange(date)}
              className={`flex shrink-0 flex-col items-center rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedDate === date
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              <span className="text-xs">{date.slice(5)}</span>
              <span>{formatDateLabel(date, selectedDate === date)}</span>
            </button>
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={nextEmpty}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="flex h-8 shrink-0 items-center gap-0 rounded-lg border bg-background text-xs text-muted-foreground">
          <div className="flex items-center gap-1 px-2">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <input
              type="date"
              value={dateInputValue}
              onChange={(e) => setDateInputValue(e.target.value)}
              onKeyDown={handleDateInputKeyDown}
              className="h-full w-[8.5rem] bg-transparent text-xs text-foreground outline-none [color-scheme:light]"
            />
          </div>
          <button
            onClick={handleJumpDate}
            className="flex h-full items-center gap-1 rounded-r-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Search className="h-3 w-3" />
            跳转
          </button>
        </div>
      </div>

      {/* ─── Odds Tabs ─── */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── 可投注赛事 ─── */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="inline-block h-3 w-1 rounded bg-green-500" />
          可投注赛事
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            {bettable.length}场
          </span>
        </h3>
        {bettable.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无待开始的赛事</p>
        ) : (
          <div className="space-y-3">
            {bettable.map((match) => (
              <TodayMatchRow
                key={match.match_id}
                match={match}
                activeTab={activeTab}
                canBet
                onAdd={(betType, option, odds) =>
                  addOption({
                    matchId: match.match_id,
                    matchLabel: `${match.match_num} ${match.home_team} vs ${match.away_team}`,
                    betType,
                    option,
                    odds,
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── 进行中 ─── */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <span className="inline-block h-3 w-1 rounded bg-red-500" />
          进行中
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">
            {liveMatches.length}场
          </span>
        </h3>
        {liveMatches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无进行中的赛事</p>
        ) : (
          <div className="space-y-3">
            {liveMatches.map((match) => (
              <TodayMatchRow
                key={match.match_id}
                match={match}
                activeTab={activeTab}
                canBet={false}
                onAdd={() => {}}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── 已结束 ─── */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <span className="inline-block h-3 w-1 rounded bg-gray-400" />
          已结束
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {finishedMatches.length}场
          </span>
        </h3>
        {finishedMatches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无已结束的赛事</p>
        ) : (
          <div className="space-y-3">
            {finishedMatches.map((match) => (
              <TodayMatchRow
                key={match.match_id}
                match={match}
                activeTab={activeTab}
                canBet={false}
                onAdd={() => {}}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white">
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      进行中
    </span>
  )
}

function TodayMatchRow({
  match,
  activeTab,
  canBet,
  onAdd,
}: {
  match: BettingMatch
  activeTab: TabKey
  canBet: boolean
  onAdd: (betType: string, option: string, odds: number) => void
}) {
  const [showScore, setShowScore] = useState(false)

  const renderOdds = (label: string, odds: number, betType: string) => (
    <button
      key={`${betType}_${label}`}
      onClick={() => canBet && onAdd(betType, label, odds)}
      disabled={!canBet}
      className={`flex min-w-[64px] flex-col items-center gap-0.5 rounded-md border bg-card px-3 py-1.5 text-center transition-colors ${
        canBet
          ? "cursor-pointer hover:border-primary hover:bg-primary/5"
          : "cursor-default opacity-50"
      }`}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-bold text-primary">{odds.toFixed(2)}</span>
    </button>
  )

  const statusBadge = () => {
    if (match.status === "LIVE") return <LiveBadge />
    if (match.status === "FINISHED") {
      const score = `${match.home_score ?? "-"}:${match.away_score ?? "-"}`
      return (
        <button
          onClick={() => setShowScore((v) => !v)}
          title="点击显示/隐藏比分"
          className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-300"
        >
          已结束{showScore ? ` ${score}` : ""}
        </button>
      )
    }
    return <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">未开始</span>
  }

  const spf = match.odds?.spf
  const rqspf = match.odds?.rqspf
  const crsRows = match.odds?.crs && match.odds.crs.length > 0 ? orderCrsRows(match.odds.crs) : null
  const ttgRows = match.odds?.ttg && match.odds.ttg.length > 0 ? pickOrdered(match.odds.ttg, TTG_ORDER) : null
  const bqcGroups = match.odds?.hafu && match.odds.hafu.length > 0 ? orderBqcGroups(match.odds.hafu) : null

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {match.match_num}
          </span>
          <span className="text-xs text-muted-foreground">{match.league}</span>
          {statusBadge()}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(`/matches/${match.match_id}`, "_blank")}
            className="group inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-all hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:scale-95"
          >
            详情
            <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
          </button>
          <span className="text-xs text-muted-foreground">
            {new Date(match.kickoff_time).toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-base font-semibold">{match.home_team}</span>
        <span className="mx-4 text-sm text-muted-foreground">VS</span>
        <span className="text-base font-semibold">{match.away_team}</span>
      </div>

      {/* Odds */}
      <div className="border-t px-4 py-3">
        {activeTab === "spf" && spf && (
          <div className="flex justify-center gap-3">
            {renderOdds("主胜", spf.home, "胜平负")}
            {renderOdds("平局", spf.draw, "胜平负")}
            {renderOdds("客胜", spf.away, "胜平负")}
          </div>
        )}
        {activeTab === "spf" && !spf && <EmptyOdds />}
        {activeTab === "rqspf" && (
          <div className="space-y-2">
            <div className="text-center text-xs text-muted-foreground">
              让球: <span className="font-bold">{rqspf?.goal_line ?? "-"}</span>
            </div>
            {rqspf ? (
              <div className="flex justify-center gap-3">
                {renderOdds("主胜", rqspf.home, "让球胜平负")}
                {renderOdds("平局", rqspf.draw, "让球胜平负")}
                {renderOdds("客胜", rqspf.away, "让球胜平负")}
              </div>
            ) : (
              <EmptyOdds />
            )}
          </div>
        )}
        {activeTab === "bf" && (
          crsRows ? (
            <div className="space-y-2">
              {[
                { label: "主胜", items: crsRows.home, cls: "text-emerald-600" },
                { label: "平局", items: crsRows.draw, cls: "text-muted-foreground" },
                { label: "客胜", items: crsRows.away, cls: "text-rose-600" },
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-2">
                  <span className={`mt-2 w-8 shrink-0 text-xs font-medium ${row.cls}`}>{row.label}</span>
                  <div className="flex flex-1 flex-wrap justify-center gap-2">
                    {row.items.map((o) => renderOdds(o.label, o.odds, "比分"))}
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyOdds />
        )}
        {activeTab === "zjq" && (
          ttgRows ? (
            <div className="flex flex-wrap justify-center gap-2">
              {ttgRows.map((o) => renderOdds(o.label, o.odds, "总进球"))}
            </div>
          ) : <EmptyOdds />
        )}
        {activeTab === "bqc" && (
          bqcGroups ? (
            <div className="flex flex-wrap items-center justify-center gap-4">
              {bqcGroups.map((g, i) => (
                <div key={i} className="flex flex-wrap justify-center gap-2">
                  {g.map((o) => renderOdds(o.label, o.odds, "半全场"))}
                </div>
              ))}
            </div>
          ) : <EmptyOdds />
        )}
      </div>
    </div>
  )
}

function EmptyOdds() {
  return <p className="py-3 text-center text-xs text-muted-foreground">暂无赔率</p>
}
