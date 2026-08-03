import * as AuthSession from "expo-auth-session"
import { appEnv } from "../config/env"
import { isExpired, type StoredTokens, type TokenStore } from "./token-store"

export const APP_LOGIN_REDIRECT = "almondyoung://oauth/callback"

// authorize 와 token 은 호스트가 다르다.
//   /oauth/authorize   → auth-web (로그인 UI. auth-web 에는 이 페이지와 /oauth/end_session 만 있다)
//   /oauth/token       → user-service (실제 토큰 발급처)
// Medusa 의 user-service-sso 프로바이더도 같은 분리를 쓴다 — authorize 는 authWebUrl,
// exchangeCode 는 issuerUrl(user-service). 둘을 같은 호스트로 묶으면 토큰 교환이 404 로 죽는다.
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${appEnv.authWebOrigin}/oauth/authorize`,
  tokenEndpoint: `${appEnv.userServiceUrl}/oauth/token`,
}

/**
 * 앱 자신의 public client 로 PKCE authorization_code 흐름을 수행한다.
 * 이 토큰은 이후 네이티브 화면(고객센터 채팅 등)이 쓴다.
 * 웹뷰 세션과는 분리되어 있으며 서로 토큰을 넘기지 않는다.
 *
 * 인터랙티브 브라우저 프롬프트를 직접 구동하므로 유닛 테스트 대상이 아니다.
 */
export async function loginWithPkce(): Promise<StoredTokens> {
  const request = new AuthSession.AuthRequest({
    clientId: appEnv.appClientId,
    redirectUri: APP_LOGIN_REDIRECT,
    scopes: ["openid", "profile", "email"],
    usePKCE: true,
  })

  const result = await request.promptAsync(discovery)
  if (result.type !== "success" || !result.params.code) {
    throw new Error(`앱 로그인 실패: ${result.type}`)
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: appEnv.appClientId,
      code: result.params.code,
      redirectUri: APP_LOGIN_REDIRECT,
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    discovery,
  )

  if (!token.accessToken || !token.refreshToken) {
    throw new Error("토큰 응답에 access/refresh 가 없습니다")
  }

  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + (token.expiresIn ?? 900) * 1000,
  }
}

/** ensureFreshAccessToken 이 실제로 필요로 하는 갱신 응답의 최소 모양. */
export type RefreshResult = {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

/**
 * `AuthSession.refreshAsync` 를 감싸는 함수 타입. 실제 구현은 native 모듈을
 * 호출하므로 순수 로직인 이 파일의 테스트는 이 자리에 fake 를 주입한다
 * (authorize.ts 의 `deps: { fetch }` 관례를 그대로 따른다).
 */
export type RefreshFn = (
  config: { clientId: string; refreshToken: string },
  discovery: Pick<AuthSession.DiscoveryDocument, "tokenEndpoint">
) => Promise<RefreshResult>

/**
 * 저장된 accessToken 이 유효하면 그대로, 만료됐으면 refreshToken 으로 갱신해 돌려준다.
 * 갱신도 실패하면 null — 호출자는 이 경우 조용히 포기한다 (앱 사용을 막지 않는다).
 *
 * 갱신 실패는 두 갈래로 갈린다 — 둘을 섞으면 안 된다:
 *   1) 네트워크 오류(오프라인, 타임아웃 등): 토큰이 여전히 유효할 수 있으므로
 *      store 를 그대로 둔다. 다음 시도에서 다시 성공할 수 있다. 여기서 지우면
 *      비행기 모드로 앱을 한 번 연 사용자를 영구 로그아웃시키는 사고가 된다.
 *   2) 프로토콜 수준 거부(만료/철회된 refreshToken 등): 이 refreshToken 은
 *      다시 시도해도 절대 성공하지 못한다. store 를 지우지 않으면
 *      decideStartupAction 이 매 콜드스타트마다 "skip" 을 반환해 로그인 흐름이
 *      영영 재실행되지 않는다(죽은 세션이 무한히 유지되는 사고).
 *
 * `AuthSession.refreshAsync` 는 (2)의 경우 `AuthSession.TokenError` 를 던진다 —
 * OAuth 서버가 `{ error: "invalid_grant", ... }` 처럼 명시적인 에러 응답을 준
 * 경우에만 이 타입이고, `.code` 에 그 `error` 값이 담긴다. 네트워크 오류는 이
 * 타입이 아닌 일반 Error(TypeError 등)로 온다 — `TokenRequest.performAsync`
 * 구현을 보면 응답 안에 `error` 필드가 있을 때만 TokenError 를 던지므로 이
 * instanceof 검사로 두 경우를 확실히 구분할 수 있다.
 */
export async function ensureFreshAccessToken(
  store: TokenStore,
  deps: { refresh: RefreshFn } = { refresh: AuthSession.refreshAsync }
): Promise<string | null> {
  const tokens = await store.read()
  if (!tokens) return null
  if (!isExpired(tokens, Date.now())) return tokens.accessToken

  try {
    const refreshed = await deps.refresh(
      { clientId: appEnv.appClientId, refreshToken: tokens.refreshToken },
      discovery,
    )
    if (!refreshed.accessToken) {
      // 응답은 정상적으로 왔지만(throw 하지 않음) accessToken 이 없다 — 이 응답으로는
      // 앞으로도 절대 인증할 수 없으므로 죽은 세션을 지운다.
      await store.clear()
      return null
    }
    const next: StoredTokens = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 900) * 1000,
    }
    await store.write(next)
    return next.accessToken
  } catch (error) {
    if (error instanceof AuthSession.TokenError) {
      // invalid_grant 등 프로토콜 수준 거부 — 이 refreshToken 은 다시는 못 쓴다.
      await store.clear()
    }
    // 그 외(네트워크 오류 등)는 store 를 건드리지 않는다 — 일시적 실패일 수 있다.
    return null
  }
}
