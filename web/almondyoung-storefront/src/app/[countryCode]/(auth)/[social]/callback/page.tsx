import { appConfig } from "@lib/app-config"
import {
  customerAuthCallback,
  medusaSignup,
  retrieveCustomer,
} from "@lib/data/customer"
import { fetchCurrentUser } from "@lib/api/users/me"
import { AuthCallback } from "@components/auth/components/auth-callback"
import { cookies as nextCookies } from "next/headers"
import { redirect } from "next/navigation"

export default async function SocialCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const cookies = await nextCookies()
  const almondToken = cookies.get("accessToken")

  const params = await searchParams
  const redirectTo = params?.redirect_to ?? appConfig.auth.redirect_to
  let result

  if (!almondToken) {
    redirect("/auth/login")
  }

  const customer = await retrieveCustomer()
  if (customer) redirect(redirectTo) // 이미 회원이라면 메인페이지로 이동

  const currentUser = await fetchCurrentUser()

  // 메두사 신규 회원 가입 처리
  if (currentUser) {
    try {
      // 1. 회원가입
      await medusaSignup({
        email: currentUser.email,
        first_name: currentUser.name,
        last_name: currentUser.name,
        almond_user_id: currentUser.id,
        almond_login_id: currentUser.id,
      })
      // 2. 인증 콜백
      result = await customerAuthCallback(almondToken.value)

      if (!result.success) throw new Error("인증에 실패했습니다")
    } catch (error) {
      console.error("medusaRes error:", error)

      throw error
    }
  }

  return (
    <AuthCallback redirectTo={redirectTo} success={result?.success ?? false} />
  )
}
