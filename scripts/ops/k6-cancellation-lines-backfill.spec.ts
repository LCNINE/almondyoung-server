import { BackfillCancellation, diffDerivedWithStored, planOrderBackfill } from './k6-cancellation-lines-backfill';

const lines = [{ id: 'L1', quantity: 3, isDigital: false }];
const at = (n: number) => new Date(Date.UTC(2026, 0, n));
const partial = (id: string, day: number, over: Partial<BackfillCancellation> = {}): BackfillCancellation => ({
  id,
  scope: 'partial',
  metadata: { cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }] },
  effects: [],
  createdAt: at(day),
  existingLines: [],
  ...over,
});
const full = (id: string, day: number, over: Partial<BackfillCancellation> = {}): BackfillCancellation => ({
  id,
  scope: 'full',
  metadata: {},
  effects: [],
  createdAt: at(day),
  existingLines: [],
  ...over,
});

describe('planOrderBackfill', () => {
  it('replays partial then v1 full in order', () => {
    // 입력 순서를 섞어도 created_at 순으로 재생한다
    expect(planOrderBackfill(lines, [full('c2', 2), partial('c1', 1)])).toEqual({
      kind: 'ok',
      inserts: [
        { cancellationId: 'c1', salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
        { cancellationId: 'c2', salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' },
      ],
    });
  });

  it('replays partials before the full even when the full sorts earlier by time', () => {
    // occurred_at 은 호출자가 준 값(OrderCancelled.cancelledAt·채널 시각)이라 전체 취소가 더 이를 수 있고,
    // created_at 도 한 트랜잭션 안이면 같다. 전체 취소는 언제나 마지막이다 — 그 뒤의 partial 은 거절되기 때문이다.
    expect(planOrderBackfill(lines, [full('c0', 1), partial('c1', 2)])).toEqual({
      kind: 'ok',
      inserts: [
        { cancellationId: 'c1', salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
        { cancellationId: 'c0', salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' },
      ],
    });
    // created_at 이 같으면(같은 트랜잭션) id 가 앞서도 전체 취소가 뒤다
    expect(planOrderBackfill(lines, [full('a', 1), partial('b', 1)])).toMatchObject({
      kind: 'ok',
      inserts: [{ cancellationId: 'b' }, { cancellationId: 'a' }],
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

  it('rethrows errors that are not about ambiguity of the legacy record', () => {
    // 모호함(형식 불량·도출 실패)만 ambiguous 로 보고한다. 그 밖의 예외는 프로그램 결함이라 그대로 올린다.
    const metadata = {
      get cancelledLines(): unknown {
        throw new TypeError('boom');
      },
    };
    expect(() => planOrderBackfill(lines, [partial('c1', 1, { metadata })])).toThrow(TypeError);
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

describe('diffDerivedWithStored', () => {
  const row = (quantity: number, shipmentPhase = 'before_shipment') => ({
    cancellationId: 'c1',
    salesOrderLineId: 'l1',
    shipmentPhase,
    quantity,
  });

  it('도출과 저장이 같으면 차이가 없다 (순서 무관)', () => {
    expect(diffDerivedWithStored([row(1), row(2, 'after_shipment')], [row(2, 'after_shipment'), row(1)])).toEqual([]);
  });

  it('수량·갈래가 다르거나 한쪽에만 있으면 차이를 낸다', () => {
    const diffs = diffDerivedWithStored([row(1)], [row(2), row(1, 'after_shipment')]);
    expect(diffs).toHaveLength(3);
    expect(diffs.filter((d) => d.startsWith('도출에만'))).toHaveLength(1);
    expect(diffs.filter((d) => d.startsWith('저장에만'))).toHaveLength(2);
  });
});
