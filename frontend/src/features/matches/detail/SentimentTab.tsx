import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Briefing } from "@/types/analysis"

export default function SentimentTab({ briefing }: { briefing: Briefing | null }) {

  return (
    <>
      {briefing && (
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{briefing.title || "赛前情报"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">{briefing.content}</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">舆情分析</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60">
            <p className="text-sm">舆情分析功能开发中</p>
            <p className="text-xs mt-1">后续将支持新闻聚合、社交媒体舆论分析等</p>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
