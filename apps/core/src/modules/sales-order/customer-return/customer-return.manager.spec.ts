import type { DbTx } from '../../inventory/schema/inventory.schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import type { ChannelReturnRequestedPayload } from '@packages/event-contracts/streams/orders.stream';
import { CustomerReturnManager } from './customer-return.manager';

jest.mock('../common/claim-progress', () => ({ enqueueSalesOrderClaimProgress: jest.fn() }));

describe('CustomerReturnManager.recordRequested', () => {
  it.each([
    { note: '포장이 찢어졌어요', stored: '포장이 찢어졌어요' },
    { note: undefined, stored: null },
  ])('메모 $note를 $stored로 저장한다', async ({ note, stored }) => {
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest
        .fn()
        .mockReturnValueOnce({ limit: jest.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ limit: jest.fn().mockResolvedValue([{ id: 'so_1' }]) })
        .mockResolvedValueOnce([{ id: 'line_1', channelOrderItemId: 'item_1', quantity: 1 }])
        .mockResolvedValueOnce([{ salesOrderLineId: 'line_1', skuId: 'sku_1', qtyPerUnit: 1 }]),
    };
    const write = {
      values: jest.fn().mockReturnThis(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
      returning: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'cr_1' }])
        .mockResolvedValueOnce([{ id: 'return_line_1', salesOrderLineId: 'line_1' }]),
    };
    const trx = { select: jest.fn(() => query), insert: jest.fn(() => write) };
    // DB 경계만 대역으로 바꾼다.
    const db = { run: (fn: (tx: DbTx) => Promise<unknown>) => fn(trx as never) };
    const manager = new CustomerReturnManager(db as never, {} as never);
    const fact: ChannelReturnRequestedPayload = {
      orderId: 'order_1',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      returnId: 'ret_1',
      requestId: 'req_1',
      reason: 'defective',
      feeBearer: 'seller',
      requestedBy: 'customer',
      requestedAt: '2026-10-29T00:00:00.000Z',
      items: [{ channelOrderItemId: 'item_1', quantity: 1 }],
      ...(note !== undefined ? { note } : {}),
    };

    expect(await manager.recordRequested(fact)).toEqual({ customerReturnId: 'cr_1', created: true });
    expect(trx.insert).toHaveBeenNthCalledWith(1, wmsTables.customerReturns);
    expect(write.values).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: stored }));
  });
});
