import { fetchWithAuthBounce } from './fetch-with-refresh';

const BASE_URL = process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';

function paymentIntentRoute(intentId: string, action: 'confirm' | 'cancel'): string {
  return `/api/payment-intents/${encodeURIComponent(intentId)}/${action}`;
}

export interface PaymentIntent {
  id: string;
  payableAmount: number;
  currency: string;
  status: string;
  userId: string;
  returnUrl: string | null;
  expiresAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaymentMethod {
  id: string;
  type: string;
  displayName: string;
  isReusable: boolean;
}

export interface AvailablePaymentMethod {
  code: string;
  displayName: string;
  description: string | null;
  sortOrder: number;
}

export interface ConfirmResult {
  id: string;
  status: string;
  returnUrl: string | null;
  nextAction?: Record<string, unknown>;
}

export interface PointsBalance {
  confirmed: number;
  reserved: number;
  available: number;
}

export interface BillingMethod {
  id: string;
  userId: string;
  providerType: string;
  displayName: string | null;
  method: Record<string, unknown> | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface BillingAgreement {
  id: string;
  userId: string;
  billingMethodId: string;
  subscriberRef: string;
  subscriberType: string;
  status: string;
  createdAt: string;
}

/**
 * cookieHeader: Next.js 서버 컴포넌트에서 호출 시 `cookies().toString()` 값을 전달.
 * 브라우저 클라이언트에서 호출 시 생략하면 credentials: 'include' 사용.
 */
export async function getPaymentIntent(intentId: string, cookieHeader?: string): Promise<PaymentIntent> {
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

/**
 * 리전(소문자 alpha-2)에서 사용 가능한 결제수단 카탈로그를 조회한다.
 * storefront 가 전달한 region 으로 어떤 결제수단을 제시할지 결정하는 데 쓴다.
 */
export async function getAvailablePaymentMethods(
  region: string,
  cookieHeader?: string,
): Promise<AvailablePaymentMethod[]> {
  const code = region.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return [];

  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(`${BASE_URL}/v1/regions/${code}/payment-methods`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to load available payment methods (${res.status})`);
  }
  return res.json();
}

export async function getPointsBalance(cookieHeader?: string): Promise<PointsBalance> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(`${BASE_URL}/v1/points/balance`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to load points balance (${res.status})`);
  }
  return res.json();
}

export async function confirmPaymentIntent(
  intentId: string,
  paymentMethodId: string | null,
  pointsToApply?: number,
): Promise<ConfirmResult> {
  const res = await fetchWithAuthBounce(paymentIntentRoute(intentId, 'confirm'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'include',
    body: JSON.stringify({ paymentMethodId, pointsToApply }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Payment failed (${res.status})`);
  }
  return res.json();
}

export async function approveToss(
  intentId: string,
  paymentKey: string,
  orderId: string,
  amount: number,
): Promise<{ status: string; returnUrl: string | null; metadata?: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/toss-approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WALLET_API_KEY ?? ''}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Toss approve failed (${res.status})`);
  }
  return res.json();
}

export interface CmsBankAccountPayload {
  paymentCompany: string;
  payerName: string;
  payerNumber: string;
  paymentNumber: string;
  phone: string;
}

export async function registerCmsBankAccount(dto: CmsBankAccountPayload, cookieHeader: string): Promise<BillingMethod> {
  const res = await fetch(`${BASE_URL}/v1/billing-methods/cms/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(dto),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `CMS 빌링 등록 실패 (${res.status})`);
  }
  return res.json();
}

export async function updateCmsBankAccount(
  billingMethodId: string,
  dto: CmsBankAccountPayload,
  cookieHeader: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/billing-methods/cms/${billingMethodId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(dto),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `CMS 빌링 수단 변경 실패 (${res.status})`);
  }
}

export async function approveNicepay(
  intentId: string,
  tid: string,
  orderId: string,
  amount: number,
  authToken: string,
  clientId: string,
  signature: string,
): Promise<{ status: string; returnUrl: string | null; metadata?: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/v1/payment-intents/${intentId}/nicepay-approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WALLET_API_KEY ?? ''}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ tid, orderId, amount, authToken, clientId, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `NicePay approve failed (${res.status})`);
  }
  return res.json();
}

export async function issueNicepayBillingKey(
  encData: string,
  orderId: string,
  cookieHeader: string,
  encMode?: string,
): Promise<{ id: string }> {
  const payload: Record<string, string> = { encData, orderId };
  if (encMode) payload['encMode'] = encMode;
  const res = await fetch(`${BASE_URL}/v1/billing-methods/nicepay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `NicePay billing key issuance failed (${res.status})`);
  }
  return res.json();
}

export async function issueTossBillingKey(
  authKey: string,
  customerKey: string,
  cookieHeader: string,
): Promise<{ id: string }> {
  const res = await fetch(`${BASE_URL}/v1/billing-methods/toss`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ authKey, customerKey }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Toss billing key issuance failed (${res.status})`);
  }
  return res.json();
}

export async function getBillingMethods(cookieHeader?: string): Promise<BillingMethod[]> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(`${BASE_URL}/v1/billing-methods`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getBillingAgreements(cookieHeader?: string): Promise<BillingAgreement[]> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  const res = await fetch(`${BASE_URL}/v1/billing-agreements`, {
    headers,
    credentials: cookieHeader ? undefined : 'include',
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export async function updateBillingAgreementMethod(
  agreementId: string,
  billingMethodId: string,
  cookieHeader: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/billing-agreements/${agreementId}/billing-method`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ billingMethodId }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to update billing agreement (${res.status})`);
  }
}

export async function cancelPaymentIntent(intentId: string): Promise<void> {
  const res = await fetchWithAuthBounce(paymentIntentRoute(intentId, 'cancel'), {
    method: 'POST',
    headers: {
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Cancel failed (${res.status})`);
  }
}
