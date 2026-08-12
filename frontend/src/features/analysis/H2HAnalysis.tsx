import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { H2HRecord } from "@/types/analysis"

interface H2HAnalysisProps {
  data: H2HRecord[] | undefined
  isLoading: boolean
}

export default function H2HAnalysis({ data, isLoading }: H2HAnalysisProps) {
  if (isLoading) return <Card><CardContent className="p-4 text-muted-foreground">加载中...</CardContent></Card>
  if (!data?.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>历史交锋</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((h) => (
            <div key={h.match_id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <span>{h.home_team}</span>
              <span className="font-bold">{h.home_score != null ? `${h.home_score}:${h.away_score}` : "VS"}</span>
              <span>{h.away_team}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
