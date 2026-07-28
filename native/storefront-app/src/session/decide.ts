import type { StoredTokens } from "../auth/token-store"

/**
 * 콜드스타트에 로그인 흐름을 실행할지 판단한다.
 * refreshToken 만 있으면 웹뷰 쿠키가 살아있을 가능성이 높으므로 건너뛰고,
 * 실제로 죽어 있으면 웹이 로그인 화면을 보여준다 (앱이 갇히지 않는다).
 */
export function decideStartupAction(input: {
  tokens: StoredTokens | null
  now: number
}): "login" | "skip" {
  if (!input.tokens) return "login"
  if (!input.tokens.refreshToken) return "login"
  return "skip"
}
