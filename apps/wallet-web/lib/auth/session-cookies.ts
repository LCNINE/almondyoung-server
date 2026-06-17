import 'server-only';

import { cookies } from 'next/headers';

import type { TokenSet } from './oidc-client';

// ⚠️ wallet-web 고유 쿠키 이름. 스토어프론트가 부모 도메인(.lcnine-dev.com)에 박는
// `accessToken`/`refreshToken`(client_id=medusa-storefront) 이 모든 서브도메인으로 전송돼
// wallet-web 으로도 넘어온다. 같은 이름이면 서버가 둘을 구분 못 하고 브라우저별 전송 순서에
// 따라 남의 토큰(aud=medusa-storefront)을 읽어 가드가 거부 → 사파리 결제 무한루프가 됐다.
// 그래서 wallet-web 토큰은 충돌하지 않는 고유 이름으로 host-only 발급한다.
const ACCESS_TOKEN = 'wallet_at';
const REFRESH_TOKEN = 'wallet_rt';
const ID_TOKEN = 'wallet_it';
const STATE_COOKIE = 'wallet_oidc_state';

const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks

const PROD = process.env.NODE_ENV === 'production';

/**
 * Next.js cookies() (RequestCookies) 와 NextResponse.cookies (ResponseCookies) 모두
 * set(name, value, options) 시그니처를 공유. 둘 다 받을 수 있도록 구조적 타입.
 */
type Jar = {
  set(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      path?: string;
      maxAge?: number;
      domain?: string;
    },
  ): unknown;
};

/**
 * wallet-web 자체 도메인에 host-only 세션 쿠키 발급. parent-domain 속성을 일부러 지정하지 않아
 * 다른 호스트 (storefront 등) 로의 누설을 차단한다. 형제 RP 와의 SSO 는 IdP 레벨 (auth-web hub)
 * 에서만 일어나며 wallet-web 은 자체 토큰을 자체 호스트에만 박는다.
 */
function commonOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
} {
  return {
    httpOnly: true,
    secure: PROD,
    sameSite: 'lax',
    path: '/',
  };
}

export async function setSessionCookies(tokens: TokenSet): Promise<void> {
  const jar = await cookies();
  writeSessionCookies(jar, tokens);
}

export function writeSessionCookies(jar: Jar, tokens: TokenSet): void {
  jar.set(ACCESS_TOKEN, tokens.accessToken, {
    ...commonOptions(),
    maxAge: tokens.expiresIn,
  });
  jar.set(REFRESH_TOKEN, tokens.refreshToken, {
    ...commonOptions(),
    maxAge: REFRESH_MAX_AGE,
  });
  if (tokens.idToken) {
    jar.set(ID_TOKEN, tokens.idToken, {
      ...commonOptions(),
      maxAge: REFRESH_MAX_AGE,
    });
  }
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  clearSessionCookiesOn(jar);
}

export function clearSessionCookiesOn(jar: Jar): void {
  const opts = { ...commonOptions(), maxAge: 0 };
  jar.set(ACCESS_TOKEN, '', opts);
  jar.set(REFRESH_TOKEN, '', opts);
  jar.set(ID_TOKEN, '', opts);
}

export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_TOKEN)?.value ?? null;
}

/**
 * wallet 백엔드(wallet-api)로 forwarding 할 때 쓸 Cookie 헤더.
 *
 * 백엔드는 `accessToken` 쿠키(또는 Authorization Bearer)에서 토큰을 뽑는데, 브라우저가 보낸
 * 전체 쿠키를 그대로 넘기면 스토어프론트의 부모도메인 `accessToken`(aud=medusa-storefront)이
 * 섞여 백엔드가 잘못된 토큰을 읽을 수 있다. 그래서 wallet-web 자기 토큰만 `accessToken` 이름으로
 * 단독 전달한다(백엔드는 이 이름으로 읽음).
 */
export function backendAuthCookieFromToken(accessToken: string | null | undefined): string {
  return accessToken ? `${ACCESS_TOKEN_FORWARD_NAME}=${accessToken}` : '';
}

export async function getBackendAuthCookie(): Promise<string> {
  return backendAuthCookieFromToken(await getAccessToken());
}

// 백엔드(wallet-api)가 읽는 쿠키 이름. wallet-web 자체 저장 이름(wallet_at)과 달리, 백엔드
// 계약상 `accessToken` 이어야 한다 (apps/wallet 의 getAccessTokenFromRequest).
const ACCESS_TOKEN_FORWARD_NAME = 'accessToken';

export async function getRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_TOKEN)?.value ?? null;
}

export async function getIdToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ID_TOKEN)?.value ?? null;
}

// ──────────────────────────────────────────────
// state cookie (authorize → callback bridge)
// ──────────────────────────────────────────────

const STATE_TTL_SECONDS = 10 * 60; // 10 분

/**
 * authorize 진입점은 Route Handler 라서 `cookies()` 가 아닌 응답 jar
 * (`NextResponse#cookies`) 에 직접 써야 한다 — Server Component 렌더 중
 * cookie mutation 은 Next 가 throw 한다.
 */
export function writeStateCookie(jar: Jar, record: object): void {
  jar.set(STATE_COOKIE, Buffer.from(JSON.stringify(record), 'utf8').toString('base64url'), {
    ...commonOptions(),
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function consumeStateCookie<T = unknown>(): Promise<T | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  if (!raw) return null;
  jar.set(STATE_COOKIE, '', { ...commonOptions(), maxAge: 0 });
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAMES = {
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  ID_TOKEN,
  STATE_COOKIE,
} as const;
