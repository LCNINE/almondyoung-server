import type { DbTx } from '../../inventory/schema/inventory.schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { CustomerReturnReader } from './customer-return.reader';

describe('CustomerReturnReader.findById', () => {
  it.each(['포장이 찢어졌어요', null])('저장된 메모 %p를 상세에 싣는다', async (note) => {
    const record: typeof wmsTables.customerReturns.$inferSelect = {
      id: 'cr_1',
      salesOrderId: 'so_1',
      channelReturnId: 'ret_1',
      channelRequestId: 'req_1',
      status: 'expected',
      kind: 'return',
      reason: 'defective',
      note,
      feeBearer: 'seller',
      requestedBy: 'customer',
      windowOverrideReason: null,
      requestedAt: new Date('2026-10-29T00:00:00.000Z'),
      cancelledAt: null,
      warehouseId: null,
      arrivedAt: null,
      inspectedAt: null,
      inspectedBy: null,
      settledAt: null,
      settlement: null,
      settlementOutcome: null,
      prepayment: null,
      csResolution: null,
      exchangeReleasedAt: null,
      exchangeReleasedBy: null,
      createdAt: new Date('2026-10-29T00:00:00.000Z'),
      updatedAt: new Date('2026-10-29T00:00:00.000Z'),
    };
    const query = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue([{ record, channelOrderId: 'order_1', displayOrderNo: null, salesChannel: 'medusa' }]),
      orderBy: jest.fn().mockResolvedValue([]),
    };
    const trx = { select: jest.fn(() => query) };
    // DB 경계만 대역으로 바꾼다.
    const db = { run: (fn: (tx: DbTx) => Promise<unknown>) => fn(trx as never) };
    const reader = new CustomerReturnReader(db as never);

    expect(await reader.findById('cr_1')).toMatchObject({ id: 'cr_1', note });
  });
});

describe('CustomerReturnReader.listForReceiving', () => {
  it('저장된 사유를 수령 목록에 싣는다', async () => {
    const query = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    };
    const candidates = {
      ...query,
      where: jest.fn().mockResolvedValue([
        {
          id: 'cr_1',
          salesOrderId: 'so_1',
          status: 'arrived',
          reason: 'wrong_item',
          requestedAt: new Date('2026-10-29T00:00:00.000Z'),
          csResolution: null,
          channelOrderId: 'order_1',
          displayOrderNo: null,
          customerName: '홍길동',
        },
      ]),
    };
    const trx = { select: jest.fn().mockReturnValue(query).mockReturnValueOnce(candidates) };
    const db = { run: (fn: (tx: DbTx) => Promise<unknown>) => fn(trx as never) };
    const reader = new CustomerReturnReader(db as never);

    const page = await reader.listForReceiving({ warehouseId: 'w_1', limit: 100 });

    expect(trx.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reason: wmsTables.customerReturns.reason }),
    );
    expect(page.items).toEqual([expect.objectContaining({ id: 'cr_1', reason: 'wrong_item' })]);
  });
});
