import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';

// confirmPurchaseWorkflow 는 실제 캡처를 수행하므로 모킹한다. route 의 가드만 검증한다.
jest.mock('@workflows/orders/workflows/confirm-purchase-workflow', () => ({
  confirmPurchaseWorkflow: jest.fn(() => ({
    run: jest.fn().mockResolvedValue({ errors: [] }),
  })),
}));

import { POST } from '../confirm-purchase/route';
import { confirmPurchaseWorkflow } from '@workflows/orders/workflows/confirm-purchase-workflow';

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
