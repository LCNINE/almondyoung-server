import { NextRequest, NextResponse } from 'next/server';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES } from '@/lib/auth/session-cookies';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const origin = selfOrigin() ?? request.nextUrl.origin;
  if (![origin, request.nextUrl.origin].includes(request.headers.get('origin') ?? '')) {
    return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  }
  const token = request.cookies.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(token))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const intentId = body && typeof body === 'object' && 'intentId' in body ? body.intentId : null;
  if (typeof intentId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(intentId)) {
    return NextResponse.json({ error: 'INVALID_INTENT_ID' }, { status: 400 });
  }
  const redirectUrl = `${origin}/api/toss/brandpay/authorize`;
  const response = NextResponse.json({ redirectUrl }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set('wallet_brandpay_intent', intentId, {
    httpOnly: true,
    secure: new URL(origin).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/toss/brandpay/authorize',
    maxAge: 3600,
  });
  return response;
}
