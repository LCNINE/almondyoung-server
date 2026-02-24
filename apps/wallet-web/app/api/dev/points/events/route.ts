import { NextRequest, NextResponse } from 'next/server';

const WALLET_API_URL = process.env.WALLET_API_URL ?? 'http://localhost:3100';
const WALLET_API_KEY = process.env.WALLET_API_KEY ?? '';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const userId = params.get('user_id') ?? '';
  const limit = params.get('limit') ?? '20';

  const url = `${WALLET_API_URL}/v1/admin/points/events?user_id=${encodeURIComponent(userId)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${WALLET_API_KEY}` },
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
