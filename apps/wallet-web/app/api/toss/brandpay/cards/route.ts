import { NextResponse } from 'next/server';
import {
  getBackendAuthCookie,
  getRefreshToken,
  backendAuthCookieFromToken,
  writeSessionCookies,
} from '@/lib/auth/session-cookies';
import { refreshTokens, type TokenSet } from '@/lib/auth/oidc-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const callUpstream = (cookie: string) =>
    fetch(
      `${process.env.WALLET_API_URL ?? process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:5001'}/v1/payment-methods/toss-brandpay-cards`,
      {
        headers: { Cookie: cookie },
        cache: 'no-store',
      },
    );
  let upstream = await callUpstream(await getBackendAuthCookie());
  let refreshed: TokenSet | null = null;
  if (upstream.status === 401) {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try {
        refreshed = await refreshTokens(refreshToken);
        upstream = await callUpstream(backendAuthCookieFromToken(refreshed.accessToken));
      } catch {
        return NextResponse.json({ message: '다시 로그인해주세요.' }, { status: 401 });
      }
    }
  }
  const response = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (refreshed) writeSessionCookies(response.cookies, refreshed);
  return response;
}
