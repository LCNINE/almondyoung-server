import { appEnv } from "../config/env"
import { WEBVIEW_LOGIN_REDIRECT } from "./callback"

/**
 * Medusa 에 OIDC 흐름 시작을 요청해 authorize URL 을 받는다.
 * storefront 의 startOidcLogin 은 서버 액션이라 redirect() 로 끝나므로 앱이 쓸 수 없다.
 * 대신 같은 Medusa 엔드포인트를 직접 호출한다 — callback_url 만 앱 스킴으로 바꾼다.
 */
export async function requestMedusaAuthorizeUrl(
  deps: { fetch: typeof fetch } = { fetch }
): Promise<string> {
  const res = await deps.fetch(`${appEnv.medusaUrl}/auth/customer/user-service-sso`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-publishable-api-key": appEnv.medusaPublishableKey,
    },
    body: JSON.stringify({ callback_url: WEBVIEW_LOGIN_REDIRECT }),
  })
  if (!res.ok) {
    // 업스트림 응답 본문은 임의의 문자열이다(토큰·code 같은 진단용이 아닌 값일
    // 수 있음) — 전체를 그대로 담지 않고 짧은 접두사만 잘라 싣는다. 이 에러는
    // SplashGate 의 catch 로 흘러가 console.warn 되므로, 여기서 자르지 않으면
    // SplashGate 쪽의 "진단용 문자열만 남긴다"는 로깅 전제가 깨진다.
    const bodyPrefix = (await res.text()).slice(0, 200)
    throw new Error(`authorize 요청 실패: ${res.status} ${bodyPrefix}`)
  }
  const json = (await res.json()) as { location?: string }
  if (!json.location) throw new Error("authorize 응답에 location 이 없습니다")
  return json.location
}
