export enum UserRole {
  FREE = "FREE",
  VIP = "VIP",
  ADMIN = "ADMIN",
}

export interface User {
  id: number
  email: string
  role: UserRole
  created_at: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}
