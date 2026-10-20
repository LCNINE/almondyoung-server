import {
  CancellationEffect,
  CancellationLineDerivationError,
  CancellationLineContext,
  deriveCancellationLines,
} from './cancellation-lines';

const physical = (id: string, quantity: number): CancellationLineContext => ({ id, quantity, isDigital: false });
const digital = (id: string, quantity: number): CancellationLineContext => ({ id, quantity, isDigital: true });
const preserved = (
  salesOrderLineId: string,
  skuId: string,
  requestedFulfillmentQuantity: number,
  affectedShippedQuantity: number,
): CancellationEffect => ({
  type: 'preserved_shipped_fulfillment_order_item',
  metadata: { salesOrderLineId, skuId, requestedFulfillmentQuantity, affectedShippedQuantity },
});

describe('deriveCancellationLines', () => {
  it('partial without effects is all before_shipment', () => {
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [],
        lines: [physical('L1', 3)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([{ salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' }]);
  });

  it('partial with preserved shipped splits by phase', () => {
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [preserved('L1', 'A', 2, 1)],
        lines: [physical('L1', 3)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'after_shipment' },
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
    ]);
  });

  it('sums affectedShippedQuantity across several fulfillment order items of one sku', () => {
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [preserved('L1', 'A', 2, 1), preserved('L1', 'A', 2, 1)],
        lines: [physical('L1', 3)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([{ salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'after_shipment' }]);
  });

  it('bundle with one shipped component counts the unit as after_shipment', () => {
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }],
        effects: [preserved('L1', 'A', 1, 1)],
        lines: [physical('L1', 1)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([{ salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'after_shipment' }]);
  });

  it('two-sku bundle: a unit whose one sku shipped and other did not is after_shipment', () => {
    // 판매 단위 = A×1 + B×1. 취소 2단위 중 A 1개만 나갔고 B 는 하나도 안 나갔다 → 그 단위 하나가 출고 후.
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [preserved('L1', 'A', 2, 1), preserved('L1', 'B', 2, 0)],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'after_shipment' },
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
    ]);
  });

  it('two-sku bundle takes the per-sku maximum of rounded-up shipped units', () => {
    // 판매 단위 = A×1 + B×2, 취소 3단위. A 출고 1 → ceil(1/1)=1, B 출고 3 → ceil(3/2)=2 ⇒ 출고 후 max(1,2)=2.
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 3 }],
        effects: [preserved('L1', 'A', 3, 1), preserved('L1', 'B', 6, 3)],
        lines: [physical('L1', 3)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([
      { salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'after_shipment' },
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
    ]);
  });

  it('multi-unit sku rounds up', () => {
    expect(
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [preserved('L1', 'A', 6, 4)],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([{ salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'after_shipment' }]);
  });

  it('repeated partial respects prior', () => {
    expect(() =>
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [],
        lines: [physical('L1', 3)],
        priorCancelledByLine: new Map([['L1', 2]]),
      }),
    ).toThrow(CancellationLineDerivationError);
  });

  it('v1 full cancels every remainder', () => {
    expect(
      deriveCancellationLines({
        scope: 'full',
        cancelledLines: null,
        effects: [],
        lines: [physical('L1', 3), physical('L2', 1)],
        priorCancelledByLine: new Map([['L1', 1]]),
      }),
    ).toEqual([
      { salesOrderLineId: 'L1', quantity: 2, shipmentPhase: 'before_shipment' },
      { salesOrderLineId: 'L2', quantity: 1, shipmentPhase: 'before_shipment' },
    ]);
  });

  it('v2 full uses cancelledLines and adds digital remainder', () => {
    expect(
      deriveCancellationLines({
        scope: 'full',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }],
        effects: [],
        lines: [physical('L1', 2), digital('D1', 1)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([
      { salesOrderLineId: 'D1', quantity: 1, shipmentPhase: 'before_shipment' },
      { salesOrderLineId: 'L1', quantity: 1, shipmentPhase: 'before_shipment' },
    ]);
  });

  it('zero-quantity entries are dropped', () => {
    expect(
      deriveCancellationLines({
        scope: 'full',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 0 }],
        effects: [],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toEqual([]);
  });

  it('indivisible requestedFulfillmentQuantity throws', () => {
    expect(() =>
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 2 }],
        effects: [preserved('L1', 'A', 3, 1)],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toThrow(CancellationLineDerivationError);
  });

  it('throws when the cancelled line is unknown', () => {
    expect(() =>
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'X', quantity: 1 }],
        effects: [],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toThrow(CancellationLineDerivationError);
  });

  it('throws when shipped quantity exceeds the cancelled quantity', () => {
    expect(() =>
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }],
        effects: [preserved('L1', 'A', 1, 3)],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toThrow(CancellationLineDerivationError);
  });

  it('throws when a preserved effect has non-numeric fields', () => {
    expect(() =>
      deriveCancellationLines({
        scope: 'partial',
        cancelledLines: [{ salesOrderLineId: 'L1', quantity: 1 }],
        effects: [
          {
            type: 'preserved_shipped_fulfillment_order_item',
            metadata: { salesOrderLineId: 'L1', skuId: 'A', requestedFulfillmentQuantity: '1' },
          },
        ],
        lines: [physical('L1', 2)],
        priorCancelledByLine: new Map(),
      }),
    ).toThrow(CancellationLineDerivationError);
  });
});
