import { Navigate, useLocation } from "react-router-dom"
import { useAuthStore } from "@/stores/authStore"

interface ProtectedRouteProps {
  children: React.ReactNode
  requireVIP?: boolean
  requireAdmin?: boolean
}

export default function ProtectedRoute({ children, requireVIP, requireAdmin }: ProtectedRouteProps) {
  const token = useAuthStore((s) => s.token)
  const isVIP = useAuthStore((s) => s.isVIP)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (requireVIP && !isVIP()) {
    return <Navigate to="/" replace />
  }

  if (requireAdmin && !isAdmin()) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
