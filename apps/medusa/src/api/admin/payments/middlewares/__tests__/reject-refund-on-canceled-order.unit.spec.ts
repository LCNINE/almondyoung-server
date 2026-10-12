import { rejectRefundOnCanceledOrder, REFUND_ON_CANCELED_ORDER_CODE } from '../reject-refund-on-canceled-order';

function makeReq(opts: { payment?: { id: string; payment_collection_id: string } | null; orderStatus?: string | null }) {
  const paymentModule = { listPayments: jest.fn(async () => (opts.payment ? [opts.payment] : [])) };
  const query = {
    graph: jest.fn(async () => ({ data: opts.orderStatus === undefined ? [] : [{ order: opts.orderStatus === null ? null : { id: 'order_1', status: opts.orderStatus } }] })),
  };
  return {
    params: { id: 'pay_1' },
    scope: { resolve: jest.fn((key: string) => (key === 'query' ? query : paymentModule)) },
    _query: query,
  } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const PAYMENT = { id: 'pay_1', payment_collection_id: 'paycol_1' };

describe('rejectRefundOnCanceledOrder — 취소된 주문의 기본 환불 막기(#1016 36번 §6.6)', () => {
  it('주문이 취소됐으면 400 — 돈이 나간 뒤 크레딧 라인 단계에서 실패한다(스펙 §2.2)', async () => {
    const res = makeRes();
    const next = jest.fn();
    const req = makeReq({ payment: PAYMENT, orderStatus: 'canceled' });
    await rejectRefundOnCanceledOrder(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_allowed', code: REFUND_ON_CANCELED_ORDER_CODE }));
    expect(req._query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'order_payment_collection', filters: { payment_collection_id: 'paycol_1' } }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['살아 있는 주문', { payment: PAYMENT, orderStatus: 'pending' }],
    ['주문 링크 없음', { payment: PAYMENT }],
    ['결제 없음 — 라우트가 404', { payment: null }],
  ])('%s 이면 통과', async (_label, opts) => {
    const res = makeRes();
    const next = jest.fn();
    await rejectRefundOnCanceledOrder(makeReq(opts as never), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
