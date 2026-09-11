import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';

// confirmPurchaseWorkflow 는 실제 캡처를 수행하므로 모킹한다. route 의 가드만 검증한다.
jest.mock('@workflows/orders/workflows/confirm-purchase-workflow', () => ({
  confirmPurchaseWorkflow: jest.fn(() => ({
    run: jest.fn().mockResolvedValue({ errors: [] }),
  })),
}));

import { POST } from '../confirm-purchase/route';
import { confirmPurchaseWorkflow } from '@workflows/orders/workflows/confirm-purchase-workflow';
import { ELIGIBILITY_ISSUED_METADATA_KEY } from '../../../../../scripts/lib/auto-review-eligibility';

type Order = Record<string, any>;

function makeReq(order: Order | undefined, customerId: string | undefined = 'cust_1') {
  const graph = jest.fn(async () => ({ data: order ? [order] : [] }));
  return {
    params: { id: order?.id ?? 'order_1' },
    auth_context: customerId ? { actor_id: customerId } : undefined,
    // ContainerRegistrationKeys.QUERY 키로만 query 를 내려준다.
    scope: {
      resolve: jest.fn((key: string) =>
        key === ContainerRegistrationKeys.QUERY ? { graph } : undefined,
      ),
    },
    _graph: graph,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const AWAITING_META = { bank_transfer_status: 'awaiting_deposit' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /store/orders/:id/confirm-purchase — 무통장 입금확인중 구매확정 가드', () => {
  it('awaiting_deposit + 미캡처 결제가 있으면 NOT_ALLOWED 로 거부하고 캡처 워크플로우를 실행하지 않는다', async () => {
    const order = {
      id: 'order_awaiting',
      customer_id: 'cust_1',
      metadata: AWAITING_META,
      items: [],
      payment_collections: [{ id: 'pc_1', payments: [{ id: 'pay_1', captures: [] }] }],
    };
    const req = makeReq(order);
    const res = makeRes();

    await expect(POST(req, res)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    });

    expect(confirmPurchaseWorkflow).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('awaiting_deposit 라도 모든 결제가 캡처됐으면(stale marker) 통과시킨다', async () => {
    const order = {
      id: 'order_captured',
      customer_id: 'cust_1',
      metadata: AWAITING_META,
      items: [],
      payment_collections: [
        { id: 'pc_1', payments: [{ id: 'pay_1', captures: [{ id: 'cap_1' }] }] },
      ],
    };
    const req = makeReq(order);
    const res = makeRes();

    await POST(req, res);

    expect(confirmPurchaseWorkflow).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        order: expect.objectContaining({ payment_status: 'captured' }),
      }),
    );
  });
});

describe('POST /store/orders/:id/confirm-purchase — 수동 확정 주문의 발급 표식', () => {
  /**
   * 표식이 없으면 자동 발급 잡이 이미 확정된 주문을 매 틱 다시 집어 ugc 로 왕복한다.
   * 잡의 `issueOne` 과 «같은» 키·같은 조건(생성됐을 때만)이어야 한다.
   */
  function makeReqWithOrderModule(order: Order, eligibility: unknown, updateOrders = jest.fn()) {
    const graph = jest.fn(async () => ({ data: [order] }));
    (confirmPurchaseWorkflow as unknown as jest.Mock).mockReturnValue({
      run: jest.fn().mockResolvedValue({ errors: [], result: { capturedIds: [], eligibility } }),
    });
    const req = {
      params: { id: order.id },
      auth_context: { actor_id: 'cust_1' },
      scope: {
        resolve: jest.fn((key: string) => {
          if (key === ContainerRegistrationKeys.QUERY) return { graph };
          if (key === Modules.ORDER) return { updateOrders };
          return undefined;
        }),
      },
    } as any;
    return { req, updateOrders };
  }

  const baseOrder = {
    id: 'order_manual',
    customer_id: 'cust_1',
    metadata: {},
    items: [],
    payment_collections: [{ id: 'pc_1', payments: [{ id: 'pay_1', captures: [{ id: 'cap_1' }] }] }],
  };

  it('자격이 실제로 생겼으면 잡과 같은 키로 표식을 남긴다', async () => {
    const { req, updateOrders } = makeReqWithOrderModule(baseOrder, {
      status: 'created',
      orderId: 'order_manual',
      almondUserId: 'u1',
      itemCount: 1,
    });

    await POST(req, makeRes());
    await new Promise((r) => setImmediate(r));

    expect(updateOrders).toHaveBeenCalledWith([
      {
        id: 'order_manual',
        metadata: { [ELIGIBILITY_ISSUED_METADATA_KEY]: expect.any(String) },
      },
    ]);
  });

  it('자격이 안 생겼으면(skipped) 표식을 남기지 않는다 — 남기면 그 주문은 영영 자격을 못 받는다', async () => {
    const { req, updateOrders } = makeReqWithOrderModule(baseOrder, {
      status: 'skipped',
      orderId: 'order_manual',
      reason: 'no_pim_backed_items',
    });

    await POST(req, makeRes());
    await new Promise((r) => setImmediate(r));

    expect(updateOrders).not.toHaveBeenCalled();
  });

  it('표식 기록이 실패해도 구매확정은 성공한다 — 결제는 이미 끝났다', async () => {
    const updateOrders = jest.fn().mockRejectedValue(new Error('boom'));
    const { req } = makeReqWithOrderModule(
      baseOrder,
      { status: 'created', orderId: 'order_manual', almondUserId: 'u1', itemCount: 1 },
      updateOrders,
    );
    const res = makeRes();

    await POST(req, res);
    await new Promise((r) => setImmediate(r));

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
