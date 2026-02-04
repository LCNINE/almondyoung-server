import { redirect } from "next/navigation"

/**
 * 이 페이지는 소셜 로그인 콜백 페이지입니다.
 * API Route Handler로 리다이렉트하여 쿠키를 설정합니다.
 */
export default async function SocialCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ social: string; countryCode: string }>
  searchParams: Promise<{
    redirect_to?: string
    userId?: string
    error?: string
  }>
}) {
  const { social, countryCode } = await params
  const query = await searchParams

  // userId가 없으면 에러
  if (!query?.userId) {
    redirect(
      `/${countryCode}/login?message=${encodeURIComponent("userId is required")}`
    )
  }

  const redirectTo = query?.redirect_to ?? "/"

  // API Route로 리다이렉트 (여기서 쿠키를 설정)
  redirect(
    `/api/auth/callback/social-signup?userId=${query.userId}&social=${social}&redirect_to=${encodeURIComponent(redirectTo)}`
  )
}
