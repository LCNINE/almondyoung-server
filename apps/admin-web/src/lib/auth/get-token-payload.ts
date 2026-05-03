import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface TokenPayload {
  sub: string;
  roles: string[];
  email: string;
  login_id: string;
}

const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

const JWKS = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

/**
 * 자체 도메인 accessToken 쿠키를 읽어 RS256 으로 서명 검증한 뒤 payload 반환.
 * user-service /oauth/token 이 access_token 에 sub/email/login_id/roles 를 함께 박으므로
 * RBAC 게이팅 (route-guard.tsx 등) 에서 추가 호출 없이 사용할 수 있다.
 */
export async function getTokenPayload(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('accessToken')?.value;

  if (!token) return null;
  if (!JWKS || !OAUTH_ISSUER_URL || !OIDC_CLIENT_ID) {
    throw new Error('OIDC env (OAUTH_JWKS_URL, OAUTH_ISSUER_URL, OIDC_CLIENT_ID) not configured');
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: OAUTH_ISSUER_URL,
      audience: OIDC_CLIENT_ID,
      algorithms: ['RS256'],
    });

    return {
      sub: payload.sub as string,
      roles: (payload.roles as string[]) ?? [],
      email: (payload.email as string) ?? '',
      login_id: (payload.login_id as string) ?? '',
    };
  } catch {
    return null;
  }
}
