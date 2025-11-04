import { fetchCurrentUser } from "@lib/api/users"
import { medusaSignup, retrieveCustomer } from "@lib/data/customer"
import { AuthCallback } from "domains/auth/components/auth-callback"
import { cookies as nextCookies } from "next/headers"
import { redirect } from "next/navigation"

/**
 * 이 페이지는 회원가입 콜백 페이지로, backendUrl/auth/callback/signup에서 redirect되어 오는 페이지입니다.
 */
export default async function SignupCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const cookies = await nextCookies()
  const almondToken = cookies.get("accessToken")

  const params = await searchParams
  const redirectTo = params?.redirect_to ?? "/"
  let result = null

  if (!almondToken) {
    redirect("/auth/login")
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
        almond_login_id: currentUser.id,
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
