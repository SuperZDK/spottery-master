import { create } from "zustand"
import type { User } from "@/types/user"

interface AuthState {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
  isVIP: () => boolean
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("access_token"),
  user: (() => {
    try {
      const u = localStorage.getItem("user")
      return u ? JSON.parse(u) : null
    } catch {
      return null
    }
  })(),

  setAuth: (token: string, user: User) => {
    localStorage.setItem("access_token", token)
    localStorage.setItem("user", JSON.stringify(user))
    set({ token, user })
  },

  logout: () => {
    localStorage.removeItem("access_token")
    localStorage.removeItem("user")
    set({ token: null, user: null })
  },

  isAuthenticated: () => !!get().token,

  isVIP: () => get().user?.role === "VIP",

  isAdmin: () => get().user?.role === "ADMIN",
}))
