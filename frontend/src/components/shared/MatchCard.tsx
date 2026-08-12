import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Match } from "@/types/match"
import { MATCH_STATUS } from "@/lib/constants"

interface MatchCardProps {
  match: Match
}

export default function MatchCard({ match }: MatchCardProps) {
  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => window.open(`/matches/${match.id}`, "_blank")}
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{match.league}</span>
          <Badge variant="secondary">
            {MATCH_STATUS[match.status as keyof typeof MATCH_STATUS] ?? match.status}
          </Badge>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="flex-1 text-right font-medium">{match.home_team}</span>
          <span className="mx-4 text-lg font-bold">
            {match.home_score != null ? `${match.home_score} - ${match.away_score}` : "VS"}
          </span>
          <span className="flex-1 font-medium">{match.away_team}</span>
        </div>
        <div className="text-center text-xs text-muted-foreground">
          {new Date(match.match_time).toLocaleString("zh-CN")}
        </div>
      </CardContent>
    </Card>
  )
}
