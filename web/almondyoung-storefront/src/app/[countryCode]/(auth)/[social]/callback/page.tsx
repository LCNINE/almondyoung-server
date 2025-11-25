import { redirect } from "next/navigation"

/**
 * 이 페이지는 소셜 로그인 콜백 페이지입니다.
 * API Route Handler로 리다이렉트하여 쿠키를 설정합니다.
 */
export default async function SocialCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string; userId: string }>
}) {
  const params = await searchParams
  const redirectTo = params?.redirect_to ?? "/"

  // API Route로 리다이렉트 (여기서 쿠키를 설정할 수 있음)
  redirect(
    `/api/auth/callback/social-signup?userId=${params.userId}&social=kakao&redirect_to=${encodeURIComponent(redirectTo)}`
  )
}
