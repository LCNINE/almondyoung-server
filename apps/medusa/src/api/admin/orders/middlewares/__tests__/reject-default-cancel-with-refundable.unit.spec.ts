import { rejectDefaultCancelWithRefundable, DEFAULT_CANCEL_BLOCKED_CODE } from '../reject-default-cancel-with-refundable';

jest.mock('../../../../../workflows/orders/settlement/order-payments', () => ({
  orderPaymentIds: jest.fn(),
}));
import { orderPaymentIds } from '../../../../../workflows/orders/settlement/order-payments';

type Payment = { canceled_at?: string | null; captures?: Array<{ amount: unknown }>; refunds?: Array<{ amount: unknown }> };

function makeReq(payments: Record<string, Payment>) {
  (orderPaymentIds as jest.Mock).mockResolvedValue(Object.keys(payments));
  const paymentModule = { retrievePayment: jest.fn(async (id: string) => ({ id, ...payments[id] })) };
  return {
    params: { id: 'order_1' },
    scope: { resolve: jest.fn(() => paymentModule) },
  } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('rejectDefaultCancelWithRefundable — 대시보드 기본 취소 막기(#1016 36번 §6.6)', () => {
  it('돌려줄 돈이 남은 결제가 있으면 400 — admin-web 에서 취소', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: 13000 }], refunds: [{ amount: 3000 }] } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_allowed', code: DEFAULT_CANCEL_BLOCKED_CODE }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['결제 없음', {}],
    ['전부 환불됨', { p1: { captures: [{ amount: 13000 }], refunds: [{ amount: 13000 }] } }],
    ['캡처 없음(미결제)', { p1: { captures: [], refunds: [] } }],
    ['취소된 결제', { p1: { canceled_at: '2026-10-12T00:00:00Z', captures: [{ amount: 13000 }] } }],
  ])('%s 이면 통과 — 기본 취소가 할 환불이 없다', async (_label, payments) => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq(payments as Record<string, Payment>), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('금액을 읽을 수 없으면 막는다 — 장부를 거짓으로 만드는 쪽이 더 비싸다(E6)', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: { weird: 1 } }], refunds: [] } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('BigNumber 모양 금액도 읽는다', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: { numeric_: 5000 } }], refunds: [{ amount: '5000' }] } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
