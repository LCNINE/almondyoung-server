import { appConfig } from "@lib/app-config"
import { AuthCallback } from "domains/auth/components/auth-callback"

/**
 * API Route에서 쿠키를 설정한 후 리다이렉트되는 페이지
 */
export default async function SignupProcessPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const params = await searchParams
  const redirectTo = params?.redirect_to ?? appConfig.auth.redirect_to

  return <AuthCallback redirectTo={redirectTo} success={true} />
}
