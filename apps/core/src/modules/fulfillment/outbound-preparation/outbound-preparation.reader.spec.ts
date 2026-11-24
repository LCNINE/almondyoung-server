import { DbService } from '@app/db';
import { Test } from '@nestjs/testing';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadShipmentLines, loadSplitShares } from '../services/consolidation-shipment-reads';
import { InboundPipelineReader } from '../../inventory/stock-projection/services/inbound-pipeline.reader';
import { OutboundPreparationReader } from './outbound-preparation.reader';
import { loadWarehouseStock } from './shortage-stock';

jest.mock('../services/consolidation-shipment-reads', () => ({
  ...jest.requireActual<typeof import('../services/consolidation-shipment-reads')>(
    '../services/consolidation-shipment-reads',
  ),
  loadShipmentLines: jest.fn(),
  loadSplitShares: jest.fn(async () => new Map()),
}));
// 셀메이트 상자 판정(#1412)은 통합 스펙이 본다 — 여기 select 순서 목에 쿼리를 끼우지 않는다
jest.mock('../services/sellmate-handed-over-shipments', () => ({
  loadSellmateShipmentIds: jest.fn(async () => new Set<string>()),
}));
jest.mock('./short-pick-returns', () => ({
  ...jest.requireActual<typeof import('./short-pick-returns')>('./short-pick-returns'),
  loadShortPickReturns: jest.fn(async () => new Map()),
}));
// 정보 부족·출고불가 상자에 덧붙이는 조회는 needs-info·shortage-stock 스펙과 통합 스펙이 본다
jest.mock('./needs-info', () => ({
  ...jest.requireActual<typeof import('./needs-info')>('./needs-info'),
  loadNeedsInfoLines: jest.fn(
    async (_trx: unknown, shipmentIds: string[]) =>
      new Map(
        shipmentIds.map((id) => [
          id,
          [{ skuId: 'sku', skuName: '상품', skuCode: 'CODE', profileId: 'profile', profileName: '일반' }],
        ]),
      ),
  ),
}));
jest.mock('./shortage-stock', () => ({
  ...jest.requireActual<typeof import('./shortage-stock')>('./shortage-stock'),
  loadWarehouseStock: jest.fn(async () => new Map()),
  readPipelineScope: jest.fn(async () => ({ incoming: false, elsewhere: false })),
}));
jest.mock('./batch-returns', () => ({
  ...jest.requireActual<typeof import('./batch-returns')>('./batch-returns'),
  loadReturnedWorkItems: jest.fn(async () => new Map()),
  loadNeedsNewWaybill: jest.fn(async () => new Set<string>()),
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
      .mockReturnValueOnce(query([]))
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
        { provide: InboundPipelineReader, useValue: { read: async () => [] } },
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
          { id: 'line-a', shipmentId: 'box', skuId: 'sku-0', qty: 5, name: '상품 A' },
          { id: 'line-b', shipmentId: 'box', skuId: 'sku-1', qty: 1, name: '상품 B' },
        ]),
      )
      .mockReturnValueOnce(
        query([
          { lineId: 'line-a', quantity: 2 },
          { lineId: 'line-b', quantity: 1 },
        ]),
      )
      .mockReturnValueOnce(query([]))
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
        { provide: InboundPipelineReader, useValue: { read: async () => [] } },
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ConsolidationBoardReader, useValue: { findBoard: async () => ({ groups: [] }) } },
      ],
    }).compile();

    jest
      .mocked(loadSplitShares)
      .mockResolvedValueOnce(
        new Map([['box', { boxQty: 6, orderQty: 9, boxNo: 1, boxCount: 2, reasonCode: null, reason: null }]]),
      );

    jest.mocked(loadWarehouseStock).mockResolvedValueOnce(new Map([['sku-0', { onHand: 4, reserved: 3 }]]));

    const summary = await module.get(OutboundPreparationReader).summarize('warehouse');

    expect(jest.mocked(loadWarehouseStock).mock.calls.at(-1)?.[2]).toEqual(['sku-0']);
    expect(summary.buckets.find((bucket) => bucket.bucket === 'partial')?.shipments[0].split).toEqual({
      boxQty: 6,
      orderQty: 9,
      boxNo: 1,
      boxCount: 2,
      reasonCode: null,
      reason: null,
    });
    expect(summary.buckets.find((bucket) => bucket.bucket === 'partial')?.shipments[0].lines).toEqual([
      {
        name: '상품 A',
        qty: 5,
        reservedQty: 2,
        // 재고 4개 중 이 상자가 2개, 다른 상자가 1개를 잡았다
        stock: { skuId: 'sku-0', onHand: 4, reservedByOthers: 1, available: 1, incoming: null, elsewhere: null },
      },
      { name: '상품 B', qty: 1, reservedQty: 1 },
    ]);
  });
  it('위탁 업체 상자에 화주를 달고, 화주 필터로 거르며, 화주별 개수는 거르기 전 전부를 센다', async () => {
    const recipientSnapshot = {
      recipientName: '테스트',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '테스트 주소',
    };
    const ids = ['ours', 'vendor'];
    const mockSelects = () =>
      jest
        .fn()
        .mockReturnValueOnce(query([{ count: 0 }]))
        .mockReturnValueOnce(query(ids.map((id) => ({ id, status: 'draft', recipientSnapshot }))))
        .mockReturnValueOnce(query(ids.map((id) => ({ id: `${id}-line`, shipmentId: id, qty: 1, name: id }))))
        .mockReturnValueOnce(query(ids.map((id) => ({ lineId: `${id}-line`, quantity: 1 }))))
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([]));
    const db = { select: mockSelects() };

    jest.mocked(loadShipmentLines).mockResolvedValue(
      ids.map((shipmentId) => ({
        shipmentId,
        qty: 1,
        skuProfileId: 'profile',
        skuId: `sku-${shipmentId}`,
        skuName: shipmentId,
        fulfillmentMode: shipmentId === 'vendor' ? '3pl' : 'in_house',
        skuStockType: 'stocked',
        salesOrderId: `order-${shipmentId}`,
        customerId: null,
        customerName: null,
        customerPhone: null,
        displayOrderNo: shipmentId,
        channelOrderId: null,
        salesChannel: null,
        salesOrderCreatedAt: null,
        ownerId: shipmentId === 'vendor' ? 'h1' : null,
        ownerName: shipmentId === 'vendor' ? '업체' : null,
      })),
    );

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: InboundPipelineReader, useValue: { read: async () => [] } },
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ConsolidationBoardReader, useValue: { findBoard: async () => ({ groups: [] }) } },
      ],
    }).compile();
    const reader = module.get(OutboundPreparationReader);
    const shipmentsOf = (summary: Awaited<ReturnType<typeof reader.summarize>>) =>
      summary.buckets.flatMap((bucket) => bucket.shipments);

    const all = await reader.summarize('warehouse');

    expect(shipmentsOf(all).map((s) => [s.shipmentId, s.owner])).toEqual([
      ['ours', null],
      ['vendor', { id: 'h1', name: '업체' }],
    ]);
    expect(all.holders).toEqual([
      { key: 'own', name: '자사', count: 1 },
      { key: 'h1', name: '업체', count: 1 },
    ]);

    db.select = mockSelects();
    const filtered = await reader.summarize('warehouse', { holders: ['h1'] });

    expect(shipmentsOf(filtered).map((s) => s.shipmentId)).toEqual(['vendor']);
    expect(filtered.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(1);
    expect(filtered.holders).toEqual(all.holders);
  });

  it('pages beyond 200 within a bucket while preserving totals and stable order', async () => {
    const ids = Array.from({ length: 401 }, (_, index) => `s${index}`);
    const select = jest.fn();
    const db = { select };
    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: InboundPipelineReader, useValue: { read: async () => [] } },
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

  it('looks up many shop lines in chunks and marks only the box whose line is untrusted', async () => {
    const recipientSnapshot = {
      recipientName: '테스트',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '테스트 주소',
    };
    const lineId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const untrustedId = '0000000a-0000-4000-8000-00000000000a';
    const links = [
      ...Array.from({ length: 5000 }, (_, index) => ({ shipmentId: 'box', salesOrderLineId: lineId(index) })),
      { shipmentId: 'other', salesOrderLineId: untrustedId },
      { shipmentId: 'other', salesOrderLineId: 'not-a-uuid' },
      { shipmentId: 'box', salesOrderLineId: untrustedId.toUpperCase() },
    ];
    const trusted = {
      salesChannel: 'naver',
      channelOrderItemId: 'item',
      channelProductId: 'product',
      exchangeReturnLineId: null,
    };
    const select = jest
      .fn()
      .mockReturnValueOnce(query([{ count: 0 }]))
      .mockReturnValueOnce(query(['box', 'other'].map((id) => ({ id, status: 'draft', recipientSnapshot }))))
      .mockReturnValueOnce(
        query(['box', 'other'].map((id) => ({ id: `${id}-line`, shipmentId: id, qty: 1, name: '상품' }))),
      )
      .mockReturnValueOnce(query(['box', 'other'].map((id) => ({ lineId: `${id}-line`, quantity: 1 }))))
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query(links))
      .mockReturnValueOnce(query([{ id: lineId(0), ...trusted }]))
      .mockReturnValueOnce(query([{ id: untrustedId, ...trusted, channelOrderItemId: null }]));
    const db = { select };
    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationReader,
        { provide: InboundPipelineReader, useValue: { read: async () => [] } },
        { provide: DbService, useValue: { run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ConsolidationBoardReader, useValue: { findBoard: async () => ({ groups: [] }) } },
      ],
    }).compile();
    jest.mocked(loadShipmentLines).mockResolvedValue(
      ['box', 'other'].map((shipmentId) => ({
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
        displayOrderNo: shipmentId,
        channelOrderId: null,
        salesChannel: 'naver',
        salesOrderCreatedAt: null,
      })),
    );

    const summary = await module.get(OutboundPreparationReader).summarize('warehouse');
    const ids = (bucket: string) =>
      summary.buckets.find((entry) => entry.bucket === bucket)?.shipments.map((shipment) => shipment.shipmentId);

    expect(select).toHaveBeenCalledTimes(8);
    expect(ids('ready')).toEqual(['box']);
    expect(ids('needs_info')).toEqual(['other']);
  });
});
