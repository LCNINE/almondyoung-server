import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_BASE_URL =
  process.env.USER_SERVICE_URL ?? 'http://localhost:3030';

const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? 'admin.almondyoung-next.com';

const REMEMBER_ME_MAX_AGE = 90 * 24 * 60 * 60; // 90일
const DEFAULT_MAX_AGE = 14 * 24 * 60 * 60; // 2주

export async function POST(request: NextRequest) {
  const adminAccessToken =
    request.cookies.get('admin_access_token')?.value ?? '';
  const adminRefreshToken =
    request.cookies.get('admin_refresh_token')?.value ?? '';
  const rememberMe =
    request.cookies.get('admin_remember_me')?.value === '1';

  const upstream = await fetch(`${USER_SERVICE_BASE_URL}/auth/restore-token`, {
    method: 'POST',
    headers: {
      Cookie: `accessToken=${adminAccessToken}; refreshToken=${adminRefreshToken}`,
    },
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const newAccessToken: string = data?.data?.accessToken ?? '';

  const response = NextResponse.json(
    { data: { accessToken: newAccessToken } },
    { status: 200 }
  );

  if (newAccessToken) {
    response.cookies.set('admin_access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? ADMIN_DOMAIN : undefined,
      path: '/',
      maxAge: rememberMe ? REMEMBER_ME_MAX_AGE : DEFAULT_MAX_AGE,
    });
  }

  return response;
}
