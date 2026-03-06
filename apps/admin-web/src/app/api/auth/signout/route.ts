import { NextRequest, NextResponse } from 'next/server';

const USER_SERVICE_BASE_URL =
  process.env.USER_SERVICE_URL ?? 'http://localhost:3030';

const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? 'admin.almondyoung-next.com';

export async function POST(request: NextRequest) {
  const adminAccessToken = request.cookies.get('admin_access_token')?.value ?? '';
  const adminRefreshToken = request.cookies.get('admin_refresh_token')?.value ?? '';

  await fetch(`${USER_SERVICE_BASE_URL}/auth/signout`, {
    method: 'POST',
    headers: {
      Cookie: `accessToken=${adminAccessToken}; refreshToken=${adminRefreshToken}`,
    },
  }).catch(() => {
    // user-service 오류가 있어도 로컬 쿠키는 반드시 삭제
  });

  const response = NextResponse.json({ success: true });

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    domain: process.env.NODE_ENV === 'production' ? ADMIN_DOMAIN : undefined,
    path: '/',
    maxAge: 0,
  };

  response.cookies.set('admin_access_token', '', cookieOptions);
  response.cookies.set('admin_refresh_token', '', cookieOptions);

  return response;
}
