const BASE_URL = process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';

export interface PaymentIntent {
  id: string;
  payableAmount: number;
  currency: string;
  status: string;
  externalUserId: string;
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

export async function getPaymentIntent(
  intentId: string,
  clientSecret: string,
): Promise<PaymentIntent> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}`, {
    headers: { 'X-Client-Secret': clientSecret },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to load payment intent (${res.status})`);
  }
  return res.json();
}

export async function getPaymentMethods(
  externalUserId: string,
  clientSecret: string,
): Promise<PaymentMethod[]> {
  const url = `${BASE_URL}/v1/payment-methods?external_user_id=${encodeURIComponent(externalUserId)}`;
  const res = await fetch(url, {
    headers: { 'X-Client-Secret': clientSecret },
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
  clientSecret: string,
): Promise<ConfirmResult> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Secret': clientSecret,
    },
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
  clientSecret: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/cancel`, {
    method: 'POST',
    headers: { 'X-Client-Secret': clientSecret },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Cancel failed (${res.status})`);
  }
}
