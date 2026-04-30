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

export async function POST(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value ?? '';
  const refreshToken = request.cookies.get('refreshToken')?.value ?? '';

  await fetch(`${USER_SERVICE_BASE_URL}/auth/signout`, {
    method: 'POST',
    headers: {
      Cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
    },
  }).catch(() => {
    // user-service 오류가 있어도 로컬 쿠키는 반드시 삭제
  });

  const response = NextResponse.json({ success: true });

  // 부모 도메인 쿠키 삭제 — auth-web과 동일 속성으로 만료
  const cookieOptions = {
    httpOnly: true,
    secure: PARENT_COOKIE_SECURE,
    sameSite: PARENT_COOKIE_SAMESITE,
    domain: PARENT_COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: 0,
  };

  response.cookies.set('accessToken', '', cookieOptions);
  response.cookies.set('refreshToken', '', cookieOptions);

  return response;
}
