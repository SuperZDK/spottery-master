import { useMatchStore } from "@/stores/matchStore"
import { Select } from "@/components/ui/select"

const leagues = ["英超", "西甲", "德甲", "意甲", "法甲", "中超", "欧冠", "竞彩"]
const statuses = [
  { value: "", label: "全部" },
  { value: "SCHEDULED", label: "未开始" },
  { value: "LIVE", label: "进行中" },
  { value: "FINISHED", label: "已结束" },
]

export default function MatchFilter() {
  const { league, status, setFilter, reset } = useMatchStore()
  const today = new Date().toISOString().split("T")[0]

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select
        value={league ?? ""}
        onChange={(e) => setFilter("league", e.target.value || null)}
      >
        <option value="">全部联赛</option>
        {leagues.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </Select>

      <input
        type="date"
        value={useMatchStore.getState().date ?? today}
        onChange={(e) => setFilter("date", e.target.value)}
        className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
      />

      <Select
        value={status ?? ""}
        onChange={(e) => setFilter("status", e.target.value || null)}
      >
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </Select>

      <button
        onClick={reset}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        重置筛选
      </button>
    </div>
  )
}
