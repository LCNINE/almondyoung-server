import { normalizeGuidePromotions } from '@/lib/toss-installment-data';
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
      `${process.env.WALLET_API_URL ?? process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:5001'}/v1/payment-methods/toss-card-promotions`,
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
  const upstreamText = await upstream.text();
  let response: NextResponse;
  if (!upstream.ok) {
    response = new NextResponse(upstreamText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } else {
    const config = JSON.parse(upstreamText) as { url: string };
    let interestFreeCards: ReturnType<typeof normalizeGuidePromotions> = [];
    let source = 'UNAVAILABLE';
    try {
      const guideUrl = new URL(config.url);
      const key = guideUrl.searchParams.get('client-key');
      if (!key) throw new Error('Missing widget public key');
      const url = new URL('https://api.tosspayments.com/v3/payment-widget/promotions/NORMAL');
      url.searchParams.set('variantKey', guideUrl.searchParams.get('variant-key') ?? 'DEFAULT');
      // 공식 /free-installment 안내가 사용하는 공개 키 API. 일반결제 테스트 프로모션과 구분한다.
      const promotions = await fetch(url, {
        headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
        cache: 'no-store',
      });
      if (!promotions.ok) throw new Error('Widget promotion lookup failed');
      interestFreeCards = normalizeGuidePromotions(await promotions.json());
      source = 'TOSS_WIDGET_GUIDE';
    } catch {
      // 공급자 응답이 변경되거나 조회에 실패하면 무이자 표시를 생략하고 공식 안내 링크를 유지한다.
    }
    response = NextResponse.json(
      { url: config.url, source, interestFreeCards },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (refreshed) writeSessionCookies(response.cookies, refreshed);
  return response;
}
