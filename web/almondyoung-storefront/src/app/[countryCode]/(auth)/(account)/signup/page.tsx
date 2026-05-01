import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import type { Cafe24SignupBootstrapData } from "@lib/api/users/auth/signup-cafe24"
import { fetchMe } from "@lib/api/users/me"
import SignupTemplate from "domains/auth/templates/signup-template"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

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
  const currentUser = await fetchMe().catch(() => null)

  if (currentUser) {
    redirect(`/${countryCode}/`)
  }

  const isCafe24ModeRequested = resolvedSearchParams.signup_mode === "cafe24"
  const cookieStore = await cookies()
  const cafe24Bootstrap = isCafe24ModeRequested
    ? parseCafe24SignupCookie(cookieStore.get(CAFE24_SIGNUP_COOKIE)?.value)
    : null

  const signupMode =
    isCafe24ModeRequested && cafe24Bootstrap ? "cafe24" : "default"

  return (
    <>
      <MobileBackHeader title="회원가입" />
      <SignupTemplate mode={signupMode} cafe24Bootstrap={cafe24Bootstrap} />
    </>
  )
}
