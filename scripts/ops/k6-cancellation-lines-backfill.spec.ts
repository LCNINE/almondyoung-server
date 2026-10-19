import { BackfillCancellation, planOrderBackfill } from './k6-cancellation-lines-backfill';

const lines = [{ id: 'L1', quantity: 3, isDigital: false }];
const at = (n: number) => new Date(Date.UTC(2026, 0, n));
const partial = (id: string, day: number, over: Partial<BackfillCancellation> = {}): BackfillCancellation => ({
  id,
  scope: 'partial',
  metadata: { cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }] },
  effects: [],
  occurredAt: at(day),
  existingLines: [],
  ...over,
});
const full = (id: string, day: number, over: Partial<BackfillCancellation> = {}): BackfillCancellation => ({
  id,
  scope: 'full',
  metadata: {},
  effects: [],
  occurredAt: at(day),
  existingLines: [],
  ...over,
});

describe('planOrderBackfill', () => {
  it('replays partial then v1 full in order', () => {
    // 입력 순서를 섞어도 occurredAt 순으로 재생한다
    expect(planOrderBackfill(lines, [full('c2', 2), partial('c1', 1)])).toEqual({
      kind: 'ok',
      inserts: [
        { cancellationId: 'c1', salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
        { cancellationId: 'c2', salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' },
      ],
    });
  });

  it('skips cancellations that already have lines', () => {
    expect(
      planOrderBackfill(lines, [
        partial('c1', 1, { existingLines: [{ salesOrderLineId: 'L1', quantity: 1 }] }),
        full('c2', 2),
      ]),
    ).toEqual({
      kind: 'ok',
      inserts: [{ cancellationId: 'c2', salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' }],
    });
  });

  it('reports malformed metadata as ambiguous', () => {
    const plan = planOrderBackfill(lines, [
      partial('c1', 1, { metadata: { cancelledLines: [{ salesOrderLineId: 'L1', quantity: '1' }] } }),
    ]);
    expect(plan).toMatchObject({ kind: 'ambiguous', cancellationId: 'c1' });
  });

  it('reports partial without cancelledLines as ambiguous', () => {
    expect(planOrderBackfill(lines, [partial('c1', 1, { metadata: {} })])).toMatchObject({
      kind: 'ambiguous',
      cancellationId: 'c1',
    });
    expect(planOrderBackfill(lines, [partial('c1', 1, { metadata: null })])).toMatchObject({ kind: 'ambiguous' });
  });

  it('reports derivation failure as ambiguous for the whole order', () => {
    expect(
      planOrderBackfill(lines, [
        partial('c1', 1),
        full('c2', 2, { metadata: { cancelledLines: [{ salesOrderLineId: 'L1', quantity: 9 }] } }),
      ]),
    ).toMatchObject({
      kind: 'ambiguous',
      cancellationId: 'c2',
    });
  });

  it('post-shipment partial keeps its phase', () => {
    const plan = planOrderBackfill(lines, [
      partial('c1', 1, {
        effects: [
          {
            type: 'preserved_shipped_fulfillment_order_item',
            metadata: {
              salesOrderLineId: 'L1',
              skuId: 'A',
              requestedFulfillmentQuantity: 1,
              affectedShippedQuantity: 1,
            },
          },
        ],
      }),
    ]);
    expect(plan).toEqual({
      kind: 'ok',
      inserts: [{ cancellationId: 'c1', salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'after_shipment' }],
    });
  });
});
