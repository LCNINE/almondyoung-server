import 'server-only';

import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * accessToken 검증 유틸 (Node 런타임 전용 — Server Component / Route Handler 에서 사용).
 *
 * 원래 이 검증은 Edge middleware 가 `/pay/:path*` 에 대해 수행했으나, OpenNext Edge middleware 는
 * same-origin redirect 의 Location 을 **상대 경로**로 직렬화한다. iOS Chrome(WKWebView/NSURLSession)
 * 은 그 상대 Location 을 resolve 하지 못해 "웹사이트에 연결할 수 없음" 으로 죽었다 (Safari·Android
 * Chrome 은 정상). Node 런타임의 redirect 는 절대 URL 을 유지하므로 가드를 page 로 내렸다.
 */

const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL || process.env.NEXT_PUBLIC_OAUTH_JWKS_URL;
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

const FIVE_MINUTES = 5 * 60 * 1000;

const JWKS = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

if (!OAUTH_JWKS_URL || !OIDC_ISSUER_URL || !OIDC_CLIENT_ID) {
  console.warn('[wallet-web] OIDC env is incomplete; protected pages will redirect to login.');
}

/**
 * accessToken 이 서명·iss·aud 검증을 통과하고 만료 5분 이내가 아닌 경우에만 true.
 * 토큰이 없거나 env 가 불완전하면 false (→ 호출부가 로그인으로 redirect).
 */
export async function isAccessTokenUsable(token: string | undefined | null): Promise<boolean> {
  if (!token || !JWKS || !OIDC_ISSUER_URL || !OIDC_CLIENT_ID) {
    return false;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: OIDC_ISSUER_URL,
      audience: OIDC_CLIENT_ID,
      algorithms: ['RS256'],
    });

    if (!payload.exp) {
      return false;
    }

    return payload.exp * 1000 - Date.now() >= FIVE_MINUTES;
  } catch {
    return false;
  }
}

/**
 * wallet-web 자신의 신뢰된 origin. OIDC_REDIRECT_URI (= https://wallet-web…/auth/callback) 에서 추출.
 * 절대 URL redirect 를 만들 때의 base 로 사용한다 (CloudFront 뒤 내부 host 위험 회피).
 */
export function selfOrigin(): string | undefined {
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // malformed — caller falls back
    }
  }
  return undefined;
}
