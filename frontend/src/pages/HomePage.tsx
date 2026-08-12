import { useEffect, useRef } from "react"
import TodayMatchList from "@/features/matches/TodayMatchList"
import BetSimulator from "@/features/betting/BetSimulator"
import { useBetSlipStore } from "@/stores/betSlipStore"
import { AlertTriangle, X } from "lucide-react"

function ConflictToast() {
  const conflictMessage = useBetSlipStore((s) => s.conflictMessage)
  const clearConflict = useBetSlipStore((s) => s.clearConflict)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (conflictMessage) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => clearConflict(), 3000)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [conflictMessage, clearConflict])

  if (!conflictMessage) return null

  return (
    <div className="fixed right-4 top-16 z-40 flex max-w-[min(24rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm shadow-lg backdrop-blur">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <span className="flex-1 text-foreground">{conflictMessage}</span>
      <button onClick={clearConflict} className="text-muted-foreground hover:text-foreground" title="关闭">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">竞彩足球数据分析</h1>
        <p className="text-muted-foreground">今日竞彩开放赛事 · 点击赔率加入投注模拟</p>
      </div>

      <TodayMatchList />

      <BetSimulator />
      <ConflictToast />
    </div>
  )
}
