import { DbService } from '@app/db';
import { Test } from '@nestjs/testing';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { OutboundPreparationReader } from './outbound-preparation.reader';

jest.mock('../services/consolidation-shipment-reads', () => ({
  ...jest.requireActual<typeof import('../services/consolidation-shipment-reads')>(
    '../services/consolidation-shipment-reads',
  ),
  loadShipmentLines: jest.fn(),
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
      .mockReturnValueOnce(query(['original', 'split'].map((id) => ({ id: `${id}-line`, shipmentId: id, qty: 1 }))))
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
});
