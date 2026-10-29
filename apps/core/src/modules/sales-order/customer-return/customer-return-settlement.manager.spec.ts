import type { DbTx } from '../../inventory/schema/inventory.schema';
import type { ChannelReturnSettledPayload } from '@packages/event-contracts/streams/orders.stream';
import { CustomerReturnSettlementManager } from './customer-return-settlement.manager';

jest.mock('../common/claim-progress', () => ({ enqueueSalesOrderClaimProgress: jest.fn() }));
jest.mock('../common/sales-order-returned', () => ({ enqueueSalesOrderReturned: jest.fn() }));

describe('CustomerReturnSettlementManager.recordSettled', () => {
  it.each([undefined, 0, 2500])('배송비 환불 %p를 선택 필드로 저장한다', async (shippingRefund) => {
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      for: jest
        .fn()
        .mockResolvedValue([
          { id: 'cr_1', channelReturnId: 'ret_1', status: 'inspected', salesOrderId: 'so_1', reason: 'defective' },
        ]),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([]),
    };
    const write = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ id: 'cr_1' }]),
    };
    const trx = { select: jest.fn(() => query), update: jest.fn(() => write) };
    const db = { run: (fn: (tx: DbTx) => Promise<unknown>) => fn(trx as never) };
    const manager = new CustomerReturnSettlementManager(db as never, {} as never, {} as never, {} as never);
    const fact: ChannelReturnSettledPayload = {
      orderId: 'order_1',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      returnId: 'ret_1',
      requestId: 'cr_1',
      refundAmount: 7490,
      deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
      feeNotAdjusted: false,
      refundMode: 'auto',
      settledAt: '2026-10-29T00:00:00.000Z',
      items: [{ channelOrderItemId: 'item_1', received: 1, dismissed: 0 }],
      prepaidAmount: 0,
      externalRefundApplied: 0,
      ...(shippingRefund !== undefined ? { shippingRefund } : {}),
    };

    expect(await manager.recordSettled(fact)).toEqual({ changed: true });
    const outcome = write.set.mock.calls[0][0].settlementOutcome;

    expect(outcome).toMatchObject({ refundAmount: 7490, prepaidAmount: 0, externalRefundApplied: 0 });
    if (shippingRefund === undefined) {
      expect(outcome).not.toHaveProperty('shippingRefund');
    } else {
      expect(outcome.shippingRefund).toBe(shippingRefund);
    }
  });
});
