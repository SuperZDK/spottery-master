import client from "./client"

export type UserRole = "FREE" | "VIP" | "ADMIN"

export interface AdminUser {
  id: number
  email: string
  role: UserRole
  created_at: string
}

export const adminApi = {
  listUsers: () => client.get<AdminUser[]>("/admin/users").then((r) => r.data),

  updateRole: (userId: number, role: UserRole) =>
    client.patch<{ ok: boolean }>(`/admin/users/${userId}/role`, { role }).then((r) => r.data),
}
