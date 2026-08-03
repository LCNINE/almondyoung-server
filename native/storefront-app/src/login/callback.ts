export const WEBVIEW_LOGIN_REDIRECT = "almondyoung://callback/oidc"

/** Custom Tabs 가 돌려준 커스텀 스킴 URL 에서 code·state 를 뽑는다. */
export function parseOidcCallbackParams(
  url: string
): { code: string; state: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.searchParams.get("error")) return null
  const code = parsed.searchParams.get("code")
  const state = parsed.searchParams.get("state")
  if (!code || !state) return null
  return { code, state }
}

/**
 * 기존 storefront OIDC 콜백 라우트 URL.
 * 웹뷰가 이 URL 을 열면 code 를 상환하고 _medusa_jwt + 부모 쿠키가 웹뷰에 심긴다.
 */
export function buildWebviewCallbackUrl(input: {
  origin: string
  countryCode: string
  code: string
  state: string
  /**
   * 로그인 완료 후 storefront 콜백 라우트가 이동할 경로. 로그인 시작 전에
   * 도착한 알림 탭 경로(App.tsx 의 pendingPath)를 실어 보낼 때 쓴다.
   * storefront 콜백 라우트가 이미 `redirect_to` 를 읽어 toLocalizedPath 로
   * 정규화하므로(외부 URL 차단) 오픈 리다이렉트가 되지 않는다.
   */
  redirectTo?: string
}): string {
  const params = new URLSearchParams({ code: input.code, state: input.state })
  if (input.redirectTo) params.set("redirect_to", input.redirectTo)
  return `${input.origin}/${input.countryCode}/callback/oidc?${params.toString()}`
}
