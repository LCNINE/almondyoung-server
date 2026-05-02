import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import { startOidcLogin } from "@/lib/api/medusa/sso"
import type { Cafe24SignupBootstrapData } from "@lib/api/users/auth/signup-cafe24"
import SignupTemplate from "domains/auth/templates/signup-template"
import { cookies } from "next/headers"

const CAFE24_SIGNUP_COOKIE = "cafe24_signup_bootstrap"

const parseCafe24SignupCookie = (
  rawCookieValue?: string
): Cafe24SignupBootstrapData | null => {
  if (!rawCookieValue) return null

  try {
    const decoded = decodeURIComponent(rawCookieValue)
    const parsed = JSON.parse(decoded) as Partial<Cafe24SignupBootstrapData>

    if (!parsed || typeof parsed.encryptedIdToken !== "string") return null

    const prefill = (parsed.prefill ??
      {}) as Partial<Cafe24SignupBootstrapData["prefill"]>

    return {
      encryptedIdToken: parsed.encryptedIdToken,
      memberId:
        typeof parsed.memberId === "string" || parsed.memberId === null
          ? parsed.memberId
          : null,
      memberName:
        typeof parsed.memberName === "string" || parsed.memberName === null
          ? parsed.memberName
          : null,
      prefillAvailable: !!parsed.prefillAvailable,
      prefill: {
        email:
          typeof prefill.email === "string" || prefill.email === null
            ? prefill.email
            : null,
        username:
          typeof prefill.username === "string" || prefill.username === null
            ? prefill.username
            : null,
        birthday:
          typeof prefill.birthday === "string" || prefill.birthday === null
            ? prefill.birthday
            : null,
        phoneNumber:
          typeof prefill.phoneNumber === "string" || prefill.phoneNumber === null
            ? prefill.phoneNumber
            : null,
      },
    }
  } catch {
    return null
  }
}

// 일반 가입은 IdP(auth-web)의 가입 화면으로 일원화. Cafe24 마이그레이션 모드만 기존 SignupTemplate 유지.
export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams?: Promise<{
    signup_mode?: string
    redirect_to?: string
    legacy_status?: string
    legacy_message?: string
  }>
}) {
  const { countryCode } = await params
  const resolvedSearchParams = (await searchParams) ?? {}

  const isCafe24ModeRequested = resolvedSearchParams.signup_mode === "cafe24"
  const cookieStore = await cookies()
  const cafe24Bootstrap = isCafe24ModeRequested
    ? parseCafe24SignupCookie(cookieStore.get(CAFE24_SIGNUP_COOKIE)?.value)
    : null

  if (!isCafe24ModeRequested || !cafe24Bootstrap) {
    // 일반 가입 → SSO 진입과 동일하게 IdP로 보냄. user-service에 가입 화면이 있다는 전제.
    await startOidcLogin(countryCode, resolvedSearchParams.redirect_to)
  }

  return (
    <>
      <MobileBackHeader title="회원가입" />
      <SignupTemplate mode="cafe24" cafe24Bootstrap={cafe24Bootstrap} />
    </>
  )
}
