import { collectFulfillmentInvariantViolations, FulfillmentInvariantSnapshot } from './fulfillment-invariant.service';

const validSnapshot = (): FulfillmentInvariantSnapshot => ({
  fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-1', qty: 10, shippedQty: 2, canceledQty: 1 }],
  shipments: [{ id: 'shipment-1', warehouseId: 'warehouse-1', status: 'draft', manifestVersion: 3 }],
  shipmentLines: [
    {
      id: 'line-1',
      shipmentId: 'shipment-1',
      fulfillmentOrderItemId: 'foi-1',
      skuId: 'sku-1',
      qty: 7,
      inspectedQty: 0,
    },
  ],
  reservations: [
    {
      id: 'reservation-1',
      fulfillmentOrderItemId: 'foi-1',
      shipmentLineId: 'line-1',
      status: 'confirmed',
      quantity: 4,
    },
  ],
  invoices: [{ id: 'invoice-1', shipmentId: 'shipment-1', manifestVersion: 3, status: 'issued' }],
  sessions: [{ id: 'session-1', handedInQty: 7, settledQty: 2, returnedQty: 1, shortageQty: 1 }],
  sessionBalances: [{ id: 'balance-1', sessionId: 'session-1', custodyType: 'PACKING', qty: 3 }],
  dispatchAttempts: [],
  dispatchSources: [],
  stockEvents: [],
});

describe('collectFulfillmentInvariantViolations', () => {
  it('accepts a conserved snapshot', () => {
    expect(collectFulfillmentInvariantViolations(validSnapshot())).toEqual([]);
  });

  it('detects FOI active-line, planned reservation, invoice and session drift together', () => {
    const snapshot = validSnapshot();
    snapshot.shipmentLines[0].qty = 6;
    snapshot.shipments[0].status = 'planned';
    snapshot.invoices[0].manifestVersion = 2;
    snapshot.sessions[0].handedInQty = 8;

    expect(collectFulfillmentInvariantViolations(snapshot).map((violation) => violation.kind)).toEqual(
      expect.arrayContaining([
        'ACTIVE_LINE_QUANTITY',
        'CONFIRMED_RESERVATION',
        'ACTIVE_INVOICE_VERSION',
        'SESSION_CONSERVATION',
      ]),
    );
  });

  it('requires exact dispatch source quantity and a one-to-one linked stock event', () => {
    const snapshot = validSnapshot();
    snapshot.dispatchAttempts = [
      { id: 'attempt-1', shipmentId: 'shipment-1', status: 'dispatched', stockJournalId: 'journal-1' },
    ];
    snapshot.dispatchSources = [
      {
        id: 'source-1',
        dispatchAttemptId: 'attempt-1',
        shipmentLineId: 'line-1',
        sourceLocationId: 'location-1',
        qty: 6,
        stockEventId: null,
      },
    ];

    const violations = collectFulfillmentInvariantViolations(snapshot);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'DISPATCH_SOURCE_CARDINALITY', resourceId: 'attempt-1' }),
        expect.objectContaining({ kind: 'DISPATCH_EVENT_CARDINALITY', resourceId: 'source-1' }),
      ]),
    );
  });

  it('accepts an exact dispatch source/event mapping', () => {
    const snapshot = validSnapshot();
    snapshot.dispatchAttempts = [
      { id: 'attempt-1', shipmentId: 'shipment-1', status: 'dispatched', stockJournalId: 'journal-1' },
    ];
    snapshot.dispatchSources = [
      {
        id: 'source-1',
        dispatchAttemptId: 'attempt-1',
        shipmentLineId: 'line-1',
        sourceLocationId: 'location-1',
        qty: 7,
        stockEventId: 'event-1',
      },
    ];
    snapshot.stockEvents = [
      {
        id: 'event-1',
        journalId: 'journal-1',
        skuId: 'sku-1',
        fromWarehouseId: 'warehouse-1',
        fromLocationId: 'location-1',
        fromState: 'ON_HAND',
        toWarehouseId: null,
        toState: null,
        transitionType: 'SHIP',
        quantity: 7,
      },
    ];

    expect(collectFulfillmentInvariantViolations(snapshot)).toEqual([]);
  });

  it('rejects a foreign shipment source and a non-SHIP/wrong-SKU stock event', () => {
    const snapshot = validSnapshot();
    snapshot.shipments.push({ id: 'shipment-2', warehouseId: 'warehouse-1', status: 'shipped', manifestVersion: 1 });
    snapshot.shipmentLines.push({
      id: 'line-2',
      shipmentId: 'shipment-2',
      fulfillmentOrderItemId: 'foi-1',
      skuId: 'sku-2',
      qty: 7,
      inspectedQty: 0,
    });
    snapshot.dispatchAttempts = [
      { id: 'attempt-1', shipmentId: 'shipment-1', status: 'dispatched', stockJournalId: 'journal-1' },
    ];
    snapshot.dispatchSources = [
      {
        id: 'foreign-source',
        dispatchAttemptId: 'attempt-1',
        shipmentLineId: 'line-2',
        sourceLocationId: 'location-1',
        qty: 7,
        stockEventId: 'event-1',
      },
    ];
    snapshot.stockEvents = [
      {
        id: 'event-1',
        journalId: 'journal-1',
        skuId: 'wrong-sku',
        fromWarehouseId: 'warehouse-1',
        fromLocationId: 'location-1',
        fromState: 'ON_HAND',
        toWarehouseId: null,
        toState: null,
        transitionType: 'ADJUST_DOWN',
        quantity: 7,
      },
    ];

    expect(collectFulfillmentInvariantViolations(snapshot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'DISPATCH_SOURCE_CARDINALITY', resourceId: 'foreign-source' }),
        expect.objectContaining({ kind: 'DISPATCH_EVENT_CARDINALITY', resourceId: 'foreign-source' }),
      ]),
    );
  });
});
