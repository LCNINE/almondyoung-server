import {
  isDemoConsoleEnabled,
  isDemoUnavailablePath,
} from './lib/demo/capabilities';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';
import { tenantShellScreenOf } from './lib/tenant-shell/allowlist';
import { neutralPageResponse } from './lib/tenant-shell/neutral-page';
import { resolveSiteForHost } from './lib/tenant-shell/site-lookup';
import {
  admitsToken,
  redirectOriginOf,
  requestHostFrom,
} from './lib/tenant-shell/site-rules';

const ACCESS_TOKEN = 'accessToken';
const REFRESH_TOKEN = 'refreshToken';
const CHANGE_PASSWORD_PATH = '/account/change-password';
/** 토큰 테넌트가 이 주소의 테넌트와 다를 때 — 로그아웃만 권한다(다시 로그인하면 같은 토큰이 나와 /login 으로 보내면 맴돈다). */
const WRONG_ACCOUNT_PATH = '/wrong-account';
/** 테넌트 셸의 목록 밖 경로 — 없는 경로로 rewrite 해 Next 의 not-found(404)를 그린다. */
const NOT_FOUND_PATH = '/_tenant-shell-not-found';

const PUBLIC_PATHS = [
  '/login',
  '/unauthorized',
  '/auth/callback',
  '/auth/ensure',
  WRONG_ACCOUNT_PATH,
];
/** 테넌트 셸의 공개 경로 — `/unauthorized` 는 기존 셸 화면이라 뺀다. */
const TENANT_PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/ensure', WRONG_ACCOUNT_PATH];

// admin-web 은 user-service IdP 의 OIDC RP. access_token 검증은 RS256 + JWKS 단일화.
// HS256 fallback / parent-domain 쿠키 / /auth/restore-token 호출은 모두 제거됨.
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

if (!OAUTH_JWKS_URL || !OAUTH_ISSUER_URL || !OIDC_CLIENT_ID) {
  console.warn(
    '[middleware] OIDC env not fully configured: OAUTH_JWKS_URL, OAUTH_ISSUER_URL, OIDC_CLIENT_ID 필요'
  );
}

const JWKS = OAUTH_JWKS_URL
  ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL))
  : null;

const VERIFY_OPTS: JWTVerifyOptions = {
  audience: OIDC_CLIENT_ID,
  ...(OAUTH_ISSUER_URL ? { issuer: OAUTH_ISSUER_URL } : {}),
  algorithms: ['RS256'],
};

async function verifyAccessToken(token: string) {
  if (!JWKS) throw new Error('JWKS not configured');
  return jwtVerify(token, JWKS, VERIFY_OPTS);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const demoConsoleOff = !isDemoConsoleEnabled(process.env);
  if (pathname.startsWith('/api/demo/') && demoConsoleOff) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (process.env.APP_STAGE === 'demo' && isDemoUnavailablePath(pathname)) {
    return NextResponse.json(
      { message: '시연 환경에서 제공하지 않는 기능입니다.' },
      { status: 404 }
    );
  }

  // 정적 파일 및 API 라우트는 미들웨어를 거치지 않음
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/public/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 들어온 주소가 셸을 정한다(비공개 ADR 0008). 기본 주소는 조회하지 않는다. BYPASS_AUTH 는 언제나 기존 셸.
  const site = await resolveSiteForHost(
    requestHostFrom((name) => request.headers.get(name))
  );
  if (site.kind === 'unavailable') return neutralPageResponse();
  // 테넌트 셸은 아래 허용 목록이 셸의 not-found 로 404 를 낸다 — 글자 응답엔 파비콘 링크가 없어 브라우저가 기본
  // /favicon.ico(아몬드영 아이콘)를 부르므로 여기서 끊지 않는다.
  if (
    (pathname === '/demo' || pathname.startsWith('/demo/')) &&
    demoConsoleOff &&
    site.kind !== 'tenant'
  ) {
    return new NextResponse('Not found', { status: 404 });
  }
  const origin = redirectOriginOf(site, request);

  // BYPASS_AUTH=true 환경변수로만 인증 우회 가능 (개발 환경에서 MSW 사용 시)
  if (process.env.BYPASS_AUTH === 'true') {
    return NextResponse.next();
  }

  // 테넌트 셸은 허용 목록 화면만 연다. `/` 는 첫 화면으로 보내는 입구다(route-guard). ⚠️ 방어선이 아니다 — 서버 쪽 문이 따로 막는다.
  const publicPaths = site.kind === 'tenant' ? TENANT_PUBLIC_PATHS : PUBLIC_PATHS;
  const isPublic = publicPaths.some((path) => pathname.startsWith(path));
  if (
    site.kind === 'tenant' &&
    !isPublic &&
    pathname !== '/' &&
    !tenantShellScreenOf(pathname)
  ) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }

  // /login 은 OIDC authorize 로 redirect, /auth/callback 은 code 교환.
  if (isPublic) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  const hasRefreshToken = Boolean(request.cookies.get(REFRESH_TOKEN)?.value);
  if (!accessToken) {
    return bounce(request, origin, hasRefreshToken);
  }

  // accessToken 검증: 유효하면 통과, 만료/invalid 시 갱신/로그인으로.
  // 미들웨어(Edge)에서 직접 refresh 하지 않는다 — 공유 락이 없어 한 페이지의 병렬 요청이 같은
  // refreshToken 을 동시에 쓰면 user-service reuse detection 이 세션을 무효화한다. 대신 전체
  // 네비게이션당 1회만 들르는 Node 라우트 `/auth/ensure` 로 보내 거기서 refresh 한다.
  // SPA 내부 fetch 의 refresh 는 여전히 client.ts(Web Locks)가 담당.
  try {
    const { payload } = await verifyAccessToken(accessToken);
    // 양방향 — 테넌트 셸은 그 테넌트 토큰만, 기존 셸은 테넌트 1 토큰만.
    const tokenTenant =
      typeof payload.tenant === 'string' && payload.tenant !== ''
        ? payload.tenant
        : undefined;
    if (!admitsToken(site, tokenTenant, process.env.TENANT_GATE_MODE)) {
      return NextResponse.redirect(
        new URL(WRONG_ACCOUNT_PATH, origin)
      );
    }
    // 테넌트 도메인의 첫 로그인 변경은 테넌트 auth 화면이 코드를 내주기 전에 끝낸다 — 여기 분기는 기존 셸 몫이다.
    const mustChange =
      site.kind === 'default' && payload.must_change_password === true;
    if (mustChange && pathname !== CHANGE_PASSWORD_PATH) {
      return NextResponse.redirect(
        new URL(CHANGE_PASSWORD_PATH, origin)
      );
    }
    return NextResponse.next();
  } catch {
    return bounce(request, origin, hasRefreshToken);
  }
}

/**
 * refresh token 이 있으면 `/auth/ensure` 로 보내 조용히 갱신 시도, 없으면 곧장 `/login`.
 * (refresh token 까지 없는 첫 진입은 ensure 를 들러도 어차피 /login 으로 떨어지므로 한 홉 절약.)
 */
function bounce(
  request: NextRequest,
  origin: string,
  hasRefreshToken: boolean
): NextResponse {
  const target = hasRefreshToken ? '/auth/ensure' : '/login';
  const url = new URL(target, origin);
  url.searchParams.set(
    'redirect_to',
    request.nextUrl.pathname + request.nextUrl.search
  );
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
