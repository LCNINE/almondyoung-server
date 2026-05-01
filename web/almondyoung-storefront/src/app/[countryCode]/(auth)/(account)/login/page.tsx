import { redirect } from "next/navigation"

// 로그인 UI 는 auth-web 으로 일원화. 기존 LoginTemplate 은 디자인 참조용으로 보존:
// import { MobileBackHeader } from "@/components/layout/header/m-back-header"
// import { fetchMe } from "@lib/api/users/me"
// import { normalizeRedirectPath, toLocalizedPath } from "@/lib/utils/locale-path"
// import LoginTemplate from "domains/auth/templates/login-template"
// import { redirect } from "next/navigation"
//
// export default async function LoginPage({
//   params,
//   searchParams,
// }: {
//   params: Promise<{ countryCode: string }>
//   searchParams?: Promise<{ redirect_to?: string }>
// }) {
//   const { countryCode } = await params
//   const resolvedSearchParams = (await searchParams) ?? {}
//   const redirectTo = resolvedSearchParams.redirect_to
//   const targetPath = normalizeRedirectPath(redirectTo)
//   const currentUser = await fetchMe().catch(() => null)
//   if (currentUser) {
//     redirect(toLocalizedPath(countryCode, targetPath))
//   }
//   return (
//     <>
//       <MobileBackHeader title="로그인" />
//       <LoginTemplate />
//     </>
//   )
// }

const AUTH_WEB_ORIGIN = process.env.AUTH_WEB_ORIGIN ?? ""
const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? ""

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams?: Promise<{ redirect_to?: string }>
}) {
  const { countryCode } = await params
  const resolved = (await searchParams) ?? {}
  const target = resolved.redirect_to?.startsWith("/")
    ? resolved.redirect_to
    : `/${countryCode}`
  const absolute = PUBLIC_BASE_URL
    ? new URL(target, PUBLIC_BASE_URL).toString()
    : target

  const url = new URL("/signin", AUTH_WEB_ORIGIN)
  url.searchParams.set("redirect_to", absolute)
  redirect(url.toString())
}
