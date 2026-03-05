// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { USER_SERVICE_BASE_URL } from './const';

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);

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



//////////////////>>>>>>>>>>>>>>>>>>>>>>>>>>

// 개발모드 테스트시 추후 지워주세요
  // 개발 모드에서 인증 우회 (환경 변수로 제어 가능)
  const isDevelopment = process.env.NODE_ENV === 'development';
  const bypassAuth = process.env.BYPASS_AUTH === 'true' || isDevelopment;

  if (bypassAuth) {
    console.log('🔓 개발 모드: 인증 체크 우회', pathname);
    return NextResponse.next();
  }
//////////////////>>>>>>>>>>>>>>>>>>>>>>>>>>


  // 공개 경로 (토큰 체크 안 함)
  const publicPaths = ['/login', '/unauthorized'];
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('accessToken')?.value;
  const refreshToken = request.cookies.get('refreshToken')?.value;

  // 토큰이 둘 다 없으면 로그인 페이지로 리다이렉트
  if (!accessToken && !refreshToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // accessToken 검증 (만료 여부 확인)
  try {
    if (accessToken) {
      await jwtVerify(accessToken, JWT_SECRET);
      // 토큰이 유효하면 통과
      return NextResponse.next();
    }
  } catch { //에러 추가 (error) 해주면 됨됨
    if (!refreshToken) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      const response = await fetch(
        `${USER_SERVICE_BASE_URL}/auth/restore-token`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Cookie: request.cookies.toString(),
          },
        }
      );

      // API 호출 실패 시 로그인으로 리다이렉트
      if (!response.ok) {
        console.error('토큰 재발급 실패:', response.status);
        return NextResponse.redirect(new URL('/login', request.url));
      }

      const data = await response.json();
      const newAccessToken = data.data.accessToken;

      // 새 토큰이 유효한지 검증 (무한 리다이렉트 방지)
      try {
        await jwtVerify(newAccessToken, JWT_SECRET);
      } catch { //(verifyError) 해주면 됨됨
        console.error('재발급받은 토큰이 유효하지 않음');
        return NextResponse.redirect(new URL('/login', request.url));
      }

      // 새 토큰을 쿠키에 세팅하고 리다이렉트 (새로운 요청 사이클 시작)
      const redirectResponse = NextResponse.redirect(request.url);
      redirectResponse.cookies.set('accessToken', newAccessToken);

      return redirectResponse;
    } catch (fetchError) {
      console.error('토큰 재발급 중 에러:', fetchError);
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
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
