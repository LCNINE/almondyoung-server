import { WalletRefundClient } from './wallet-refund.client';

function mockFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 400 ? 'Bad Request' : 'OK',
    json: jest.fn().mockResolvedValue(body),
  });
}

describe('WalletRefundClient — already_refunded 파싱', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, WALLET_BASE_URL: 'http://wallet', WALLET_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('body.error가 REFUND_AMOUNT_EXCEEDS_AVAILABLE이면 already_refunded', async () => {
    global.fetch = mockFetch(400, { error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: 'refund failed' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('already_refunded');
  });

  it('body.error가 REFUND_AMOUNT_EXCEEDS_TOTAL이면 already_refunded', async () => {
    global.fetch = mockFetch(400, { error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', message: 'no refundable amount' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('already_refunded');
  });

  it('body.errorCode 필드로 already_refunded 감지', async () => {
    global.fetch = mockFetch(400, { errorCode: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: 'refund failed' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('already_refunded');
  });

  it('body.message가 object이고 nested error로 already_refunded 감지', async () => {
    global.fetch = mockFetch(400, {
      message: { error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: 'nested' },
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('already_refunded');
  });

  it('message 문자열에 REFUND_AMOUNT_EXCEEDS_AVAILABLE 포함 시 already_refunded', async () => {
    global.fetch = mockFetch(400, {
      error: 'Bad Request',
      message: 'Refund amount (1000) exceeds REFUND_AMOUNT_EXCEEDS_AVAILABLE (0)',
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('already_refunded');
  });

  it('다른 400 에러는 failed로 처리', async () => {
    global.fetch = mockFetch(400, { error: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', -1, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    }
  });

  it('body가 null이면 errorCode를 HTTP_400으로 설정하고 failed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: jest.fn().mockRejectedValue(new Error('no json')),
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.errorCode).toBe('HTTP_400');
    }
  });

  it('성공 응답 → success', async () => {
    global.fetch = mockFetch(200, {
      intentId: 'intent-1',
      refunds: [{ id: 'r1', status: 'SUCCEEDED', amount: 1000, currency: 'KRW' }],
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('success');
  });

  it('WALLET_BASE_URL 미설정 시 wallet_unavailable', async () => {
    delete process.env.WALLET_BASE_URL;
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('wallet_unavailable');
  });

  it('4xx(비즈니스 거부)는 failed determinate=true', async () => {
    global.fetch = mockFetch(400, { error: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', -1, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.determinate).toBe(true);
  });

  it('5xx(서버 오류)는 failed determinate=false (불확정)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: jest.fn().mockResolvedValue({ error: 'UPSTREAM_DOWN', message: 'try later' }),
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.determinate).toBe(false);
  });

  it('409 IDEMPOTENCY_KEY_IN_FLIGHT 는 in_flight kind', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: jest.fn().mockResolvedValue({ error: 'IDEMPOTENCY_KEY_IN_FLIGHT', message: 'in progress' }),
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('in_flight');
  });
});

describe('WalletRefundClient.listRefundsByIntent — 수동 송금 여부(#1016 36번 재설계 §8.2)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WALLET_BASE_URL: 'http://wallet', WALLET_API_KEY: 'test-key' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('목록을 읽는다 — API 키, 시간 제한 신호를 건다', async () => {
    global.fetch = mockFetch(200, [
      { id: 'r1', chargeId: 'c1', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'MANUAL', createdAt: '2026-10-12T00:00:00.000Z' },
    ]);
    const list = await new WalletRefundClient().listRefundsByIntent('intent-1');
    expect(list).toEqual([{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 1000 }]);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://wallet/v1/payment-intents/intent-1/refunds');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.signal).toBeDefined();
  });

  it('실패 응답·네트워크 오류·설정 없음 → null(부르는 쪽이 «모름»으로 읽는다)', async () => {
    global.fetch = mockFetch(500, { error: 'X' });
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
    process.env = { ...OLD_ENV, WALLET_BASE_URL: '', WALLET_API_KEY: '' };
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
  });

  it('모양이 다른 원소가 하나라도 있으면 null(모름) — 조용히 버리지 않는다', async () => {
    global.fetch = mockFetch(200, [{ id: 'r1', status: 'PENDING' }, { id: 'r2', status: 'SUCCEEDED', execution: 'AUTO', amount: 10 }]);
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
  });
});

describe('WalletRefundClient — 환불 종류(kind)', () => {
  const OLD_ENV = process.env;
  const okBody = { intentId: 'intent-1', refunds: [] };

  beforeEach(() => {
    process.env = { ...OLD_ENV, WALLET_BASE_URL: 'http://wallet', WALLET_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('kind 를 요청 바디에 싣는다', async () => {
    global.fetch = mockFetch(200, okBody);
    await new WalletRefundClient().refundByIntent('intent-1', 1000, { kind: 'RETURN', correlationId: 'c1' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'RETURN' });
  });

  it('kind 가 없으면 바디에 kind 키가 없다', async () => {
    global.fetch = mockFetch(200, okBody);
    await new WalletRefundClient().refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).not.toHaveProperty('kind');
  });
});
