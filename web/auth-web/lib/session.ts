import "server-only";

import { getIdpAccessToken, hasIdpRefreshToken } from "./idp-session";
import { getMe, restoreAccessToken, type UserProfile } from "./user-service";

async function tryGetMe(accessToken: string): Promise<UserProfile | null> {
  try {
    return await getMe(accessToken);
  } catch {
    return null;
  }
}

/**
 * IdP 자체 host-only 쿠키의 access/refresh 토큰을 user-service 에 검증 위임해 활성 세션 userId 를 얻는다.
 * cookie 의 JWT payload 를 로컬에서 디코드해 신뢰하지 않는다 (서명 검증을 user-service 에 위임).
 *
 * 호출 전제: RSC 또는 server action 에서 호출. 갱신된 access token 은 persist 하지 않으며,
 * cookie 갱신이 필요하면 호출자(server action)가 명시적으로 setIdpSessionCookies 를 수행한다.
 */
export async function getActiveSessionUserId(): Promise<string | null> {
  const accessToken = await getIdpAccessToken();
  if (accessToken) {
    const me = await tryGetMe(accessToken);
    if (me) return me.id;
  }

  const refreshToken = await hasIdpRefreshToken();
  if (!refreshToken) return null;

  // 여기서는 reauth 분기를 띄울 컨텍스트가 없다 (RSC 의 silent SSO 판단/활성 계정 표시용 경로).
  // stale 이면 그냥 "활성 세션 없음" 으로 취급해 호출부가 계정 허브/로그인을 노출하도록 둔다.
  const restored = await restoreAccessToken(refreshToken);
  if (!restored.ok) return null;

  const me = await tryGetMe(restored.accessToken);
  return me?.id ?? null;
}
