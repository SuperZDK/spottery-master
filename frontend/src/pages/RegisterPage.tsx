import { Link } from "react-router-dom"
import RegisterForm from "@/features/auth/RegisterForm"

export default function RegisterPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        <RegisterForm />
        <p className="text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link to="/login" className="text-primary hover:underline">
            立即登录
          </Link>
        </p>
      </div>
    </div>
  )
}
