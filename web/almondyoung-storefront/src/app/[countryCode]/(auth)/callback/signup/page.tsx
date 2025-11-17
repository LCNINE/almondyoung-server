import { fetchCurrentUser } from "@lib/api/users"
import { callbackSignup } from "@lib/api/users/callback-signup"
import { appConfig } from "@lib/app-config"
import { medusaSignup, retrieveCustomer } from "@lib/data/customer"
import { AuthCallback } from "domains/auth/components/auth-callback"
import { cookies as nextCookies } from "next/headers"
import { redirect } from "next/navigation"

/**
 * 이 페이지는 회원가입 콜백 페이지로, backendUrl/auth/verify-email redirect되어 오는 페이지입니다.
 */
export default async function SignupCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string; userId: string }>
}) {
  const params = await searchParams
  const { accessToken, refreshToken } = await callbackSignup(params.userId)
  console.log("accessToken", accessToken)

  const cookies = await nextCookies()

  const almondToken = cookies.get("accessToken")

  const redirectTo = params?.redirect_to ?? appConfig.auth.redirect_to
  let result = null

  console.log("almondToken", almondToken)

  if (!almondToken) {
    // redirect("/login")
  }

  const customer = await retrieveCustomer()
  if (customer) redirect(redirectTo) // 이미 회원이라면 메인페이지로 이동

  const currentUser = await fetchCurrentUser()

  // 메두사 신규 회원 가입 처리
  if (currentUser) {
    try {
      result = await medusaSignup({
        email: currentUser.email,
        first_name: currentUser.username,
        last_name: currentUser.username,
        almond_user_id: currentUser.id,
        almond_login_id: currentUser.loginId,
      })
    } catch (error) {
      console.error("medusaRes error:", error)

      throw error
    }
  }

  return (
    <AuthCallback redirectTo={redirectTo} success={!result ? false : true} />
  )
}
