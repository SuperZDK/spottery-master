import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Prediction } from "@/types/analysis"

export default function PredictionTab({ prediction }: { prediction: Prediction | null }) {

  return (
    <>
      {prediction ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">预测分析</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "主胜", value: prediction.home_prob, color: "bg-primary" },
                { label: "平局", value: prediction.draw_prob, color: "bg-yellow-500" },
                { label: "客胜", value: prediction.away_prob, color: "bg-blue-500" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{label}</span>
                    <span className="font-bold">{value}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                置信度: {prediction.confidence}% | 模型: {prediction.model_version}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground/60">暂无预测数据</p>
      )}
    </>
  )
}
