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
  waybills: [{ id: 'waybill-1', shipmentId: 'shipment-1', manifestVersion: 3, status: 'registered' }],
  sessions: [
    {
      id: 'session-1',
      batchId: 'batch-1',
      handedInQty: 7,
      handedBackQty: 0,
      settledQty: 2,
      returnedQty: 1,
      shortageQty: 1,
    },
  ],
  sessionBalances: [
    {
      id: 'balance-1',
      sessionId: 'session-1',
      custodyType: 'PACKING',
      qty: 3,
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      shipmentLineId: 'line-1',
    },
  ],
  batches: [{ id: 'batch-1', startedAt: new Date('2026-09-30T00:00:00Z') }],
  workItems: [{ id: 'wi-1', batchId: 'batch-1', shipmentId: 'shipment-1', status: 'completed' }],
  allocations: [
    {
      id: 'alloc-1',
      workItemId: 'wi-1',
      batchId: 'batch-1',
      shipmentLineId: 'line-1',
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      qty: 7,
    },
  ],
  dispatchAttempts: [],
  dispatchSources: [],
  stockEvents: [],
});

describe('collectFulfillmentInvariantViolations', () => {
  it('accepts a conserved snapshot', () => {
    expect(collectFulfillmentInvariantViolations(validSnapshot())).toEqual([]);
  });

  it('detects FOI active-line, planned reservation, waybill and session drift together', () => {
    const snapshot = validSnapshot();
    snapshot.shipmentLines[0].qty = 6;
    snapshot.shipments[0].status = 'planned';
    snapshot.waybills[0].manifestVersion = 2;
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

  it('excludes only exact dispatch-recall quarantine from active outstanding demand', () => {
    const recall = validSnapshot();
    recall.fulfillmentOrderItems[0] = {
      ...recall.fulfillmentOrderItems[0],
      qty: 7,
      shippedQty: 7,
      canceledQty: 0,
    };
    recall.shipmentLines[0].qty = 7;
    recall.shipments[0] = {
      ...recall.shipments[0],
      status: 'recovery_required',
      recoveryCode: 'DISPATCH_RECALL_PENDING',
    };
    recall.reservations = [];
    expect(collectFulfillmentInvariantViolations(recall)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ACTIVE_LINE_QUANTITY' })]),
    );

    recall.shipments[0].recoveryCode = 'SHORT_PICK_PENDING';
    expect(collectFulfillmentInvariantViolations(recall)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ACTIVE_LINE_QUANTITY' })]),
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

describe('배정 불변식 I1~I3 (스펙 §5)', () => {
  const kinds = (snapshot: FulfillmentInvariantSnapshot) =>
    collectFulfillmentInvariantViolations(snapshot).map((violation) => violation.kind);

  it('I1 — 시작 안 된 배치의 작업 항목에 배정이 있으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.batches[0].startedAt = null;
    snapshot.workItems[0].status = 'queued';
    expect(kinds(snapshot)).toContain('ALLOCATION_BEFORE_START');
  });

  it('I2 — 시작된 배치의 활성 작업 항목은 줄마다 배정 ≥ 줄 수량', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'picking';
    snapshot.allocations[0].qty = 6;
    expect(kinds(snapshot)).toContain('ALLOCATION_BELOW_TARGET');
    snapshot.allocations[0].qty = 9; // 초과(«뺄 물건 남음»)는 위반이 아니다
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I2 — 완료·제외된 작업 항목은 보지 않는다(반납으로 0 이 된 행 포함)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].qty = 0;
    snapshot.sessionBalances = [];
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I2 — 이탈 중(withdrawing)은 목표가 0 이라 보지 않는다', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'withdrawing';
    snapshot.allocations[0].qty = 3;
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I3 — 공유 보관은 배치의 모든 작업 항목 배정과 견준다(PR 4: 나간 작업 항목의 배정은 0 이라 방을 보태지 않는다)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].qty = 0; // 반납·되돌림·부족 승인이 모두 배정을 줄인다
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 2,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 2, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 제외된 작업 항목에 남은 배정도 방으로 센다(옛 결품 행 — 배포 전 SQL 이 열린 세션에 없음을 확인)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].qty = 2;
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 2,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 2, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).not.toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 활성 작업 항목의 배정이 덮으면 같은 AT_SOURCE 는 위반이 아니다', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'queued';
    snapshot.allocations[0].qty = 7;
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 7,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 7, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).not.toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 줄 귀속 보관이 그 줄·로케이션 배정을 넘으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.sessionBalances[0].qty = 8;
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 공유 보관(AT_SOURCE·BULK_CART)이 (배정 − 귀속 보관) 합을 넘으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.sessionBalances.push({
      id: 'balance-2',
      sessionId: 'session-1',
      custodyType: 'AT_SOURCE',
      qty: 5,
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      shipmentLineId: null,
    });
    // 배정 7 − 귀속 3 = 4 < 5
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('보존식은 반납을 센다', () => {
    const snapshot = validSnapshot();
    snapshot.sessions[0].handedInQty = 9;
    snapshot.sessions[0].handedBackQty = 2;
    expect(kinds(snapshot)).not.toContain('SESSION_CONSERVATION');
  });
});
