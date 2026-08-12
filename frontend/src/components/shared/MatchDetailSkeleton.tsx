import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

const TABS = ["基本数据", "赔率数据", "可视化分析", "舆情分析", "预测分析"]

function TeamComparisonSkeleton() {
  return (
    <Card className="flex-1">
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-4 p-0 px-3 pb-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-8" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="ml-auto h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-8" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3 w-4" />
              <Skeleton className="ml-auto h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function MatchDetailSkeleton() {
  return (
    <div className="lg:px-4" role="status" aria-label="加载中">
      {/* Match Header */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex flex-col items-center gap-1.5 px-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <div className="mt-6 mb-6 flex gap-6 overflow-x-auto border-b pb-2">
        {TABS.map((tab) => (
          <Skeleton key={tab} className="h-4 w-16" />
        ))}
      </div>

      <div className="space-y-6">
        {/* Team Comparison */}
        <div className="grid gap-4 lg:grid-cols-2">
          <TeamComparisonSkeleton />
          <TeamComparisonSkeleton />
        </div>

        {/* Injuries */}
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((col) => (
                <div key={col} className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-4 w-3/4" />
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Team Forms */}
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((col) => (
            <Card key={col}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-5 w-5 rounded-full" />
                  ))}
                </div>
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-3 w-10" />
                      <Skeleton className="h-3 w-4" />
                      <Skeleton className="h-3 w-4" />
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="ml-auto h-3 w-8" />
                      <Skeleton className="h-3 w-6" />
                      <Skeleton className="h-3 w-6" />
                      <Skeleton className="h-3 w-6" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* H2H */}
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="ml-auto h-3 w-20" />
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="ml-auto h-3 w-6" />
                  <Skeleton className="h-3 w-6" />
                  <Skeleton className="h-3 w-6" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
