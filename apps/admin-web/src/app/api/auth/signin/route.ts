import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_BASE_URL =
  process.env.USER_SERVICE_URL ?? 'http://localhost:3030';

const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? 'admin.almondyoung-next.com';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const upstream = await fetch(`${USER_SERVICE_BASE_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  // user-service가 Set-Cookie로 accessToken/refreshToken을 내려줬을 경우 파싱
  const setCookieHeader = upstream.headers.get('set-cookie') ?? '';
  const accessTokenMatch = setCookieHeader.match(
    /(?:^|,\s*)accessToken=([^;,]+)/
  );
  const refreshTokenMatch = setCookieHeader.match(
    /(?:^|,\s*)refreshToken=([^;,]+)/
  );

  // body에서도 fallback 추출 (일부 구현은 body로 내려주기도 함)
  const accessToken = accessTokenMatch?.[1] ?? data?.data?.accessToken ?? '';
  const refreshToken = refreshTokenMatch?.[1] ?? data?.data?.refreshToken ?? '';

  const response = NextResponse.json(data, { status: upstream.status });

  if (accessToken) {
    response.cookies.set('admin_access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? ADMIN_DOMAIN : undefined,
      path: '/',
    });
  }

  if (refreshToken) {
    response.cookies.set('admin_refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? ADMIN_DOMAIN : undefined,
      path: '/',
    });
  }

  return response;
}
