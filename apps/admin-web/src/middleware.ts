import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const FIVE_MINUTES = 5 * 60 * 1000;
const ACCESS_MAX_AGE = 60 * 15; // 15 min
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks

const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? '';
const AUTH_WEB_ORIGIN = process.env.AUTH_WEB_ORIGIN ?? '';
const PARENT_COOKIE_DOMAIN = process.env.PARENT_COOKIE_DOMAIN ?? '';
const PARENT_COOKIE_SECURE =
  (process.env.PARENT_COOKIE_SECURE ?? 'true') === 'true';
const PARENT_COOKIE_SAMESITE = (process.env.PARENT_COOKIE_SAMESITE ?? 'lax') as
  | 'lax'
  | 'strict'
  | 'none';

const ACCESS_TOKEN = 'accessToken';
const REFRESH_TOKEN = 'refreshToken';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  // BYPASS_AUTH=true 환경변수로만 인증 우회 가능 (개발 환경에서 MSW 사용 시)
  if (process.env.BYPASS_AUTH === 'true') {
    return NextResponse.next();
  }

  // 공개 경로 (토큰 체크 안 함). /login 은 auth-web 으로 redirect 만 함
  const publicPaths = ['/login', '/unauthorized'];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));
  if (isPublicPath) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN)?.value;

  // 토큰이 둘 다 없으면 auth-web 로그인으로 redirect
  if (!accessToken && !refreshToken) {
    return redirectToSignin(request);
  }

  // accessToken 검증 및 선제적 갱신
  if (accessToken) {
    try {
      const { payload } = await jwtVerify(accessToken, JWT_SECRET);
      const expiresAt = (payload.exp ?? 0) * 1000;
      const needsProactiveRefresh = expiresAt - Date.now() < FIVE_MINUTES;

      if (!needsProactiveRefresh) {
        return NextResponse.next();
      }

      if (refreshToken) {
        const newToken = await fetchNewToken(refreshToken);
        if (newToken) {
          return setRefreshedTokenResponse(newToken);
        }
      }
      return NextResponse.next();
    } catch {
      if (!refreshToken) {
        return redirectToSignin(request);
      }
      try {
        const newToken = await fetchNewToken(refreshToken);
        if (!newToken) return redirectToSignin(request);
        try {
          await jwtVerify(newToken, JWT_SECRET);
        } catch {
          console.error('재발급받은 토큰이 유효하지 않음');
          return redirectToSignin(request);
        }
        return setRefreshedTokenResponse(newToken);
      } catch (fetchError) {
        console.error('토큰 재발급 중 에러:', fetchError);
        return redirectToSignin(request);
      }
    }
  }

  // accessToken 없고 refreshToken만 있는 경우
  if (refreshToken) {
    try {
      const newToken = await fetchNewToken(refreshToken);
      if (!newToken) return redirectToSignin(request);
      try {
        await jwtVerify(newToken, JWT_SECRET);
      } catch {
        return redirectToSignin(request);
      }
      return setRefreshedTokenResponse(newToken);
    } catch {
      return redirectToSignin(request);
    }
  }

  return NextResponse.next();
}

function redirectToSignin(request: NextRequest): NextResponse {
  const url = new URL('/signin', AUTH_WEB_ORIGIN);
  url.searchParams.set('redirect_to', request.nextUrl.href);
  return NextResponse.redirect(url);
}

async function fetchNewToken(refreshToken: string): Promise<string | null> {
  const response = await fetch(`${USER_SERVICE_URL}/auth/restore-token`, {
    method: 'POST',
    headers: { Cookie: `refreshToken=${refreshToken}` },
  });
  if (!response.ok) {
    console.error('토큰 재발급 실패:', response.status);
    return null;
  }
  const data = await response.json();
  return data?.data?.accessToken ?? null;
}

function setRefreshedTokenResponse(newAccessToken: string): NextResponse {
  const response = NextResponse.next();
  response.cookies.set(ACCESS_TOKEN, newAccessToken, {
    domain: PARENT_COOKIE_DOMAIN || undefined,
    httpOnly: true,
    secure: PARENT_COOKIE_SECURE,
    sameSite: PARENT_COOKIE_SAMESITE,
    path: '/',
    maxAge: ACCESS_MAX_AGE,
  });
  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

// REFRESH_MAX_AGE referenced for documentation parity with auth-web (refresh maxAge
// is owned by auth-web at sign-in; middleware only refreshes accessToken)
void REFRESH_MAX_AGE;
