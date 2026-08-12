import { lazy, Suspense } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import Layout from "@/components/shared/Layout"
import ProtectedRoute from "@/components/shared/ProtectedRoute"
import HomePage from "@/pages/HomePage"
import LoginPage from "@/pages/LoginPage"
import RegisterPage from "@/pages/RegisterPage"
import NotFoundPage from "@/pages/NotFoundPage"

const MatchDetailPage = lazy(() => import("@/pages/MatchDetailPage"))
const AdminLayout = lazy(() => import("@/pages/admin/AdminLayout"))
const OverviewPage = lazy(() => import("@/pages/admin/OverviewPage"))
const UsersPage = lazy(() => import("@/pages/admin/UsersPage"))
const ImportPage = lazy(() => import("@/pages/admin/ImportPage"))
const SettingsPage = lazy(() => import("@/pages/admin/SettingsPage"))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matches/:id"
            element={
              <ProtectedRoute>
                <MatchDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/admin/overview" replace />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
