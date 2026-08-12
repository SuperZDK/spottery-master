import MatchList from "@/features/matches/MatchList"
import MatchFilter from "@/features/matches/MatchFilter"

export default function MatchesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">赛事中心</h1>
        <p className="text-muted-foreground">浏览和筛选竞彩赛事</p>
      </div>
      <MatchFilter />
      <MatchList />
    </div>
  )
}
