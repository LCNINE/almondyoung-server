import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import { fetchMe } from "@lib/api/users/me"
import { normalizeRedirectPath, toLocalizedPath } from "@/lib/utils/locale-path"
import LoginTemplate from "domains/auth/templates/login-template"
import { redirect } from "next/navigation"

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams?: Promise<{ redirect_to?: string }>
}) {
  const { countryCode } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const redirectTo = resolvedSearchParams.redirect_to
  const targetPath = normalizeRedirectPath(redirectTo)
  const currentUser = await fetchMe().catch(() => null)

  if (currentUser) {
    redirect(toLocalizedPath(countryCode, targetPath))
  }

  return (
    <>
      <MobileBackHeader title="로그인" />
      <LoginTemplate />
    </>
  )
}
