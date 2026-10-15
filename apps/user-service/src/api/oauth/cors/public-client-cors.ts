// 공개 OAuth 클라이언트(SPA)의 웹 origin 에 OAuth 엔드포인트 한정으로 CORS 를 연다.
// Keycloak 의 "Web Origins: +" 와 같은 개념 — 등록된 redirect_uri 에서 origin 을 도출한다.
//
// 두 규칙이 겹치면 기존 규칙(CORS_ORIGIN_DOMAINS, credentials: true)이 이긴다.
// 이 규칙으로 연 응답에는 Access-Control-Allow-Credentials 를 붙이지 않는다 — 공개 클라이언트는
// 누구나 등록 요청을 할 수 있는 origin 이라, 여기에 쿠키까지 열면 그 origin 에서 user-service 의
// 쿠키 인증 API 를 부를 수 있게 된다. 토큰 교환·갱신·폐기와 Bearer userinfo 는 쿠키가 필요 없다.

import type { FastifyCorsOptions } from '@fastify/cors';
import type { FastifyRequest } from 'fastify';

// 경로 → 이 규칙으로 허용하는 실제 메서드. end_session 의 GET 은 브라우저 navigate 라 CORS 와 무관하다.
const OAUTH_CORS_ROUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['/oauth/token', new Set(['POST'])],
  ['/oauth/revoke', new Set(['POST'])],
  ['/oauth/userinfo', new Set(['GET'])],
  ['/oauth/end_session', new Set(['POST'])],
]);

// URL.hostname 은 IPv6 를 대괄호째 돌려준다(`[::1]`).
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export type PublicClientOriginSource = {
  clientType: 'confidential' | 'public';
  isActive: boolean;
  redirectUris: string[];
};

export type PublicClientOrigins = {
  /** scheme://host[:port] 정확 일치 */
  exact: ReadonlySet<string>;
  /** http loopback 은 redirect_uri 검증(redirect-uri.ts)과 같게 포트를 따지지 않는다. hostname 만 담는다. */
  loopbackHostnames: ReadonlySet<string>;
};

export function collectPublicClientOrigins(clients: PublicClientOriginSource[]): PublicClientOrigins {
  const exact = new Set<string>();
  const loopbackHostnames = new Set<string>();
  for (const client of clients) {
    if (client.clientType !== 'public' || !client.isActive) continue;
    for (const uri of client.redirectUris) {
      const url = tryParse(uri);
      // private-use 스킴(앱)은 origin 이 'null' 이라 웹 origin 이 아니다.
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) continue;
      if (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)) {
        loopbackHostnames.add(url.hostname);
      } else {
        exact.add(url.origin);
      }
    }
  }
  return { exact, loopbackHostnames };
}

export function isPublicClientOriginAllowed(origin: string, allowed: PublicClientOrigins): boolean {
  const url = tryParse(origin);
  // Origin 헤더는 정규형 scheme://host[:port] 여야 한다. 경로·대소문자 변형은 받지 않는다.
  if (!url || url.origin !== origin) return false;
  if (allowed.exact.has(origin)) return true;
  return url.protocol === 'http:' && allowed.loopbackHostnames.has(url.hostname);
}

/** 실제 요청이면 그 메서드, preflight 면 브라우저가 하려는 메서드로 판정한다. */
export function isOAuthCorsRequest(req: Pick<FastifyRequest, 'url' | 'method' | 'headers'>): boolean {
  const path = req.url.split('?')[0];
  const methods = OAUTH_CORS_ROUTES.get(path);
  if (!methods) return false;
  const method =
    req.method === 'OPTIONS' ? String(req.headers['access-control-request-method'] ?? '').toUpperCase() : req.method;
  return methods.has(method);
}

export function publicClientCorsOptions(origin: string): FastifyCorsOptions {
  return {
    origin,
    credentials: false,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

type CorsDelegatorDeps = {
  /** CORS_ORIGIN_DOMAINS 등 기존 전역 규칙. origin 은 문자열 배열이어야 한다. */
  staticOptions: FastifyCorsOptions & { origin: string[] };
  isPublicClientOrigin: (origin: string) => Promise<boolean>;
  onLookupError: (error: unknown) => void;
};

export function createCorsDelegator({ staticOptions, isPublicClientOrigin, onLookupError }: CorsDelegatorDeps) {
  const staticOrigins = new Set(staticOptions.origin);
  return async (req: FastifyRequest): Promise<FastifyCorsOptions> => {
    const origin = req.headers.origin;
    if (!origin || staticOrigins.has(origin) || !isOAuthCorsRequest(req)) return staticOptions;
    try {
      if (await isPublicClientOrigin(origin)) return publicClientCorsOptions(origin);
    } catch (error) {
      // 조회 실패로 요청 전체를 500 으로 만들지 않는다 — 기존 규칙만 적용된 것처럼 군다.
      onLookupError(error);
    }
    return staticOptions;
  };
}

function tryParse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
