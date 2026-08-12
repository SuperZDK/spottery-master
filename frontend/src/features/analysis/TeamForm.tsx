import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { TeamForm as TeamFormType } from "@/types/analysis"

interface TeamFormProps {
  data: TeamFormType | undefined
  isLoading: boolean
}

export default function TeamForm({ data, isLoading }: TeamFormProps) {
  if (isLoading) return <Card><CardContent className="p-4 text-muted-foreground">加载中...</CardContent></Card>
  if (!data) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.team_name} 近期战绩</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {data.results.map((r) => (
            <span
              key={r.match_id}
              className={
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white " +
                (r.result === "W" ? "bg-green-500" : r.result === "D" ? "bg-yellow-500" : "bg-red-500")
              }
            >
              {r.result}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
