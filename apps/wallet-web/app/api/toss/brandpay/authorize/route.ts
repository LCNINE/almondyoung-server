import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { refreshTokens, type TokenSet } from '@/lib/auth/oidc-client';
import { SESSION_COOKIE_NAMES, backendAuthCookieFromToken, writeSessionCookies } from '@/lib/auth/session-cookies';

export const dynamic = 'force-dynamic';

const PENDING_COOKIE = 'wallet_brandpay_intent';

export async function GET(request: NextRequest) {
  const intentId = request.cookies.get(PENDING_COOKIE)?.value;
  const code = request.nextUrl.searchParams.get('code');
  const customerKey = request.nextUrl.searchParams.get('customerKey');
  if (process.env.NODE_ENV !== 'production') {
    console.info('[brandpay-authorize] callback received', {
      hasPendingIntent: Boolean(intentId),
      hasCode: Boolean(code),
      hasCustomerKey: Boolean(customerKey),
    });
  }
  let refreshed: TokenSet | null = null;
  const respond = (status: number, body: Record<string, unknown>) => {
    const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (refreshed) writeSessionCookies(response.cookies, refreshed);
    return response;
  };

  if (!intentId) {
    console.warn('[brandpay-authorize] pending intent cookie missing');
    return respond(400, { code: 'BRANDPAY_SESSION_EXPIRED', message: '결제 화면을 새로고침한 뒤 다시 등록해주세요.' });
  }

  let accessToken = request.cookies.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  const walletUrl = process.env.WALLET_API_URL ?? process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:5001';
  // SDK가 같은 일회용 code를 재전송해도 wallet의 성공 응답을 재사용한다.
  const authorizationIdempotencyKey = `brandpay-authorize:${createHash('sha256')
    .update(JSON.stringify([intentId, customerKey, code]))
    .digest('hex')}`;
  const authorize = (token: string | undefined) =>
    fetch(`${walletUrl}/v1/payment-intents/${encodeURIComponent(intentId)}/brandpay-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': authorizationIdempotencyKey,
        Cookie: backendAuthCookieFromToken(token),
      },
      body: JSON.stringify({ code, customerKey }),
      cache: 'no-store',
    });
  if (!code || !customerKey) {
    console.warn('[brandpay-authorize] authorization parameters missing', {
      hasCode: Boolean(code),
      hasCustomerKey: Boolean(customerKey),
    });
    return respond(400, { code: 'BRANDPAY_PARAMETERS_REQUIRED', message: '브랜드페이 인증 정보가 누락됐습니다.' });
  }

  try {
    let upstream = await authorize(accessToken);
    if (upstream.status === 401) {
      const refreshToken = request.cookies.get(SESSION_COOKIE_NAMES.REFRESH_TOKEN)?.value;
      if (refreshToken) {
        refreshed = await refreshTokens(refreshToken);
        accessToken = refreshed.accessToken;
        upstream = await authorize(accessToken);
      }
    }
    if (!upstream.ok) {
      const failure: unknown = await upstream.json().catch(() => null);
      const errorCode =
        failure && typeof failure === 'object' && 'error' in failure && typeof failure.error === 'string'
          ? failure.error
          : 'UNKNOWN';
      console.warn('[brandpay-authorize] wallet rejected token exchange', {
        status: upstream.status,
        errorCode,
        hasAccessCookie: Boolean(request.cookies.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value),
        hasRefreshCookie: Boolean(request.cookies.get(SESSION_COOKIE_NAMES.REFRESH_TOKEN)?.value),
      });
      return respond(upstream.status, { code: errorCode, message: '브랜드페이 인증을 완료하지 못했습니다.' });
    }
    if (process.env.NODE_ENV !== 'production') {
      console.info('[brandpay-authorize] token exchange succeeded', { status: upstream.status });
    }
    // 이전에는 토큰 발급 후 결제 페이지로 307 리다이렉트해 위젯이 다시 생성되면서 등록 흐름이 꼬였습니다.
    // 이제 200 JSON 응답을 반환해 기존 토스 SDK가 진행 중인 결제수단 등록을 이어가도록 합니다.
    return respond(200, { ok: true });
  } catch (error) {
    console.warn('[brandpay-authorize] callback failed', {
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
      hasAccessCookie: Boolean(request.cookies.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value),
      hasRefreshCookie: Boolean(request.cookies.get(SESSION_COOKIE_NAMES.REFRESH_TOKEN)?.value),
    });
    return respond(502, { code: 'BRANDPAY_AUTHORIZATION_FAILED', message: '브랜드페이 인증 요청에 실패했습니다.' });
  }
}
