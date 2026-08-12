import { Link, Outlet, useLocation } from "react-router-dom"
import { LayoutDashboard, Users, Database, Settings, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"

const MODULES = [
  { path: "/admin/overview", label: "总览", icon: LayoutDashboard },
  { path: "/admin/users", label: "用户管理", icon: Users },
  { path: "/admin/import", label: "数据导入", icon: Database },
  { path: "/admin/settings", label: "系统设置", icon: Settings },
]

const MODULE_TITLES: Record<string, string> = {
  "/admin/overview": "总览",
  "/admin/users": "用户管理",
  "/admin/import": "数据导入",
  "/admin/settings": "系统设置",
}

export default function AdminLayout() {
  const location = useLocation()
  const activePath = MODULES.find((m) => location.pathname.startsWith(m.path))?.path ?? "/admin/overview"
  const title = MODULE_TITLES[activePath] ?? "管理后台"

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* ─── Sidebar ─── */}
      <aside className="flex w-full shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col lg:rounded-xl lg:border lg:bg-card lg:p-2 lg:shadow-sm">
        {MODULES.map((m) => {
          const Icon = m.icon
          const isActive = location.pathname.startsWith(m.path)
          return (
            <Link
              key={m.path}
              to={m.path}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {m.label}
            </Link>
          )
        })}
      </aside>

      {/* ─── Content ─── */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{title}</h1>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wrench className="h-3.5 w-3.5" />
            管理后台 · 仅管理员可见
          </span>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
