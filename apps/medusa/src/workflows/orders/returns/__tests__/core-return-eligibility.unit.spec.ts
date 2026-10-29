import { CoreEligibilityUnavailable, fetchCoreReturnEligibility } from '../core-return-eligibility';

const okBody = {
  found: true,
  lines: [{ channelOrderItemId: 'item_1', deliveredUnits: 2, lastDeliveredAt: '2026-10-20T15:30:00.000Z' }],
};

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('fetchCoreReturnEligibility', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.CORE_SERVICE_URL = 'http://core.test';
    process.env.CORE_INTERNAL_KEY = 'k';
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.CORE_SERVICE_URL;
    delete process.env.CORE_INTERNAL_KEY;
  });

  it('200 정상 → 날짜가 Date, 요청 본문·Bearer 헤더 확인', async () => {
    fetchMock.mockResolvedValue(respond(200, okBody));
    const r = await fetchCoreReturnEligibility('order_1');
    expect(r.found).toBe(true);
    expect(r.lines[0].lastDeliveredAt).toEqual(new Date('2026-10-20T15:30:00.000Z'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://core.test/internal/sales-orders/return-eligibility');
    expect(JSON.parse(init.body)).toEqual({ salesChannel: 'medusa', externalOrderId: 'order_1' });
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('customerReturns 를 그대로 싣고, 칸이 없는 옛 core 응답은 []', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { ...okBody, customerReturns: [{ channelReturnId: 'ret_1', status: 'arrived' }] }),
    );
    expect((await fetchCoreReturnEligibility('o')).customerReturns).toEqual([
      { channelReturnId: 'ret_1', status: 'arrived', kind: 'return', exchangeReleased: false },
    ]);
    fetchMock.mockResolvedValue(respond(200, okBody));
    expect((await fetchCoreReturnEligibility('o')).customerReturns).toEqual([]);
  });

  it('kind·exchangeReleased 를 싣고, 없는 옛 응답은 return·false', async () => {
    fetchMock.mockResolvedValue(
      respond(200, {
        ...okBody,
        customerReturns: [{ channelReturnId: 'ret_x', status: 'expected', kind: 'exchange', exchangeReleased: true }],
      }),
    );
    expect((await fetchCoreReturnEligibility('o')).customerReturns).toEqual([
      { channelReturnId: 'ret_x', status: 'expected', kind: 'exchange', exchangeReleased: true },
    ]);
  });

  it.each([
    ["exchangeReleased 'yes'", { exchangeReleased: 'yes' }],
    ['알 수 없는 kind', { kind: 'swap' }],
  ])('%s → CoreEligibilityUnavailable', async (_n, extra) => {
    fetchMock.mockResolvedValue(
      respond(200, { ...okBody, customerReturns: [{ channelReturnId: 'r', status: 'expected', ...extra }] }),
    );
    await expect(fetchCoreReturnEligibility('o')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
  });

  it('customerReturns 모양이 틀리면 CoreEligibilityUnavailable', async () => {
    fetchMock.mockResolvedValue(respond(200, { ...okBody, customerReturns: [{ channelReturnId: 1, status: 'arrived' }] }));
    await expect(fetchCoreReturnEligibility('o')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
  });

  it('줄 exchangeable 을 그대로 싣고, 칸이 없는 옛 core 줄은 false(교환 안 됨 — 반품은 영향 없음, K8 PR11b N2)', async () => {
    fetchMock.mockResolvedValue(
      respond(200, {
        found: true,
        lines: [
          { channelOrderItemId: 'a', deliveredUnits: 1, lastDeliveredAt: null, exchangeable: true },
          { channelOrderItemId: 'b', deliveredUnits: 1, lastDeliveredAt: null, exchangeable: false },
          { channelOrderItemId: 'c', deliveredUnits: 1, lastDeliveredAt: null },
        ],
      }),
    );
    expect((await fetchCoreReturnEligibility('o')).lines.map((l) => l.exchangeable)).toEqual([true, false, false]);
  });

  it("줄 exchangeable 'yes' → CoreEligibilityUnavailable", async () => {
    fetchMock.mockResolvedValue(
      respond(200, {
        found: true,
        lines: [{ channelOrderItemId: 'a', deliveredUnits: 1, lastDeliveredAt: null, exchangeable: 'yes' }],
      }),
    );
    await expect(fetchCoreReturnEligibility('o')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
  });

  it('lastDeliveredAt null 은 null 로', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { found: true, lines: [{ channelOrderItemId: 'a', deliveredUnits: 0, lastDeliveredAt: null }] }),
    );
    expect((await fetchCoreReturnEligibility('o')).lines[0].lastDeliveredAt).toBeNull();
  });

  it.each([
    ['401', () => fetchMock.mockResolvedValue(respond(401, {}))],
    ['500', () => fetchMock.mockResolvedValue(respond(500, {}))],
    ['AbortError', () => fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'AbortError' }))],
    ['lines 가 배열 아님', () => fetchMock.mockResolvedValue(respond(200, { found: true, lines: 'x' }))],
    [
      'deliveredUnits 가 수 아님',
      () =>
        fetchMock.mockResolvedValue(
          respond(200, { found: true, lines: [{ channelOrderItemId: 'a', deliveredUnits: '2', lastDeliveredAt: null }] }),
        ),
    ],
    [
      '날짜 파싱 불가',
      () =>
        fetchMock.mockResolvedValue(
          respond(200, { found: true, lines: [{ channelOrderItemId: 'a', deliveredUnits: 1, lastDeliveredAt: 'zzz' }] }),
        ),
    ],
  ])('%s → CoreEligibilityUnavailable', async (_n, arrange) => {
    arrange();
    await expect(fetchCoreReturnEligibility('o')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
  });

  it('env 없음 → CoreEligibilityUnavailable, fetch 0회', async () => {
    delete process.env.CORE_INTERNAL_KEY;
    await expect(fetchCoreReturnEligibility('o')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
