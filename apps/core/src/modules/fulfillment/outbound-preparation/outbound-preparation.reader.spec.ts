import { DbService } from '@app/db';
import { Test } from '@nestjs/testing';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadShipmentLines, loadSplitShares } from '../services/consolidation-shipment-reads';
import { OutboundPreparationReader } from './outbound-preparation.reader';

jest.mock('../services/consolidation-shipment-reads', () => ({
  ...jest.requireActual<typeof import('../services/consolidation-shipment-reads')>(
    '../services/consolidation-shipment-reads',
  ),
  loadShipmentLines: jest.fn(),
  loadSplitShares: jest.fn(async () => new Map()),
}));

function query(rows: unknown[]) {
  const result = Object.assign(Promise.resolve(rows), {
    from: () => result,
    where: () => result,
    innerJoin: () => result,
    orderBy: () => result,
    groupBy: () => result,
  });

  return result;
}

describe('OutboundPreparationReader consolidation reservations', () => {
  it.each([
    { peerQty: 0, expected: 'ready' },
    { peerQty: 1, expected: 'mergeable' },
  ])('classifies a reserved original with peer reservation $peerQty as $expected', async ({ peerQty, expected }) => {
    const recipientSnapshot = {
      recipientName: '테스트',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '테스트 주소',
    };
    const select = jest
      .fn()
      .mockReturnValueOnce(query([{ count: 0 }]))
      .mockReturnValueOnce(query(['original', 'split'].map((id) => ({ id, status: 'draft', recipientSnapshot }))))
      .mockReturnValueOnce(
        query(['original', 'split'].map((id) => ({ id: `${id}-line`, shipmentId: id, qty: 1, name: `${id} 상품` }))),
      )
      .mockReturnValueOnce(
        query([
          { lineId: 'original-line', quantity: 1 },
          { lineId: 'split-line', quantity: peerQty },
        ]),
      )
      .mockReturnValueOnce(query([]));
    const db = { select };

    jest.mocked(loadShipmentLines).mockResolvedValue(
      ['original', 'split'].map((shipmentId) => ({
        shipmentId,
        qty: 1,
        skuProfileId: 'profile',
        skuId: 'sku',
        skuName: '상품',
        fulfillmentMode: 'in_house',
        skuStockType: 'stocked',
        salesOrderId: 'order',
        customerId: 'customer',
        customerName: null,
        customerPhone: null,
        displayOrderNo: 'order',
        channelOrderId: null,
        salesChannel: null,
        salesOrderCreatedAt: null,
      })),
    );

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        {
          provide: ConsolidationBoardReader,
          useValue: {
            findBoard: async () => ({
              groups: [
                {
                  shipments: ['original', 'split'].map((shipmentId) => ({ shipmentId, status: 'draft' })),
                },
              ],
            }),
          },
        },
      ],
    }).compile();

    const summary = await module.get(OutboundPreparationReader).summarize('warehouse');

    expect(
      summary.buckets.find((bucket) => bucket.bucket === expected)?.shipments.map((shipment) => shipment.shipmentId),
    ).toContain('original');
    expect(JSON.stringify(summary)).not.toContain('recipientSnapshot');
  });

  it('returns ordered and reserved quantities per item so a partial box shows what ships now', async () => {
    const recipientSnapshot = {
      recipientName: '테스트',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '테스트 주소',
    };
    const select = jest
      .fn()
      .mockReturnValueOnce(query([{ count: 0 }]))
      .mockReturnValueOnce(query([{ id: 'box', status: 'draft', recipientSnapshot }]))
      .mockReturnValueOnce(
        query([
          { id: 'line-a', shipmentId: 'box', qty: 5, name: '상품 A' },
          { id: 'line-b', shipmentId: 'box', qty: 1, name: '상품 B' },
        ]),
      )
      .mockReturnValueOnce(
        query([
          { lineId: 'line-a', quantity: 2 },
          { lineId: 'line-b', quantity: 1 },
        ]),
      )
      .mockReturnValueOnce(query([]));
    const db = { select };

    jest.mocked(loadShipmentLines).mockResolvedValue(
      [5, 1].map((qty, index) => ({
        shipmentId: 'box',
        qty,
        skuProfileId: 'profile',
        skuId: `sku-${index}`,
        skuName: index === 0 ? '상품 A' : '상품 B',
        fulfillmentMode: 'in_house',
        skuStockType: 'stocked',
        salesOrderId: 'order',
        customerId: 'customer',
        customerName: null,
        customerPhone: null,
        displayOrderNo: 'order',
        channelOrderId: null,
        salesChannel: null,
        salesOrderCreatedAt: null,
      })),
    );

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ConsolidationBoardReader, useValue: { findBoard: async () => ({ groups: [] }) } },
      ],
    }).compile();

    jest
      .mocked(loadSplitShares)
      .mockResolvedValueOnce(new Map([['box', { boxQty: 6, orderQty: 9, boxNo: 1, boxCount: 2 }]]));

    const summary = await module.get(OutboundPreparationReader).summarize('warehouse');

    expect(summary.buckets.find((bucket) => bucket.bucket === 'partial')?.shipments[0].split).toEqual({
      boxQty: 6,
      orderQty: 9,
      boxNo: 1,
      boxCount: 2,
    });
    expect(summary.buckets.find((bucket) => bucket.bucket === 'partial')?.shipments[0].lines).toEqual([
      { name: '상품 A', qty: 5, reservedQty: 2 },
      { name: '상품 B', qty: 1, reservedQty: 1 },
    ]);
  });
  it('pages beyond 200 within a bucket while preserving totals and stable order', async () => {
    const ids = Array.from({ length: 401 }, (_, index) => `s${index}`);
    const select = jest.fn();
    const db = { select };
    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ConsolidationBoardReader, useValue: { findBoard: async () => ({ groups: [] }) } },
      ],
    }).compile();
    const reader = module.get(OutboundPreparationReader);
    jest.mocked(loadShipmentLines).mockResolvedValue([]);

    for (const offset of [0, 200, 400, 401]) {
      select
        .mockReturnValueOnce(query([{ count: 3 }]))
        .mockReturnValueOnce(
          query(
            ids.flatMap((id) => [
              { id: `resume-${id}`, status: 'planned', recipientSnapshot: {} },
              { id, status: 'draft', recipientSnapshot: {} },
            ]),
          ),
        )
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([]));

      const summary = await reader.summarize('warehouse', { bucket: 'unavailable', offset });
      const bucket = summary.buckets.find((entry) => entry.bucket === 'unavailable');

      expect(bucket).toMatchObject({ count: 401, singleCount: 0, multiCount: 401 });
      expect(bucket?.shipments.map((shipment) => shipment.shipmentId)).toEqual(ids.slice(offset, offset + 200));
      expect(
        summary.buckets
          .filter((entry) => entry.bucket !== 'unavailable')
          .every((entry) => entry.shipments.length === 0),
      ).toBe(true);
      expect(summary.buckets.find((entry) => entry.bucket === 'resume')?.count).toBe(401);
      expect(summary.awaitingMatchingCount).toBe(3);
    }
  });
});
