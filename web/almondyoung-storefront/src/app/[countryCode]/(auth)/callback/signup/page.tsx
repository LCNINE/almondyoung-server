import { redirect } from "next/navigation"

/**
 * 이 페이지는 회원가입 콜백 페이지로, backendUrl/auth/verify-email에서 redirect되어 오는 페이지입니다.
 * API Route로 리다이렉트하여 쿠키를 설정합니다.
 */
export default async function SignupCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ redirect_to?: string; userId: string }>
}) {
  const { countryCode } = await params
  const { redirect_to, userId } = await searchParams
  const redirectTo = redirect_to ?? "/"

  // API Route로 리다이렉트 (쿠키는 Route Handler에서 설정)
  redirect(
    `/api/auth/callback/signup?userId=${userId}&countryCode=${countryCode}&redirect_to=${encodeURIComponent(redirectTo)}`
  )
}
