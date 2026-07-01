import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAMES } from '@/lib/auth/session-cookies';

// 내 사업자번호 채우기(비어있을 때만)
export async function POST(request: Request): Promise<Response> {
  const base = process.env.OIDC_ISSUER_URL?.replace(/\/$/, '');
  const token = (await cookies()).get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!base || !token) return NextResponse.json({ saved: false });

  let businessNumber = '';
  try {
    const body = (await request.json()) as { businessNumber?: unknown };
    businessNumber = String(body?.businessNumber ?? '');
  } catch {
    return NextResponse.json({ saved: false });
  }

  try {
    const res = await fetch(`${base}/business-licenses/me/business-number`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ businessNumber }),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ saved: false });
    const data = (await res.json().catch(() => ({ saved: false }))) as { data?: { saved?: boolean }; saved?: boolean };

    return NextResponse.json({ saved: Boolean(data?.data?.saved ?? data?.saved) });
  } catch {
    return NextResponse.json({ saved: false });
  }
}
