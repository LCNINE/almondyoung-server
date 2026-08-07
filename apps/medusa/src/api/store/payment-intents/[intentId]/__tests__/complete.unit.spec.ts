import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

// 실제 주문 생성/캡처는 돌리지 않는다. 라우트가 "언제 워크플로를 돌리고 언제 성공으로 응답하는지" 만 본다.
const runCompleteCart = jest.fn();
jest.mock('@medusajs/medusa/core-flows', () => ({
  completeCartWorkflow: jest.fn(() => ({ run: runCompleteCart })),
}));
jest.mock('@medusajs/core-flows', () => ({
  capturePaymentWorkflow: jest.fn(() => ({ run: jest.fn().mockResolvedValue({}) })),
}));
jest.mock('../../../carts/middlewares/reject-awaiting-deposit-complete', () => ({
  AWAITING_DEPOSIT_STATUS: 'AWAITING_DEPOSIT',
  fetchIntentStatus: jest.fn(async () => 'CAPTURED'),
}));

import { POST } from '../complete/route';

const INTENT = 'intent_1';
const CART = 'cart_1';
const PC = 'pay_col_1';

/**
 * @param completedAt   카트 완료 시각 (완료 안 됐으면 null)
 * @param orderId       order_cart 링크로 보이는 주문 (아직 안 보이면 null)
 * @param orderIdAfter  워크플로 실패 뒤 재조회에서 보이는 주문 (레이스 재현용)
 */
function makeReq(opts: { completedAt?: string | null; orderId?: string | null; orderIdAfter?: string | null }) {
  const { completedAt = null, orderId = null, orderIdAfter = null } = opts;
  let orderLookups = 0;

  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (entity === 'payment_collection') {
      return { data: [{ id: PC, cart: { id: CART, completed_at: completedAt } }] };
    }
    if (entity === 'order_cart') {
      orderLookups += 1;
      // 1회차 = 워크플로 실행 전, 2회차 = 실패 후 재조회
      const found = orderLookups === 1 ? orderId : (orderIdAfter ?? orderId);
      return { data: found ? [{ cart_id: CART, order_id: found }] : [] };
    }
    if (entity === 'cart') return { data: [{ id: CART, payment_collection: { payment_sessions: [] } }] };
    return { data: [] };
  });

  const req = {
    params: { intentId: INTENT },
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph };
        if (key === ContainerRegistrationKeys.LOGGER) return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        if (key === Modules.PAYMENT) {
          return {
            listPaymentSessions: jest.fn(async () => [{ id: 'payses_1', payment_collection_id: PC }]),
            listPayments: jest.fn(async () => []),
          };
        }
        return undefined;
      }),
    },
  } as any;
  return req;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  runCompleteCart.mockReset();
});

describe('POST /store/payment-intents/:intentId/complete — 이미 완료된 카트 멱등 처리', () => {
  it('주문이 이미 있으면 워크플로를 돌리지 않고 그 주문을 반환한다', async () => {
    const res = makeRes();
    await POST(makeReq({ orderId: 'order_1' }), res);

    expect(runCompleteCart).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'order', order_id: 'order_1' }));
  });

  it('카트가 이미 완료됐으면(링크는 아직 안 보여도) 워크플로를 재실행하지 않고 성공으로 응답한다', async () => {
    // 재실행하면 retrieveCart 가 비어 validate-cart-payments 가 터지고, 결제·주문이 정상인데도
    // 스토어프론트가 실패 페이지를 띄운다.
    const res = makeRes();
    await POST(makeReq({ completedAt: '2026-08-07T08:14:07.000Z', orderId: null }), res);

    expect(runCompleteCart).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'order' }));
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('워크플로가 실패해도 그 사이 다른 호출이 주문을 만들었으면 성공으로 응답한다', async () => {
    runCompleteCart.mockResolvedValue({ errors: [{ error: { message: 'Cart is already completed' } }] });

    const res = makeRes();
    await POST(makeReq({ orderId: null, orderIdAfter: 'order_raced' }), res);

    expect(runCompleteCart).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'order', order_id: 'order_raced' }));
  });

  it('워크플로가 실패하고 주문도 없으면 그대로 error 를 알린다', async () => {
    // 진짜 실패까지 성공으로 덮으면 결제만 되고 주문이 없는 상태를 놓친다.
    runCompleteCart.mockResolvedValue({ errors: [{ error: { message: 'Insufficient inventory' } }] });

    const res = makeRes();
    await POST(makeReq({ orderId: null, orderIdAfter: null }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', error: expect.objectContaining({ message: 'Insufficient inventory' }) }),
    );
  });

  it('미완료 카트는 정상적으로 워크플로를 돌려 주문을 만든다', async () => {
    runCompleteCart.mockResolvedValue({ errors: [], result: { id: 'order_new' } });

    const res = makeRes();
    await POST(makeReq({ completedAt: null, orderId: null }), res);

    expect(runCompleteCart).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'order', order_id: 'order_new' }));
  });
});
