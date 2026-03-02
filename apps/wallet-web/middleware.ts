import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL;

// JWT payload의 exp 클레임으로 만료 여부 확인 (서명 검증 없이 디코딩만)
function isAccessTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (typeof payload.exp !== 'number') return true;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

// user-service에 직접 refresh 요청 후 새 accessToken 값 반환
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (!USER_SERVICE_URL) return null;
  try {
    const res = await fetch(`${USER_SERVICE_URL}/auth/restore-token`, {
      method: 'POST',
      headers: { cookie: `refreshToken=${refreshToken}` },
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/^accessToken=([^;]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value;
  const refreshToken = request.cookies.get('refreshToken')?.value;

  // accessToken이 없거나 만료됐고 refreshToken이 있으면 선제 갱신
  if (refreshToken && (!accessToken || isAccessTokenExpired(accessToken))) {
    const newToken = await refreshAccessToken(refreshToken);

    if (newToken) {
      // Server Component의 cookies()가 새 토큰을 보도록 요청 헤더 업데이트
      const requestHeaders = new Headers(request.headers);
      const otherCookies = request.cookies
        .getAll()
        .filter((c) => c.name !== 'accessToken')
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      requestHeaders.set(
        'cookie',
        otherCookies ? `${otherCookies}; accessToken=${newToken}` : `accessToken=${newToken}`,
      );

      const response = NextResponse.next({ request: { headers: requestHeaders } });

      // 브라우저도 새 쿠키를 저장하도록 응답에도 Set-Cookie
      // domain을 user-service와 동일하게 맞춰야 기존 쿠키를 덮어쓰고 중복이 생기지 않음
      const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
      response.cookies.set('accessToken', newToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 15,
        domain: cookieDomain,
      });
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/pay/:path*'],
};
