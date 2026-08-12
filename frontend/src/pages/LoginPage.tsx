import { Link } from "react-router-dom"
import LoginForm from "@/features/auth/LoginForm"

export default function LoginPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          还没有账号？{" "}
          <Link to="/register" className="text-primary hover:underline">
            立即注册
          </Link>
        </p>
      </div>
    </div>
  )
}
