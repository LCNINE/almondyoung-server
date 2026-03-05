// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { USER_SERVICE_BASE_URL } from './const';

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);
const FIVE_MINUTES = 5 * 60 * 1000;

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
    console.log('인증 체크 우회 (BYPASS_AUTH=true):', pathname);
    return NextResponse.next();
  }

  // 공개 경로 (토큰 체크 안 함)
  const publicPaths = ['/login', '/unauthorized'];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('admin_access_token')?.value;
  const refreshToken = request.cookies.get('admin_refresh_token')?.value;

  // 토큰이 둘 다 없으면 로그인 페이지로 리다이렉트
  if (!accessToken && !refreshToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // accessToken 검증 및 선제적 갱신
  if (accessToken) {
    try {
      const { payload } = await jwtVerify(accessToken, JWT_SECRET);

      // 만료 5분 전이면 선제적 갱신
      const expiresAt = (payload.exp ?? 0) * 1000;
      const needsProactiveRefresh = expiresAt - Date.now() < FIVE_MINUTES;

      if (!needsProactiveRefresh) {
        return NextResponse.next();
      }

      // 5분 이내 만료 예정 → refreshToken으로 갱신 시도
      if (refreshToken) {
        const newToken = await fetchNewToken(accessToken, refreshToken);
        if (newToken) {
          return setRefreshedTokenResponse(request, newToken);
        }
      }

      // 갱신 실패해도 현재 토큰이 아직 유효하므로 통과
      return NextResponse.next();
    } catch {
      // accessToken 만료 → refreshToken으로 갱신 시도
      if (!refreshToken) {
        return NextResponse.redirect(new URL('/login', request.url));
      }

      try {
        const newToken = await fetchNewToken(accessToken, refreshToken);
        if (!newToken) {
          return NextResponse.redirect(new URL('/login', request.url));
        }

        // 갱신된 토큰 유효성 검증
        try {
          await jwtVerify(newToken, JWT_SECRET);
        } catch {
          console.error('재발급받은 토큰이 유효하지 않음');
          return NextResponse.redirect(new URL('/login', request.url));
        }

        return setRefreshedTokenResponse(request, newToken);
      } catch (fetchError) {
        console.error('토큰 재발급 중 에러:', fetchError);
        return NextResponse.redirect(new URL('/login', request.url));
      }
    }
  }

  // accessToken 없고 refreshToken만 있는 경우
  if (refreshToken) {
    try {
      const newToken = await fetchNewToken('', refreshToken);
      if (!newToken) {
        return NextResponse.redirect(new URL('/login', request.url));
      }

      try {
        await jwtVerify(newToken, JWT_SECRET);
      } catch {
        return NextResponse.redirect(new URL('/login', request.url));
      }

      return setRefreshedTokenResponse(request, newToken);
    } catch {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

async function fetchNewToken(
  accessToken: string,
  refreshToken: string
): Promise<string | null> {
  const response = await fetch(`${USER_SERVICE_BASE_URL}/auth/restore-token`, {
    method: 'POST',
    headers: {
      Cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
    },
  });

  if (!response.ok) {
    console.error('토큰 재발급 실패:', response.status);
    return null;
  }

  const data = await response.json();
  return data?.data?.accessToken ?? null;
}

function setRefreshedTokenResponse(
  request: NextRequest,
  newAccessToken: string
): NextResponse {
  const response = NextResponse.next();
  response.cookies.set('admin_access_token', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
