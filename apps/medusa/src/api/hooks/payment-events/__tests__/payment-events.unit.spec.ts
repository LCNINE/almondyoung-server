import {
  handleAwaitingDepositProjection,
  handleCancelProjection,
  handleCaptureProjection,
  handleRefundProjection,
} from '../route';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import { completeCartWorkflow, cancelOrderWorkflow, deleteLineItemsWorkflow } from '@medusajs/medusa/core-flows';

// Workflow imports are mocked so importing the route is cheap and we can assert
// they are NOT invoked on skip paths.
jest.mock('@medusajs/core-flows', () => ({ capturePaymentWorkflow: jest.fn() }));
jest.mock('@medusajs/medusa/core-flows', () => ({
  completeCartWorkflow: jest.fn(),
  cancelOrderWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
}));

type GraphArgs = { entity: string; fields?: string[]; filters?: Record<string, unknown> };
type GraphFn = (args: GraphArgs) => Promise<{ data: any[] }> | { data: any[] };

function makeScope(opts: {
  paymentModule?: Record<string, unknown>;
  orderModule?: Record<string, unknown>;
  cartModule?: Record<string, unknown>;
  graph?: GraphFn;
} = {}) {
  const paymentModule = {
    listPaymentSessions: jest.fn().mockResolvedValue([]),
    listPayments: jest.fn().mockResolvedValue([]),
    updatePayment: jest.fn(),
    ...opts.paymentModule,
  };
  const orderModule = {
    retrieveOrder: jest.fn().mockResolvedValue(null),
    updateOrders: jest.fn(),
    ...opts.orderModule,
  };
  const cartModule = {
    updateCarts: jest.fn(),
    ...opts.cartModule,
  };
  const query = {
    graph: jest.fn(opts.graph ?? (async () => ({ data: [] }))),
  };
  // Medusa container keys resolve to string tokens: Modules.PAYMENT='payment',
  // Modules.ORDER='order', Modules.CART='cart', ContainerRegistrationKeys.QUERY='query'.
  const scope = {
    resolve: jest.fn((key: string) => {
      if (key === 'order') return orderModule;
      if (key === 'cart') return cartModule;
      if (key === 'query') return query;
      return paymentModule;
    }),
  };
  return { scope, paymentModule, orderModule, cartModule, query };
}

function mockCancelOrder(result: { errors?: Array<{ error: unknown }> } = { errors: [] }) {
  const run = jest.fn().mockResolvedValue(result);
  (cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run });
  return run;
}

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

beforeEach(() => jest.clearAllMocks());

describe('handleCancelProjection', () => {
  it('비-Medusa intent(session 없음)는 throw 없이 skip 한다', async () => {
    const { scope, paymentModule } = makeScope({
      paymentModule: { listPaymentSessions: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      handleCancelProjection(scope as any, 'intent_non_medusa', 'msg_1', logger as any),
    ).resolves.toBeUndefined();

    expect(paymentModule.updatePayment).not.toHaveBeenCalled();
  });

  it('payment 있고 주문이 없으면 canceled_at 으로 표시한다 (회귀 가드)', async () => {
    const payment = { id: 'pay_1', canceled_at: null, captured_at: null, metadata: {} };
    const { scope, paymentModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1' }]),
        listPayments: jest.fn().mockResolvedValue([payment]),
      },
      // graph 기본값 {data:[]} → payment_collection 조회 빈 결과 → 주문 없음
    });

    await handleCancelProjection(scope as any, 'intent_medusa', 'msg_4', logger as any);

    expect(cancelOrderWorkflow).not.toHaveBeenCalled();
    expect(paymentModule.updatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay_1', canceled_at: expect.any(Date) }),
    );
  });

  it('미입금(미capture) 선생성 주문이 있으면 주문을 취소하고 payment 를 취소 표시한다', async () => {
    const payment = { id: 'pay_1', canceled_at: null, captured_at: null, metadata: {} };
    const runCancel = mockCancelOrder({ errors: [] });
    const graph: GraphFn = async ({ entity }) => {
      if (entity === 'payment_collection') return { data: [{ id: 'pc_1', cart: { id: 'cart_1' } }] };
      if (entity === 'order_cart') return { data: [{ cart_id: 'cart_1', order_id: 'order_1' }] };
      return { data: [] };
    };
    const { scope, paymentModule, orderModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
        listPayments: jest.fn().mockResolvedValue([payment]),
      },
      orderModule: { retrieveOrder: jest.fn().mockResolvedValue({ id: 'order_1', status: 'pending' }) },
      graph,
    });

    await handleCancelProjection(scope as any, 'intent_bt', 'msg_5', logger as any);

    expect(runCancel).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ order_id: 'order_1' }) }),
    );
    expect(paymentModule.updatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay_1', canceled_at: expect.any(Date) }),
    );
    expect(orderModule.retrieveOrder).toHaveBeenCalled();
  });

  it('주문 취소가 실패하면 throw 하고(재시도 가능) payment 는 취소 표시하지 않는다', async () => {
    const payment = { id: 'pay_1', canceled_at: null, captured_at: null, metadata: {} };
    mockCancelOrder({ errors: [{ error: new Error('boom') }] });
    const graph: GraphFn = async ({ entity }) => {
      if (entity === 'payment_collection') return { data: [{ id: 'pc_1', cart: { id: 'cart_1' } }] };
      if (entity === 'order_cart') return { data: [{ cart_id: 'cart_1', order_id: 'order_1' }] };
      return { data: [] };
    };
    const { scope, paymentModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
        listPayments: jest.fn().mockResolvedValue([payment]),
      },
      orderModule: { retrieveOrder: jest.fn().mockResolvedValue({ id: 'order_1', status: 'pending' }) },
      graph,
    });

    await expect(
      handleCancelProjection(scope as any, 'intent_bt', 'msg_6', logger as any),
    ).rejects.toThrow(/cancelOrderWorkflow failed/);

    expect(paymentModule.updatePayment).not.toHaveBeenCalled();
  });

  it('이미 capture(입금확정)된 주문은 취소하지 않는다', async () => {
    const payment = { id: 'pay_1', canceled_at: null, captured_at: new Date(), metadata: {} };
    const runCancel = mockCancelOrder({ errors: [] });
    const { scope } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1' }]),
        listPayments: jest.fn().mockResolvedValue([payment]),
      },
    });

    await handleCancelProjection(scope as any, 'intent_captured', 'msg_7', logger as any);

    expect(runCancel).not.toHaveBeenCalled();
  });
});

describe('handleAwaitingDepositProjection', () => {
  it('주문 생성(completeCartWorkflow) 전에 cart 에 awaiting_deposit marker 를 원자적으로 심는다', async () => {
    let orderCreated = false;
    const completeRun = jest.fn().mockImplementation(async () => {
      orderCreated = true;
      return { errors: [] };
    });
    (completeCartWorkflow as unknown as jest.Mock).mockReturnValue({ run: completeRun });
    const deleteRun = jest.fn().mockResolvedValue({ errors: [] });
    (deleteLineItemsWorkflow as unknown as jest.Mock).mockReturnValue({ run: deleteRun });

    const graph: GraphFn = async ({ entity, filters }) => {
      if (entity === 'payment_collection') {
        return {
          data: [
            {
              id: 'pc_1',
              cart: { id: 'cart_1', completed_at: null, metadata: { source_cart_id: 'src_1', source_line_item_ids: ['li_1'] } },
            },
          ],
        };
      }
      if (entity === 'order_cart') {
        return { data: orderCreated ? [{ cart_id: 'cart_1', order_id: 'order_1' }] : [] };
      }
      if (entity === 'cart') {
        const id = (filters as any)?.id;
        if (id === 'cart_1') return { data: [{ id: 'cart_1', metadata: { source_cart_id: 'src_1', source_line_item_ids: ['li_1'] } }] };
        if (id === 'src_1') return { data: [{ id: 'src_1', completed_at: null, items: [{ id: 'li_1' }] }] };
      }
      return { data: [] };
    };

    const { scope, cartModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
        listPayments: jest.fn().mockResolvedValue([]),
      },
      orderModule: {
        retrieveOrder: jest.fn().mockResolvedValue({
          id: 'order_1',
          payment_status: 'authorized',
          metadata: { bank_transfer_status: 'awaiting_deposit' },
        }),
      },
      graph,
    });

    await handleAwaitingDepositProjection(scope as any, 'intent_bt', 'msg_a', logger as any);

    // marker 가 cart.metadata 에 심긴다 (completeCartWorkflow 가 order 로 복사 → 원자적)
    expect(cartModule.updateCarts).toHaveBeenCalledWith(
      'cart_1',
      expect.objectContaining({
        metadata: expect.objectContaining({ bank_transfer_status: 'awaiting_deposit' }),
      }),
    );
    // 순서 보장: marker(updateCarts) → 주문 생성(completeCartWorkflow). marker 없는 authorized 주문 창 없음.
    expect((cartModule.updateCarts as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      completeRun.mock.invocationCallOrder[0],
    );
    // 원본 카트 정리도 실행 (구매한 라인 삭제)
    expect(deleteRun).toHaveBeenCalledWith(
      expect.objectContaining({ input: { cart_id: 'src_1', ids: ['li_1'] } }),
    );
  });

  it('이미 완료된 cart 의 기존 주문이 captured 면 awaiting_deposit marker 를 뒤늦게 심지 않는다', async () => {
    const completeRun = jest.fn().mockResolvedValue({ errors: [] });
    (completeCartWorkflow as unknown as jest.Mock).mockReturnValue({ run: completeRun });
    (deleteLineItemsWorkflow as unknown as jest.Mock).mockReturnValue({ run: jest.fn().mockResolvedValue({ errors: [] }) });

    const graph: GraphFn = async ({ entity, filters }) => {
      if (entity === 'payment_collection') {
        return { data: [{ id: 'pc_1', cart: { id: 'cart_1', completed_at: '2026-06-23T00:00:00Z', metadata: {} } }] };
      }
      if (entity === 'order_cart') return { data: [{ cart_id: 'cart_1', order_id: 'order_1' }] };
      if (entity === 'cart') {
        const id = (filters as any)?.id;
        if (id === 'cart_1') return { data: [{ id: 'cart_1', metadata: {} }] };
      }
      return { data: [] };
    };

    const { scope, cartModule, orderModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
      },
      orderModule: {
        retrieveOrder: jest.fn().mockResolvedValue({ id: 'order_1', payment_status: 'captured', metadata: {} }),
        updateOrders: jest.fn(),
      },
      graph,
    });

    await handleAwaitingDepositProjection(scope as any, 'intent_bt', 'msg_b', logger as any);

    expect(cartModule.updateCarts).not.toHaveBeenCalled();
    expect(orderModule.updateOrders).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('이미 완료된 cart 의 기존 주문이 uncaptured 면 awaiting_deposit marker 를 보수한다 (P1 회귀)', async () => {
    const completeRun = jest.fn().mockResolvedValue({ errors: [] });
    (completeCartWorkflow as unknown as jest.Mock).mockReturnValue({ run: completeRun });
    (deleteLineItemsWorkflow as unknown as jest.Mock).mockReturnValue({ run: jest.fn().mockResolvedValue({ errors: [] }) });

    const graph: GraphFn = async ({ entity, filters }) => {
      if (entity === 'payment_collection') {
        return { data: [{ id: 'pc_1', cart: { id: 'cart_1', completed_at: '2026-06-23T00:00:00Z', metadata: {} } }] };
      }
      if (entity === 'order_cart') return { data: [{ cart_id: 'cart_1', order_id: 'order_1' }] };
      if (entity === 'cart') {
        const id = (filters as any)?.id;
        if (id === 'cart_1') return { data: [{ id: 'cart_1', metadata: {} }] };
      }
      return { data: [] };
    };
    const updateOrders = jest.fn().mockResolvedValue(undefined);

    const { scope, cartModule } = makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
      },
      orderModule: {
        retrieveOrder: jest.fn().mockResolvedValue({ id: 'order_1', payment_status: 'authorized', metadata: {} }),
        updateOrders,
      },
      graph,
    });

    await handleAwaitingDepositProjection(scope as any, 'intent_bt', 'msg_completed_uncaptured', logger as any);

    expect(cartModule.updateCarts).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(updateOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'order_1',
        metadata: expect.objectContaining({ bank_transfer_status: 'awaiting_deposit' }),
      }),
    ]);
  });

  it('session 자체가 없으면(비-Medusa intent: 멤버십/빌링 무통장) throw 없이 skip 한다', async () => {
    // offline-wait 이벤트는 결제수단(무통장) 기준으로 발행되므로, Medusa 세션이 없는
    // 멤버십/빌링 무통장 intent 도 이 핸들러에 도달한다. capture/cancel/refund 핸들러처럼
    // terminal no-op(200) 으로 끝내야 무한 재시도/DLQ 를 피한다.
    const { scope, cartModule } = makeScope({
      paymentModule: { listPaymentSessions: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      handleAwaitingDepositProjection(scope as any, 'intent_non_medusa', 'msg_no_session', logger as any),
    ).resolves.toBeUndefined();

    expect(completeCartWorkflow).not.toHaveBeenCalled();
    expect(cartModule.updateCarts).not.toHaveBeenCalled();
    expect(deleteLineItemsWorkflow).not.toHaveBeenCalled();
  });
});

describe('handleCaptureProjection', () => {
  it('session 자체가 없으면 무통장 복구를 시도하지 않고 skip 한다', async () => {
    const { scope } = makeScope({
      paymentModule: { listPaymentSessions: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      handleCaptureProjection(scope as any, 'intent_non_medusa', 'msg_2', logger as any),
    ).resolves.toBeUndefined();

    expect(completeCartWorkflow).not.toHaveBeenCalled();
    expect(capturePaymentWorkflow).not.toHaveBeenCalled();
    expect(deleteLineItemsWorkflow).not.toHaveBeenCalled();
  });

  // 선생성된 무통장 주문의 입금확인 경로. capturePaymentWorkflow 는 order 행의 updated_at 을
  // 건드리지 않으므로(payment capture + order_transaction insert + order_summary update 뿐),
  // 'confirmed' metadata 갱신(updateOrders)이 capture 이후 order.updated_at 을 올리는 유일한
  // 쓰기다. 이 게 best-effort 로 삼켜지면 결제된 주문이 channel-adapter watermark 에 추월당해
  // 영영 수집되지 않을 수 있다 → 실패는 propagate 되어 hook 이 재시도해야 한다.
  function makeCaptureScope(updateOrders: jest.Mock) {
    (capturePaymentWorkflow as unknown as jest.Mock).mockReturnValue({
      run: jest.fn().mockResolvedValue({}),
    });
    const payment = { id: 'pay_1', captured_at: null, data: {} };
    const graph: GraphFn = async ({ entity, filters }) => {
      if (entity === 'payment_collection') return { data: [{ id: 'pc_1', cart: { id: 'cart_1' } }] };
      if (entity === 'order_cart') return { data: [{ cart_id: 'cart_1', order_id: 'order_1' }] };
      // cleanupSourceCartItems: checkout cart 에 source_cart_id 없음 → no-op
      if (entity === 'cart') return { data: [{ id: 'cart_1', metadata: {} }] };
      return { data: [] };
    };
    return makeScope({
      paymentModule: {
        listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1', payment_collection_id: 'pc_1' }]),
        listPayments: jest.fn().mockResolvedValue([payment]),
        updatePayment: jest.fn(),
      },
      orderModule: {
        retrieveOrder: jest.fn().mockResolvedValue({ id: 'order_1', metadata: { bank_transfer_status: 'awaiting_deposit' } }),
        updateOrders: updateOrders,
      },
      graph,
    });
  }

  it("입금확인(capture) 후 awaiting_deposit → confirmed 로 order.updated_at 을 bump 한다", async () => {
    const updateOrders = jest.fn().mockResolvedValue(undefined);
    const { scope } = makeCaptureScope(updateOrders);

    await handleCaptureProjection(scope as any, 'intent_bt', 'msg_cap', logger as any);

    expect(updateOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'order_1',
        metadata: expect.objectContaining({ bank_transfer_status: 'confirmed' }),
      }),
    ]);
  });

  it('confirmed metadata 갱신(updateOrders) 실패 시 throw 하여 hook 이 재시도하게 한다 (P2 회귀)', async () => {
    const updateOrders = jest.fn().mockRejectedValue(new Error('order metadata write failed'));
    const { scope } = makeCaptureScope(updateOrders);

    await expect(
      handleCaptureProjection(scope as any, 'intent_bt', 'msg_cap_fail', logger as any),
    ).rejects.toThrow(/order metadata write failed/);
  });
});

describe('handleRefundProjection', () => {
  it('Medusa payment 없으면 throw 없이 skip 한다', async () => {
    const { scope, paymentModule } = makeScope({
      paymentModule: { listPaymentSessions: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      handleRefundProjection(scope as any, 'intent_non_medusa', 1000, 'msg_3', undefined, logger as any),
    ).resolves.toBeUndefined();

    expect(paymentModule.updatePayment).not.toHaveBeenCalled();
  });
});
