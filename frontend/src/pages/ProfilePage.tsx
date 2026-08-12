import { useAuthStore } from "@/stores/authStore"
import { useLogout } from "@/hooks/useAuth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">个人中心</h1>

      <Card>
        <CardHeader>
          <CardTitle>账号信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">邮箱</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">角色</span>
            <span>
              {user?.role === "VIP" ? (
                <span className="rounded bg-yellow-100 px-2 py-0.5 text-sm text-yellow-800">VIP 会员</span>
              ) : (
                "免费用户"
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">注册时间</span>
            <span>{user?.created_at ? new Date(user.created_at).toLocaleString("zh-CN") : "-"}</span>
          </div>
        </CardContent>
      </Card>

      <Button variant="destructive" onClick={logout}>退出登录</Button>
    </div>
  )
}
