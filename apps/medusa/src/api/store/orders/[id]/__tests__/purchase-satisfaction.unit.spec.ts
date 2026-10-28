import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { GET, PUT } from '../purchase-satisfaction/route';
import { StorePurchaseSatisfactionWrite } from '../purchase-satisfaction/validators';

const ORDER = {
  id: 'order_1',
  display_id: 42,
  customer_id: 'cust_1',
  customer: { metadata: { almond_user_id: '11111111-1111-4111-8111-111111111111' } },
};

function makeReq(order: Record<string, any> | undefined, actorId: string | null = 'cust_1', body?: any) {
  const graph = jest.fn(async () => ({ data: order ? [order] : [] }));
  return {
    params: { id: 'order_1' },
    body,
    auth_context: actorId ? { actor_id: actorId } : undefined,
    scope: { resolve: jest.fn((key: string) => (key === ContainerRegistrationKeys.QUERY ? { graph } : undefined)) },
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const ugcOk = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;

const SAVED = {
  id: 's1',
  orderId: 'order_1',
  orderDisplayId: 42,
  userId: 'u',
  rating: 3,
  reasons: ['PAYMENT_ERROR'],
  memo: '느려요',
  checkedAt: null,
  checkedBy: null,
  createdAt: 'x',
  updatedAt: 'y',
};

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  process.env.UGC_SERVICE_URL = 'http://ugc';
  process.env.UGC_INTERNAL_KEY = 'key';
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ugcOk(SAVED));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('/store/orders/:id/purchase-satisfaction', () => {
  it.each([
    ['GET', GET],
    ['PUT', PUT],
  ])('남의 주문이면 404 이고 ugc 를 부르지 않는다 (%s)', async (_n, handler) => {
    const res = makeRes();
    await handler(makeReq({ ...ORDER, customer_id: 'other' }, 'cust_1', { rating: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_found' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('없는 주문이나 actor 없음도 404', async () => {
    const res = makeRes();
    await GET(makeReq(undefined), res);
    await GET(makeReq(ORDER, null), makeRes());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('almond_user_id 가 없는 고객이면 404', async () => {
    const res = makeRes();
    await GET(makeReq({ ...ORDER, customer: { metadata: {} } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PUT 은 주문에서 꺼낸 userId 와 display_id 를 ugc 에 넘긴다', async () => {
    const res = makeRes();
    await PUT(
      makeReq(ORDER, 'cust_1', { rating: 3, reasons: ['PAYMENT_ERROR'], memo: '느려요', orderDisplayId: 999, userId: 'evil' }),
      res,
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://ugc/purchase-satisfactions/internal/orders/order_1');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer key');
    expect(JSON.parse(init.body)).toEqual({
      userId: ORDER.customer.metadata.almond_user_id,
      orderDisplayId: 42,
      rating: 3,
      reasons: ['PAYMENT_ERROR'],
      memo: '느려요',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ satisfaction: { rating: 3, reasons: ['PAYMENT_ERROR'], memo: '느려요' } });
  });

  it('ugc 가 실패하면 502', async () => {
    fetchSpy.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await PUT(makeReq(ORDER, 'cust_1', { rating: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'ugc_unavailable' }));
  });

  it('env 가 없으면 502', async () => {
    delete process.env.UGC_INTERNAL_KEY;
    const res = makeRes();
    await GET(makeReq(ORDER), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ugc 400 본문을 읽다 실패하면 502', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => Promise.reject(new Error('aborted')) } as any);
    const res = makeRes();
    await PUT(makeReq(ORDER, 'cust_1', { rating: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'ugc_unavailable' }));
  });

  it.each([
    ['문자열', 'bad Bearer key here'],
    ['배열', ['ok', 'Authorization: Bearer key']],
  ])('ugc 400 메시지(%s)에 내부 키가 있어도 응답에 싣지 않는다', async (_n, message) => {
    fetchSpy.mockResolvedValue(ugcOk({ message }, 400));
    const res = makeRes();
    await PUT(makeReq(ORDER, 'cust_1', { rating: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('key');
  });

  it('ugc 5xx 본문에 내부 키가 있어도 502 응답에 싣지 않는다', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'Bearer key' }) } as any);
    const res = makeRes();
    await GET(makeReq(ORDER), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('key');
  });

  it('GET 은 ugc 404 를 404 로 돌려준다', async () => {
    fetchSpy.mockResolvedValue(ugcOk({}, 404));
    const res = makeRes();
    await GET(makeReq(ORDER), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_found' }));
  });

  it('PUT 은 ugc 400 을 400 invalid_data 로 돌려준다', async () => {
    fetchSpy.mockResolvedValue(ugcOk({ message: '사유는 3점 이하만' }, 400));
    const res = makeRes();
    await PUT(makeReq(ORDER, 'cust_1', { rating: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ type: 'invalid_data', message: '사유는 3점 이하만' });
  });
});

describe('StorePurchaseSatisfactionWrite', () => {
  it('허용 모양만 통과하고 그 밖의 키는 거부한다', () => {
    expect(StorePurchaseSatisfactionWrite.safeParse({ rating: 3, reasons: ['OTHER'], memo: 'a' }).success).toBe(true);
    expect(StorePurchaseSatisfactionWrite.safeParse({ rating: 0 }).success).toBe(false);
    expect(StorePurchaseSatisfactionWrite.safeParse({ rating: 3, reasons: ['NOPE'] }).success).toBe(false);
    expect(StorePurchaseSatisfactionWrite.safeParse({ rating: 3, memo: 'a'.repeat(301) }).success).toBe(false);
    expect(StorePurchaseSatisfactionWrite.safeParse({ rating: 3, userId: 'x' }).success).toBe(false);
  });
});
