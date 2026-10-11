import { fetchWalletRefunds } from '../wallet-refund-list';

describe('fetchWalletRefunds (#1048 목록 API)', () => {
  const originalFetch = global.fetch;
  const env = { base: process.env.WALLET_BASE_URL, key: process.env.WALLET_API_KEY };
  beforeEach(() => {
    process.env.WALLET_BASE_URL = 'http://wallet.test';
    process.env.WALLET_API_KEY = 'k';
  });
  // undefined 를 대입하면 문자열 'undefined' 가 남는다 — 원래 없던 키는 지운다
  const restore = (name: 'WALLET_BASE_URL' | 'WALLET_API_KEY', value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  afterEach(() => {
    global.fetch = originalFetch;
    restore('WALLET_BASE_URL', env.base);
    restore('WALLET_API_KEY', env.key);
  });
  const respond = (status: number, body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as any;
    return global.fetch as jest.Mock;
  };

  it('API 키로 GET 하고 판정에 쓰는 칸만 읽는다', async () => {
    const f = respond(200, [
      { id: 'wr1', chargeId: 'ch1', status: 'SUCCEEDED', amount: 3000, reasonCode: 'MEDUSA_REFUND', execution: 'AUTO', createdAt: '2026-10-11T00:00:00.000Z' },
      { id: 'wr2', chargeId: 'ch1', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'MANUAL', createdAt: '2026-10-11T00:00:01.000Z' },
    ]);
    await expect(fetchWalletRefunds('int 1')).resolves.toEqual([
      { id: 'wr1', status: 'SUCCEEDED', amount: 3000, reasonCode: 'MEDUSA_REFUND', execution: 'AUTO', createdAt: '2026-10-11T00:00:00.000Z' },
      { id: 'wr2', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'MANUAL', createdAt: '2026-10-11T00:00:01.000Z' },
    ]);
    expect(f).toHaveBeenCalledWith('http://wallet.test/v1/payment-intents/int%201/refunds', {
      method: 'GET',
      headers: { Authorization: 'Bearer k' },
      signal: expect.any(AbortSignal),
    });
  });

  it('execution 이 없거나 모르는 값이면 AUTO 로 읽는다 — PENDING 이면 «진행 중»으로 멈추는 안전한 쪽(D8)', async () => {
    respond(200, [
      { id: 'wr1', status: 'PENDING', amount: 1000, reasonCode: null, createdAt: '2026-10-11T00:00:00.000Z' },
      { id: 'wr2', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'manual', createdAt: '2026-10-11T00:00:01.000Z' },
    ]);
    const rows = await fetchWalletRefunds('i1');
    expect(rows.map((r) => r.execution)).toEqual(['AUTO', 'AUTO']);
  });

  it('응답이 늦으면 결제 잠금 만료 전에 끊는다 — 그 오류는 그대로 던진다(일시, 장부를 못 맞췄으니 환불하지 않는다)', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    global.fetch = jest.fn().mockRejectedValue(timeout) as any;
    await expect(fetchWalletRefunds('i1')).rejects.toBe(timeout);
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('2xx 가 아니면 던진다 — 장부를 못 맞췄으면 환불하지 않는다', async () => {
    respond(404, { error: 'INTENT_NOT_FOUND' });
    await expect(fetchWalletRefunds('i1')).rejects.toThrow(/HTTP 404/);
  });

  it.each([[{ rows: [] }], [[{ id: 'wr1', status: 'SUCCEEDED' }]]])('모양이 다르면 던진다(%p)', async (body) => {
    respond(200, body);
    await expect(fetchWalletRefunds('i1')).rejects.toThrow(/wallet 환불 목록/);
  });
});
