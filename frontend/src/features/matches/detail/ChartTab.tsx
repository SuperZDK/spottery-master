import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ChartTab() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">可视化分析</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
          <p className="text-sm">可视化分析功能开发中</p>
          <p className="text-xs mt-1">后续将支持赔率走势图、球队数据对比图表等</p>
        </div>
      </CardContent>
    </Card>
  )
}
