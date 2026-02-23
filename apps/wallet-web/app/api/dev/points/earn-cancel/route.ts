import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const WALLET_API_URL = process.env.WALLET_API_URL ?? 'http://localhost:3100';
const WALLET_API_KEY = process.env.WALLET_API_KEY ?? '';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetch(`${WALLET_API_URL}/v1/admin/points/earn-cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WALLET_API_KEY}`,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
