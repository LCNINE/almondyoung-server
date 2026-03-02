import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL;

// CSR용 토큰 갱신 엔드포인트.
// 브라우저가 refreshToken 쿠키와 함께 이 라우트를 호출하면,
// user-service의 /auth/restore-token으로 프록시하고 새 accessToken 쿠키를 반환한다.
export async function POST(request: NextRequest) {
  if (!USER_SERVICE_URL) {
    return new NextResponse(null, { status: 500 });
  }

  const cookieHeader = request.headers.get('cookie') ?? '';

  let res: Response;
  try {
    res = await fetch(`${USER_SERVICE_URL}/auth/restore-token`, {
      method: 'POST',
      headers: { cookie: cookieHeader },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }

  if (!res.ok) {
    return new NextResponse(null, { status: res.status });
  }

  // Set-Cookie 헤더에서 accessToken 값 추출
  const setCookieHeader = res.headers.get('set-cookie') ?? '';
  const match = setCookieHeader.match(/^accessToken=([^;]+)/);
  if (!match) {
    return new NextResponse(null, { status: 500 });
  }

  // domain을 user-service와 동일하게 맞춰야 기존 쿠키를 덮어쓰고 중복이 생기지 않음
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set('accessToken', match[1], {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 15, // 15분 (user-service와 동일)
    domain: cookieDomain,
  });
  return response;
}
