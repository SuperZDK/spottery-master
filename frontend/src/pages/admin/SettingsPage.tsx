import { Card, CardContent } from "@/components/ui/card"
import { Construction } from "lucide-react"

export default function SettingsPage() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">系统设置</p>
          <p className="mt-1 text-xs text-muted-foreground">该模块建设中，后续将支持站点配置与维护操作。</p>
        </div>
      </CardContent>
    </Card>
  )
}
