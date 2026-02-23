import { NextRequest, NextResponse } from 'next/server';

const WALLET_API_URL = process.env.WALLET_API_URL ?? 'http://localhost:3100';
const WALLET_API_KEY = process.env.WALLET_API_KEY ?? '';

export async function GET(req: NextRequest) {
  const externalUserId = req.nextUrl.searchParams.get('external_user_id') ?? '';

  const res = await fetch(
    `${WALLET_API_URL}/v1/admin/points/balance?external_user_id=${encodeURIComponent(externalUserId)}`,
    {
      headers: { Authorization: `Bearer ${WALLET_API_KEY}` },
      cache: 'no-store',
    },
  );

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
