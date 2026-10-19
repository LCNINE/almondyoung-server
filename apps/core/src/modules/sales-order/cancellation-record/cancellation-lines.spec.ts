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
