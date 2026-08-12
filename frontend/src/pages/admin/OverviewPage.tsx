import { useEffect, useMemo, useState } from "react"
import { adminApi, type AdminUser, type UserRole } from "@/api/admin"
import { Card, CardContent } from "@/components/ui/card"
import { Users, ShieldCheck, Crown, UserX } from "lucide-react"
import { cn } from "@/lib/utils"

const ROLE_LABELS: Record<UserRole, string> = {
  FREE: "普通用户",
  VIP: "VIP",
  ADMIN: "管理员",
}

const ROLE_CARDS: { role: UserRole; icon: typeof Users; iconClass: string; badgeClass: string }[] = [
  {
    role: "FREE",
    icon: UserX,
    iconClass: "bg-muted text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
  },
  {
    role: "VIP",
    icon: Crown,
    iconClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200",
    badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  {
    role: "ADMIN",
    icon: ShieldCheck,
    iconClass: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
]

export default function OverviewPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi
      .listUsers()
      .then(setUsers)
      .catch(() => setError("无法加载统计数据，请确认后端已启动且以管理员身份登录"))
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => {
    const c: Record<UserRole, number> = { FREE: 0, VIP: 0, ADMIN: 0 }
    for (const u of users) c[u.role] = (c[u.role] ?? 0) + 1
    return c
  }, [users])

  if (loading) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">加载中…</CardContent></Card>
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">用户总数</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
          </CardContent>
        </Card>
        {ROLE_CARDS.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.role}>
              <CardContent className="flex items-center gap-4 p-4">
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", c.iconClass)}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[c.role]}</p>
                  <p className="text-2xl font-bold">{counts[c.role]}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-medium text-foreground">角色分布</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {ROLE_CARDS.map((c) => {
              const pct = users.length === 0 ? 0 : (counts[c.role] / users.length) * 100
              if (pct === 0) return null
              return (
                <div
                  key={c.role}
                  title={`${ROLE_LABELS[c.role]} ${pct.toFixed(0)}%`}
                  className={cn("h-full", c.badgeClass)}
                  style={{ width: `${pct}%` }}
                />
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {ROLE_CARDS.map((c) => (
              <span key={c.role} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full", c.badgeClass)} />
                {ROLE_LABELS[c.role]}
                <span className="font-medium text-foreground">{counts[c.role]}</span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
