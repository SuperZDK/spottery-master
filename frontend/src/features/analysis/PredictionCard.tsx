import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Prediction } from "@/types/analysis"

interface PredictionCardProps {
  data: Prediction | undefined
  isLoading: boolean
}

export default function PredictionCard({ data, isLoading }: PredictionCardProps) {
  if (isLoading) return <Card><CardContent className="p-4 text-muted-foreground">分析中...</CardContent></Card>
  if (!data) return null

  const labels = ["主胜", "平局", "客胜"]
  const values = [data.home_prob, data.draw_prob, data.away_prob]

  return (
    <Card>
      <CardHeader>
        <CardTitle>预测分析</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {labels.map((label, i) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{label}</span>
                <span className="font-bold">{values[i]}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(values[i], 100)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            置信度: {data.confidence}% | 模型: {data.model_version}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
