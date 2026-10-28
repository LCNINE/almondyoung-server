import { CoreEligibilityUnavailable } from '../core-return-eligibility';
import { releaseCoreReturnPickup } from '../core-return-pickup';

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('releaseCoreReturnPickup', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.CORE_SERVICE_URL = 'http://core.test/';
    process.env.CORE_INTERNAL_KEY = 'k';
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.CORE_SERVICE_URL;
    delete process.env.CORE_INTERNAL_KEY;
  });

  it('200 released / picked_up 을 그대로 돌려주고, 경로·Bearer·본문을 확인한다', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { result: 'released' }));
    expect(await releaseCoreReturnPickup('ret_1')).toBe('released');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://core.test/internal/sales-orders/customer-return-pickup/release');
    expect(init.method).toBe('POST');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '')).toEqual({ channelReturnId: 'ret_1' });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer k');

    fetchMock.mockResolvedValueOnce(respond(200, { result: 'picked_up' }));
    expect(await releaseCoreReturnPickup('ret_1')).toBe('picked_up');
  });

  it('404(옛 core — 라우트 없음)는 released 로 읽는다', async () => {
    fetchMock.mockResolvedValue(respond(404, {}));
    expect(await releaseCoreReturnPickup('ret_1')).toBe('released');
  });

  it.each([
    ['409', () => fetchMock.mockResolvedValue(respond(409, {}))],
    ['502', () => fetchMock.mockResolvedValue(respond(502, {}))],
    ['모양 불일치', () => fetchMock.mockResolvedValue(respond(200, { result: 'x' }))],
    ['네트워크 오류', () => fetchMock.mockRejectedValue(new Error('ECONNRESET'))],
  ])('%s → CoreEligibilityUnavailable', async (_n, arrange) => {
    arrange();
    await expect(releaseCoreReturnPickup('ret_1')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
  });

  it('설정이 없으면 CoreEligibilityUnavailable', async () => {
    delete process.env.CORE_INTERNAL_KEY;
    await expect(releaseCoreReturnPickup('ret_1')).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
