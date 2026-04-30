import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_BASE_URL =
  process.env.USER_SERVICE_URL ?? 'http://localhost:3030';

const PARENT_COOKIE_DOMAIN = process.env.PARENT_COOKIE_DOMAIN ?? '';
const PARENT_COOKIE_SECURE =
  (process.env.PARENT_COOKIE_SECURE ?? 'true') === 'true';
const PARENT_COOKIE_SAMESITE = (process.env.PARENT_COOKIE_SAMESITE ?? 'lax') as
  | 'lax'
  | 'strict'
  | 'none';

const ACCESS_MAX_AGE = 60 * 15; // 15 min — auth-web 쿠키 정책과 동일

export async function POST(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value ?? '';
  const refreshToken = request.cookies.get('refreshToken')?.value ?? '';

  if (!refreshToken) {
    return NextResponse.json(
      { error: 'No refresh token' },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${USER_SERVICE_BASE_URL}/auth/restore-token`, {
    method: 'POST',
    headers: {
      Cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
    },
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const newAccessToken: string = data?.data?.accessToken ?? '';

  const response = NextResponse.json(
    { data: { accessToken: newAccessToken } },
    { status: 200 },
  );

  if (newAccessToken) {
    response.cookies.set('accessToken', newAccessToken, {
      httpOnly: true,
      secure: PARENT_COOKIE_SECURE,
      sameSite: PARENT_COOKIE_SAMESITE,
      domain: PARENT_COOKIE_DOMAIN || undefined,
      path: '/',
      maxAge: ACCESS_MAX_AGE,
    });
  }

  return response;
}
