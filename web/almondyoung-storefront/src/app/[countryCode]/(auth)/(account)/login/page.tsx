import { fetchCurrentUser } from "@lib/api/users/me"
import LoginTemplate from "@components/auth/templates/login-template"
import { MobileBackHeader } from "@components/layout/components/header"
import { redirect } from "next/navigation"

export default async function LoginPage() {
  return (
    <>
      <MobileBackHeader title="로그인" />
      <LoginTemplate />
    </>
  )
}
