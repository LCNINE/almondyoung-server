import { NextRequest, NextResponse } from 'next/server';

const WALLET_API_URL = process.env.WALLET_API_URL ?? 'http://localhost:3100';
const WALLET_API_KEY = process.env.WALLET_API_KEY ?? '';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? '';

  const res = await fetch(
    `${WALLET_API_URL}/v1/admin/points/balance?user_id=${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${WALLET_API_KEY}` },
      cache: 'no-store',
    },
  );

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
