type PaymentIntentAction = 'confirm' | 'cancel';

function getWalletApiUrl(): string {
  return process.env.WALLET_API_URL ?? process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';
}

function buildHeaders(request: Request, includeBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Idempotency-Key': request.headers.get('Idempotency-Key') ?? crypto.randomUUID(),
  };
  const cookie = request.headers.get('Cookie');
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (includeBody) {
    headers['Content-Type'] = request.headers.get('Content-Type') ?? 'application/json';
  }
  return headers;
}

export async function proxyPaymentIntentAction(
  request: Request,
  intentId: string,
  action: PaymentIntentAction,
): Promise<Response> {
  const includeBody = action === 'confirm';
  const body = includeBody ? await request.text() : undefined;
  const upstream = await fetch(`${getWalletApiUrl()}/v1/payment-intents/${encodeURIComponent(intentId)}/${action}`, {
    method: 'POST',
    headers: buildHeaders(request, includeBody),
    body,
    cache: 'no-store',
  });
  const responseBody = await upstream.text();
  const headers = new Headers();
  const contentType = upstream.headers.get('Content-Type');

  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  return new Response(responseBody || null, {
    status: upstream.status,
    headers,
  });
}
