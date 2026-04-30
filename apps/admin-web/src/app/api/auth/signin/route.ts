import { NextResponse } from 'next/server';

// signin은 auth-web에서만 처리되도록 일원화되었습니다.
// 기존 구현은 git history 또는 아래 주석으로 보존:
//
// const USER_SERVICE_BASE_URL = process.env.USER_SERVICE_URL ?? 'http://localhost:3030';
// const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? 'admin.almondyoung-next.com';
// const REMEMBER_ME_MAX_AGE = 90 * 24 * 60 * 60;
// const DEFAULT_MAX_AGE = 14 * 24 * 60 * 60;
//
// export async function POST(request: NextRequest) {
//   ...user-service /auth/signin 호출 + admin_access_token/refresh_token 쿠키 설정...
// }

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message:
        'admin-web /api/auth/signin은 deprecated 입니다. auth-web /signin 을 사용하세요.',
    },
    { status: 410 },
  );
}
