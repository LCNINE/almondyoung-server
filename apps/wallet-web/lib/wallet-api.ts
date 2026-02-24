const BASE_URL = process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';

export interface PaymentIntent {
  id: string;
  payableAmount: number;
  currency: string;
  status: string;
  userId: string;
  returnUrl: string | null;
  expiresAt: string | null;
}

export interface PaymentMethod {
  id: string;
  type: string;
  displayName: string;
  isReusable: boolean;
}

export interface ConfirmResult {
  id: string;
  status: string;
  returnUrl: string | null;
}

/**
 * cookieHeader: Next.js 서버 컴포넌트에서 호출 시 `cookies().toString()` 값을 전달.
 * 브라우저 클라이언트에서 호출 시 생략하면 credentials: 'include' 사용.
 */
export async function getPaymentIntent(
  intentId: string,
  cookieHeader?: string,
): Promise<PaymentIntent> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to load payment intent (${res.status})`);
  }
  return res.json();
}

export async function getPaymentMethods(cookieHeader?: string): Promise<PaymentMethod[]> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(`${BASE_URL}/v1/payment-methods`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to load payment methods (${res.status})`);
  }
  return res.json();
}

export async function confirmPaymentIntent(
  intentId: string,
  paymentMethodId: string,
): Promise<ConfirmResult> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'include',   // sends JWT cookie
    body: JSON.stringify({ paymentMethodId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Payment failed (${res.status})`);
  }
  return res.json();
}

export async function cancelPaymentIntent(
  intentId: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/cancel`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'include',   // sends JWT cookie
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Cancel failed (${res.status})`);
  }
}
