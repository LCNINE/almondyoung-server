import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { confirmReturnReceiveWorkflow } from '@medusajs/medusa/core-flows';
import { loadOrderView, productShippingProfiles, type OrderView } from '../../settlement/load-order-view';
import { listOrderRefunds } from '../../settlement/order-payments';
import { refundOrderPayments } from '../../settlement/refund-order-payments';
import { settleOrderReturn } from '../settle-order-return';
import { readReturnSettlementRecord, type ReturnSettlementRecord } from '../return-settlement-record';
import { priorGroupFeesFor } from '../../partial-cancel/prior-group-fees';

jest.mock('@medusajs/medusa/core-flows', () => ({
  beginReceiveReturnWorkflow: jest.fn(() => ({ run: jest.fn() })),
  cancelReturnReceiveWorkflow: jest.fn(() => ({ run: jest.fn() })),
  confirmReturnReceiveWorkflow: jest.fn(() => ({ run: jest.fn() })),
  dismissItemReturnRequestWorkflow: jest.fn(() => ({ run: jest.fn() })),
  receiveItemReturnRequestWorkflow: jest.fn(() => ({ run: jest.fn() })),
}));
jest.mock('../../settlement/load-order-view');
jest.mock('../../settlement/order-payments', () => ({
  listOrderRefunds: jest.fn(),
  orderCancelLockKey: (id: string) => id,
}));
jest.mock('../../settlement/refund-order-payments');
jest.mock('../../settlement/wallet-refund-ledger', () => ({ reconcileOrderWalletRefunds: jest.fn() }));
jest.mock('../../settlement/order-edit-charge', () => ({
  ensureNoDanglingChange: jest.fn(),
  addSettlementCharge: jest.fn(),
}));
jest.mock('../../settlement/offset-credit-line', () => ({ offsetCreditLine: jest.fn() }));

function setup(prepaid = 0, externalRefund = 0) {
  const ret = {
    id: 'ret_1',
    order_id: 'order_1',
    status: 'requested',
    items: [{ item_id: 'item_1', quantity: 1 }],
    metadata: {
      almondReturn: {
        requestId: 'cr_1',
        requestHash: 'request_hash',
        requestedBy: 'customer',
        reasonValue: 'defective',
        feeBearer: 'seller',
        fulfillmentTopUp: [],
      },
    } as Record<string, unknown>,
  };
  const records: ReturnSettlementRecord[] = [];
  const orderModule = {
    listReturns: jest.fn(async () => [ret]),
    updateReturns: jest.fn(async (updates) => {
      ret.metadata = updates[0].data.metadata;
      records.push(readReturnSettlementRecord(ret.metadata)!);
    }),
  };
  const services = {
    [Modules.ORDER]: orderModule,
    [Modules.LOCKING]: { execute: (_key: string, fn: () => Promise<unknown>) => fn() },
    [ContainerRegistrationKeys.QUERY]: { graph: jest.fn(async () => ({ data: [{ returns: [] }] })) },
  };
  const container = { resolve: (key: string) => services[key] } as unknown as MedusaContainer;
  const before: OrderView = {
    id: 'order_1',
    status: 'pending',
    version: 1,
    metadata: {},
    pendingDifference: prepaid,
    postalCode: '04524',
    lines: [
      {
        id: 'item_1',
        productId: 'prod_1',
        quantity: 1,
        unitPrice: 4990,
        returnedQuantity: 0,
        fulfilledQuantity: 1,
        requiresShipping: true,
        adjustments: [],
      },
    ],
    shippingMethods: [
      {
        id: 'sm_1',
        shippingOptionId: 'so_1',
        amount: 2500,
        snapshot: { shippingProfileId: 'sp_1', shippingGroupCode: 'flat', policy: { type: 'flat', baseFee: 2500 } },
        isSettlementCharge: false,
        isReturnExchangeOrClaimShipping: false,
        hasAdjustments: false,
      },
    ],
  };
  const after: OrderView = {
    ...before,
    version: 2,
    pendingDifference: prepaid - 4990,
    lines: before.lines.map((line) => ({ ...line, returnedQuantity: 1 })),
  };
  jest.mocked(loadOrderView).mockResolvedValueOnce(before).mockResolvedValueOnce(before).mockResolvedValue(after);
  jest.mocked(productShippingProfiles).mockResolvedValue(new Map([['prod_1', 'sp_1']]));
  jest
    .mocked(listOrderRefunds)
    // 정산이 읽는 칸(amount·note)만 채운다
    .mockResolvedValue([
      ...(prepaid > 0 ? [{ amount: prepaid, note: 'return-prepay:cr_1' }] : []),
      ...(externalRefund > 0 ? [{ amount: externalRefund, note: 'wallet:external' }] : []),
    ] as unknown as Awaited<ReturnType<typeof listOrderRefunds>>);
  const input = {
    orderId: 'order_1',
    returnId: 'ret_1',
    requestId: 'cr_1',
    items: [{ itemId: 'item_1', received: 1, dismissed: 0 }],
    ...(externalRefund > 0 ? { alreadyRefundedAmount: externalRefund } : {}),
  };

  return { container, input, ret, records };
}

describe('판매자 전량 반품 정산', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [0, 0, 7490],
    [4990, 0, 2500],
    [2000, 1000, 4490],
  ])('선환불 %i·외부 환불 %i는 품목값에만 상계하고 %i원을 환불한다', async (prepaid, externalRefund, refundAmount) => {
    const { container, input, ret, records } = setup(prepaid, externalRefund);

    const result = await settleOrderReturn(container, input);

    expect(result.refundAmount).toBe(refundAmount);
    expect(refundOrderPayments).toHaveBeenCalledWith(container, expect.objectContaining({ amount: refundAmount }));
    expect(records.map((r) => r.stage)).toEqual(['received', 'charged', 'refunded']);
    for (const record of records) {
      expect(record).toMatchObject({
        owed: 4990,
        shippingRefund: 2500,
        refundAmount,
        groupFees: { sp_1: 0 },
        prepaidApplied: prepaid,
        externalRefundApplied: externalRefund,
      });
    }
    expect(priorGroupFeesFor([{ orderVersion: 1, groupFees: { sp_1: 2500 } }], records.slice(-1))).toEqual({ sp_1: 0 });
    expect(readReturnSettlementRecord(ret.metadata)).toEqual(records[2]);
  });

  it.each([
    [6000, 1490],
    [7490, 0],
  ])('외부 환불 %i이 품목값을 넘으면 넘는 몫은 배송비로 상계하고 %i원만 환불한다', async (externalRefund, refundAmount) => {
    const { container, input, records } = setup(0, externalRefund);

    const result = await settleOrderReturn(container, input);

    expect(result.refundAmount).toBe(refundAmount);
    expect(records.at(-1)).toMatchObject({
      owed: 4990,
      shippingRefund: 2500,
      refundAmount,
      externalRefundApplied: externalRefund,
    });
  });

  it('환불 재시도는 저장한 배송비 환불을 쓰고 완료 뒤에는 다시 환불하지 않는다', async () => {
    const { container, input, records } = setup(4990);
    jest.mocked(refundOrderPayments).mockRejectedValueOnce(new Error('일시 실패')).mockResolvedValue(undefined);

    await expect(settleOrderReturn(container, input)).rejects.toThrow('반품 환불이 끝나지 않았습니다');
    expect(records[1]).toMatchObject({ stage: 'charged', shippingRefund: 2500, refundAmount: 2500 });
    jest.mocked(loadOrderView).mockRejectedValue(new Error('재시도에서 다시 계산하면 안 된다'));

    expect((await settleOrderReturn(container, input)).refundAmount).toBe(2500);
    expect((await settleOrderReturn(container, input)).refundAmount).toBe(2500);
    expect(confirmReturnReceiveWorkflow).toHaveBeenCalledTimes(1);
    expect(refundOrderPayments).toHaveBeenCalledTimes(2);
    expect(jest.mocked(refundOrderPayments).mock.calls.map(([, value]) => value.amount)).toEqual([2500, 2500]);
  });
});
