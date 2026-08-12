import { Outlet, Link, useLocation, useNavigate } from "react-router-dom"
import { useLogout } from "@/hooks/useAuth"
import { useAuthStore } from "@/stores/authStore"
import { useThemeStore } from "@/stores/themeStore"
import { cn } from "@/lib/utils"
import {
  Home,
  Trophy,
  Users,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Monitor,
} from "lucide-react"

const navItems = [
  { path: "/", label: "首页", icon: Home },
  { path: "/matches", label: "赛事中心", icon: Trophy, disabled: true },
  { path: "/teams", label: "球队档案", icon: Users, disabled: true },
  { path: "/analysis", label: "数据分析", icon: BarChart3, disabled: true },
  { path: "/admin", label: "管理后台", icon: Settings, adminOnly: true },
]

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useLogout()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const { theme, setTheme } = useThemeStore()

  const cycleTheme = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"]
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % 3])
  }

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor

  return (
    <div className="flex min-h-screen flex-col">
      {/* ─── Top Nav ─── */}
      <header className="sticky top-0 z-50 flex h-14 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight">竞彩分析</span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems
              .filter((item) => !item.adminOnly || isAdmin())
              .map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path ||
                (item.path !== "/" && location.pathname.startsWith(item.path))
              if (item.disabled) {
                return (
                  <span
                    key={item.path}
                    title="建设中"
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground/50"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                )
              }
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex-1" />

          {token ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{user?.email}</span>
              {user?.role === "VIP" && (
                <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  VIP
                </span>
              )}
              <button
                onClick={cycleTheme}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={`当前: ${theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}`}
              >
                <ThemeIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => navigate("/profile")}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground shadow-sm transition-all hover:border-primary hover:text-primary"
              >
                个人中心
              </button>
              <button
                onClick={logout}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                退出
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={cycleTheme}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={`当前: ${theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}`}
              >
                <ThemeIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => navigate("/login")}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                登录
              </button>
              <button
                onClick={() => navigate("/register")}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground shadow-sm transition-all hover:border-primary hover:text-primary"
              >
                注册
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ─── Main ─── */}
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  )
}
