import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const WALLET_API_URL = process.env.WALLET_API_URL ?? 'http://localhost:3100';
const WALLET_API_KEY = process.env.WALLET_API_KEY ?? '';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userId, amount, currency = 'KRW', returnUrl } = body as {
    userId: string;
    amount: number;
    currency?: string;
    returnUrl?: string;
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${WALLET_API_KEY}`,
  };

  // 1. Get or create POINTS payment method (API-key authenticated, merchant backend call)
  const methodsRes = await fetch(
    `${WALLET_API_URL}/v1/payment-methods?user_id=${encodeURIComponent(userId)}`,
    { headers, cache: 'no-store' },
  );
  if (!methodsRes.ok) {
    const err = await methodsRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: methodsRes.status });
  }
  const methods: Array<{ id: string; type: string }> = await methodsRes.json();
  let pointsMethod = methods.find((m) => m.type === 'POINTS');

  if (!pointsMethod) {
    const createRes = await fetch(`${WALLET_API_URL}/v1/payment-methods`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ userId, type: 'POINTS' }),
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return NextResponse.json(err, { status: createRes.status });
    }
    pointsMethod = await createRes.json();
  }

  // 2. Create payment intent (merchant backend supplies userId in body)
  const intentRes = await fetch(`${WALLET_API_URL}/v1/payment-intents`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ userId, currency, amount, returnUrl }),
  });
  if (!intentRes.ok) {
    const err = await intentRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: intentRes.status });
  }
  const intent: { id: string; clientSecret: string } = await intentRes.json();

  return NextResponse.json({ intentId: intent.id, clientSecret: intent.clientSecret }, { status: 201 });
}
