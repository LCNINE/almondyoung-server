import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from './httpClient';

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
});
