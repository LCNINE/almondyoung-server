import { startOidcLogin } from "@/lib/api/medusa/sso"

// 로그인 진입은 medusa의 user-service-sso 프로바이더를 통한 OIDC redirect 플로우로 일원화.
// startOidcLogin이 medusa로부터 authorize URL을 받아 IdP(auth-web)로 보낸다.
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams?: Promise<{ redirect_to?: string }>
}) {
  const { countryCode } = await params
  const resolved = (await searchParams) ?? {}
  await startOidcLogin(countryCode, resolved.redirect_to)
}
