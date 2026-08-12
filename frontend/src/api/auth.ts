import client from "./client"
import type { LoginRequest, RegisterRequest, TokenResponse, User } from "@/types/user"

export const authApi = {
  login: (data: LoginRequest) =>
    client.post<TokenResponse>("/auth/login", data).then((r) => r.data),

  register: (data: RegisterRequest) =>
    client.post<User>("/auth/register", data).then((r) => r.data),

  getMe: () => client.get<User>("/users/me").then((r) => r.data),
}
