import { fetchCoreSelfCancelable } from '../core-self-cancelable';

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('fetchCoreSelfCancelable', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.CORE_SERVICE_URL = 'http://core.test/';
    process.env.CORE_INTERNAL_KEY = 'k';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.CORE_SERVICE_URL;
    delete process.env.CORE_INTERNAL_KEY;
  });

  it('Core 가 고른 주문 id 를 돌려주고 요청 모양을 지킨다', async () => {
    fetchMock.mockResolvedValue(respond(200, { channelOrderIds: ['o1'] }));

    await expect(fetchCoreSelfCancelable('u1', ['o1', 'o2'])).resolves.toEqual(['o1']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://core.test/internal/sales-orders/self-cancelable');
    expect(JSON.parse(init.body)).toEqual({ customerId: 'u1', channelOrderIds: ['o1', 'o2'] });
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('빈 입력은 부르지 않는다', async () => {
    await expect(fetchCoreSelfCancelable('u1', [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('core unavailable returns not eligible', async () => {
    fetchMock.mockResolvedValueOnce(respond(500, {}));
    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(respond(200, { channelOrderIds: 'o1' }));
    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(respond(200, { channelOrderIds: ['o1', null] }));
    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual([]);

    delete process.env.CORE_INTERNAL_KEY;
    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual([]);
  });

  it('Core 가 입력에 없던 id 를 돌려줘도 입력 안의 것만 남긴다', async () => {
    fetchMock.mockResolvedValue(respond(200, { channelOrderIds: ['o1', 'other'] }));

    await expect(fetchCoreSelfCancelable('u1', ['o1'])).resolves.toEqual(['o1']);
  });
});
