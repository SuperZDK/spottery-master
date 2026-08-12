import { useEffect, useMemo, useState } from "react"
import { adminApi, type AdminUser, type UserRole } from "@/api/admin"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const ROLE_LABELS: Record<UserRole, string> = {
  FREE: "普通用户",
  VIP: "VIP",
  ADMIN: "管理员",
}

const ROLE_STYLES: Record<UserRole, string> = {
  FREE: "bg-muted text-muted-foreground",
  VIP: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  ADMIN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    adminApi
      .listUsers()
      .then(setUsers)
      .catch(() => setError("无法加载用户列表，请确认后端已启动且以管理员身份登录"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const counts = useMemo(() => {
    const c: Record<UserRole, number> = { FREE: 0, VIP: 0, ADMIN: 0 }
    for (const u of users) c[u.role] = (c[u.role] ?? 0) + 1
    return c
  }, [users])

  async function changeRole(user: AdminUser, role: UserRole) {
    if (user.role === role) return
    setError(null)
    setSavingId(user.id)
    try {
      await adminApi.updateRole(user.id, role)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)))
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "修改角色失败")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {(Object.keys(counts) as UserRole[]).map((r) => (
          <span key={r} className="rounded border px-2 py-1">
            {ROLE_LABELS[r]} <span className="font-medium text-foreground">{counts[r]}</span>
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">用户列表</CardTitle>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? "加载中…" : "刷新"}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无用户。</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="h-10 px-3 font-medium">ID</th>
                    <th className="h-10 px-3 font-medium">邮箱</th>
                    <th className="h-10 px-3 font-medium">角色</th>
                    <th className="h-10 px-3 font-medium">注册时间</th>
                    <th className="h-10 px-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono">{u.id}</td>
                      <td className="px-3 py-2">{u.email}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={cn("font-medium", ROLE_STYLES[u.role])}>
                          {ROLE_LABELS[u.role]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(u.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <select
                          value={u.role}
                          disabled={savingId === u.id}
                          onChange={(e) => changeRole(u, e.target.value as UserRole)}
                          className="rounded border bg-background px-2 py-1 text-xs disabled:opacity-50"
                        >
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
