import { startOidcLogin } from "@/lib/api/medusa/sso"

// 가입 화면은 IdP(auth-web)가 전부 담당한다. 이 라우트는 헤더의 "회원가입" 링크가 가리키는
// OIDC 개시 엔드포인트로만 남는다 — state/PKCE 가 매 요청 서버에서 새로 발급돼야 하므로
// 헤더에서 auth-web URL 을 직접 링크할 수는 없다.
export default async function SignupPage({
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
