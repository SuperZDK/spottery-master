import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { authApi } from "@/api/auth"
import { useAuthStore } from "@/stores/authStore"
import type { LoginRequest, RegisterRequest } from "@/types/user"

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (data: LoginRequest) => authApi.login(data),
    onSuccess: async (res, variables) => {
      setAuth(res.access_token, {
        id: 0,
        email: variables.email,
        role: "FREE" as never,
        created_at: "",
      })
      const me = await authApi.getMe()
      setAuth(res.access_token, me)
      navigate("/")
    },
  })
}

export function useRegister() {
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (data: RegisterRequest) => authApi.register(data),
    onSuccess: () => navigate("/login"),
  })
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  return () => {
    logout()
    navigate("/login")
  }
}
