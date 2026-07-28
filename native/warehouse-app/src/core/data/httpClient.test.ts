import { describe, it, expect, vi } from 'vitest';
import { ConflictError, createApiClient } from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('attaches bearer auth + idempotency-key and returns parsed JSON', async () => {
    const doFetch = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () => jsonResponse(200, { ok: true }));
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    const out = await client.request<{ ok: boolean }>({
      method: 'POST',
      path: '/inventory/adjust',
      body: { qty: 1 },
      idempotencyKey: 'idem-1',
    });
    expect(out).toEqual({ ok: true });
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe('https://api.test/inventory/adjust');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOK',
      'idempotency-key': 'idem-1',
    });
  });

  it('retries once on 409 then throws with a conflict error', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { message: 'version conflict' }))
      .mockResolvedValueOnce(
        jsonResponse(409, { message: 'version conflict' })
      );
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    await expect(
      client.request({ path: '/x', idempotencyKey: 'k' })
    ).rejects.toThrow(/conflict/i);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  // GlobalExceptionFilter 는 `{ success:false, error: <domain code>, message }` 를 응답 바디로
  // 낸다. errorMessage(context) 가 SKU_NOT_IN_SHIPMENT·OVERSCAN 등을 구분하려면 ConflictError
  // 가 그 `error` 코드를 들고 있어야 한다 — 지금까지는 message 만 살아남고 코드는 버려졌다.
  it('carries the server error code on a persisting 409', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(409, {
          success: false,
          error: 'SIMPLE_OUTBOUND_OVERSCAN',
          message: 'Scan exceeds the remaining allocated quantity for this SKU by 1',
        })
      );
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });

    const error: unknown = await client
      .request({ path: '/x', idempotencyKey: 'k' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('SIMPLE_OUTBOUND_OVERSCAN');
    expect((error as ConflictError).message).toBe(
      'Scan exceeds the remaining allocated quantity for this SKU by 1'
    );
  });
});
