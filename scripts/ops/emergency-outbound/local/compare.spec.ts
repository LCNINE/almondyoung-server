import { absoluteProblems, assertLocal, diffShapes, shapeOf, type ShipmentFacts } from './compare';

const TRACKING = '900000009999';

// 정식 경로로 나간 상자 하나의 사실. 값은 가짜다
function facts(over: Partial<ShipmentFacts> = {}): ShipmentFacts {
  return {
    shipmentId: 'shp-a',
    status: 'shipped',
    lines: [
      { id: 'line-a1', fulfillmentOrderItemId: 'foi-a1', skuId: 'sku-a1', qty: 2, forced: false },
      { id: 'line-a2', fulfillmentOrderItemId: 'foi-a2', skuId: 'sku-a2', qty: 1, forced: false },
    ],
    attempts: [{ id: 'att-a', kind: 'warehouse', status: 'dispatched', dispatchedAt: '2026-11-18T01:00:00Z' }],
    waybill: { id: 'wb-a', source: 'carrier', status: 'used', trackingNo: TRACKING },
    shipEvents: [
      {
        id: 'ev-a1',
        skuId: 'sku-a1',
        transitionType: 'SHIP',
        fromState: 'ON_HAND',
        toState: null,
        fromLocationId: 'loc-a',
        quantity: 2,
        linkedToSource: true,
        occurredAt: '2026-11-18T01:00:00Z',
        actorId: 'actor-a',
      },
      {
        id: 'ev-a2',
        skuId: 'sku-a2',
        transitionType: 'SHIP',
        fromState: 'ON_HAND',
        toState: null,
        fromLocationId: 'loc-b',
        quantity: 1,
        linkedToSource: true,
        occurredAt: '2026-11-18T01:00:00Z',
        actorId: 'actor-a',
      },
    ],
    foItems: [
      { id: 'foi-a1', skuId: 'sku-a1', qty: 2, shippedQty: 2, status: 'completed' },
      { id: 'foi-a2', skuId: 'sku-a2', qty: 1, shippedQty: 1, status: 'completed' },
    ],
    outbox: [
      { id: 1, topic: 'shipments.events.v1', eventType: 'ShipmentShipped', createdAt: '2026-11-18T01:00:00Z' },
      { id: 2, topic: 'fulfillments.events.v1', eventType: 'FulfillmentShipped', createdAt: '2026-11-18T01:00:00Z' },
      { id: 3, topic: 'fulfillments.events.v1', eventType: 'FulfillmentShipped', createdAt: '2026-11-18T01:00:01Z' },
    ],
    medusa: {
      orderId: 'order_a',
      fulfillments: [],
      projection: {
        shippingStatus: 'shipped',
        trackingNumber: TRACKING,
        attempts: [{ dispatchAttemptId: 'att-a', status: 'shipped', trackingNo: TRACKING }],
      },
    },
    ...over,
  };
}

// 비상 경로로 나간 다른 상자 — id·시각·작업자·forced 만 다르다
function otherBoxSameRecords(): ShipmentFacts {
  const tracking = '900000001234';
  return facts({
    shipmentId: 'shp-b',
    lines: [
      { id: 'line-b1', fulfillmentOrderItemId: 'foi-b1', skuId: 'sku-b1', qty: 2, forced: true },
      { id: 'line-b2', fulfillmentOrderItemId: 'foi-b2', skuId: 'sku-b2', qty: 1, forced: true },
    ],
    attempts: [{ id: 'att-b', kind: 'warehouse', status: 'dispatched', dispatchedAt: '2026-11-18T09:00:00Z' }],
    waybill: { id: 'wb-b', source: 'carrier', status: 'used', trackingNo: tracking },
    shipEvents: [
      {
        id: 'ev-b1',
        skuId: 'sku-b1',
        transitionType: 'SHIP',
        fromState: 'ON_HAND',
        toState: null,
        fromLocationId: 'loc-z',
        quantity: 2,
        linkedToSource: true,
        occurredAt: '2026-11-18T09:00:00Z',
        actorId: 'actor-b',
      },
      {
        id: 'ev-b2',
        skuId: 'sku-b2',
        transitionType: 'SHIP',
        fromState: 'ON_HAND',
        toState: null,
        fromLocationId: 'loc-y',
        quantity: 1,
        linkedToSource: true,
        occurredAt: '2026-11-18T09:00:00Z',
        actorId: 'actor-b',
      },
    ],
    foItems: [
      { id: 'foi-b1', skuId: 'sku-b1', qty: 2, shippedQty: 2, status: 'completed' },
      { id: 'foi-b2', skuId: 'sku-b2', qty: 1, shippedQty: 1, status: 'completed' },
    ],
    outbox: [
      // 종류별 개수까지 본다(multiset) — 정식과 같은 순서일 필요는 없지만 FulfillmentShipped 는 정식처럼 2행이다
      { id: 91, topic: 'fulfillments.events.v1', eventType: 'FulfillmentShipped', createdAt: '2026-11-18T09:00:00Z' },
      { id: 92, topic: 'shipments.events.v1', eventType: 'ShipmentShipped', createdAt: '2026-11-18T09:00:00Z' },
      { id: 93, topic: 'fulfillments.events.v1', eventType: 'FulfillmentShipped', createdAt: '2026-11-18T09:00:01Z' },
    ],
    medusa: {
      orderId: 'order_b',
      fulfillments: [],
      projection: {
        shippingStatus: 'shipped',
        trackingNumber: tracking,
        attempts: [{ dispatchAttemptId: 'att-b', status: 'shipped', trackingNo: tracking }],
      },
    },
  });
}

describe('shapeOf', () => {
  it('ignores ids, timestamps and actor', () => {
    const normal = shapeOf(facts());
    const emergency = shapeOf(otherBoxSameRecords());
    expect(emergency).toEqual(normal);
    expect(diffShapes(normal, emergency)).toEqual([]);
    expect(JSON.stringify(normal)).not.toMatch(/shp-|att-|ev-|foi-|sku-|loc-|actor-|order_|2026-|9000000/);
  });

  it('differs when a SHIP row is missing', () => {
    const base = facts();
    const missing = facts({ shipEvents: base.shipEvents.slice(0, 1) });
    const fields = diffShapes(shapeOf(base), shapeOf(missing)).map((d) => d.field);
    expect(fields).toContain('ship.qtyMatchesLines');
  });

  it('differs when Medusa has no tracking number', () => {
    const base = facts();
    const noTracking = facts({
      medusa: {
        orderId: 'order_a',
        fulfillments: [],
        projection: {
          shippingStatus: 'shipped',
          trackingNumber: null,
          attempts: [{ dispatchAttemptId: 'att-a', status: 'shipped', trackingNo: null }],
        },
      },
    });
    const fields = diffShapes(shapeOf(base), shapeOf(noTracking)).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['medusa.projectionTracking', 'medusa.attemptTracking']));
  });
});

describe('diffShapes', () => {
  it('flags a status difference', () => {
    const fields = diffShapes(shapeOf(facts()), shapeOf(facts({ status: 'planned' }))).map((d) => d.field);
    expect(fields).toContain('status');
  });

  it('counts outbox kinds (multiset), not just a set', () => {
    const base = facts();
    const oneLess = facts({ outbox: base.outbox.slice(0, 2) });
    const fields = diffShapes(shapeOf(base), shapeOf(oneLess)).map((d) => d.field);
    expect(fields).toContain('outbox');
  });
});

describe('absoluteProblems', () => {
  it('passes a fully shipped box', () => {
    expect(absoluteProblems(shapeOf(facts()))).toEqual([]);
  });

  it('fails a box that is not shipped', () => {
    expect(absoluteProblems(shapeOf(facts({ status: 'planned' })))).toEqual([expect.stringContaining('status')]);
  });

  it('fails a box with no SHIP rows', () => {
    expect(absoluteProblems(shapeOf(facts({ shipEvents: [] })))).toEqual([expect.stringContaining('SHIP')]);
  });

  it('fails a box whose FOI shipped_qty does not match its lines', () => {
    const base = facts();
    const foItems = base.foItems.map((i) => ({ ...i, shippedQty: 0 }));
    expect(absoluteProblems(shapeOf(facts({ foItems })))).toEqual([expect.stringContaining('FOI')]);
  });

  it('fails a box with no waybill', () => {
    expect(absoluteProblems(shapeOf(facts({ waybill: null })))).toEqual(
      expect.arrayContaining([expect.stringContaining('송장')]),
    );
  });

  it('fails an empty outbox unless --allow-empty-outbox', () => {
    const shape = shapeOf(facts({ outbox: [] }));
    expect(absoluteProblems(shape)).toEqual([expect.stringContaining('outbox')]);
    expect(absoluteProblems(shape, { allowEmptyOutbox: true })).toEqual([]);
  });

  it('fails a Medusa-linked box without projection unless --allow-no-medusa', () => {
    const base = facts();
    const shape = shapeOf(
      facts({ medusa: { ...base.medusa!, projection: { shippingStatus: null, trackingNumber: null, attempts: [] } } }),
    );
    expect(absoluteProblems(shape)).toEqual([expect.stringContaining('Medusa')]);
    expect(absoluteProblems(shape, { allowNoMedusa: true })).toEqual([]);
  });

  it('fails a Medusa projection whose tracking number is not the waybill', () => {
    const base = facts();
    const shape = shapeOf(
      facts({
        medusa: {
          ...base.medusa!,
          projection: {
            ...base.medusa!.projection,
            attempts: [{ dispatchAttemptId: 'att-a', status: 'shipped', trackingNo: '900000000000' }],
          },
        },
      }),
    );
    expect(absoluteProblems(shape)).toEqual([expect.stringContaining('Medusa')]);
  });

  it('does not require Medusa when the order is not a Medusa order', () => {
    expect(absoluteProblems(shapeOf(facts({ medusa: null })))).toEqual([]);
  });
});

describe('assertLocal', () => {
  it.each(['postgresql://u:p@localhost:5432/dev_core', 'postgresql://u:p@127.0.0.1:5432/medusa'])(
    'accepts %s',
    (url) => {
      expect(assertLocal(url, 'core')).toEqual({ host: new URL(url).hostname, port: 5432 });
    },
  );

  it('rejects a remote host', () => {
    expect(() => assertLocal('postgresql://u:p@db.example.com:5432/dev_core', 'core')).toThrow('로컬 전용');
  });

  it('rejects a multi-host URL (postgres.js would try the second host)', () => {
    expect(() => assertLocal('postgresql://u:p@localhost,db.example.com:5432/dev_core', 'core')).toThrow('로컬 전용');
  });

  it.each(['host', 'hostaddr', 'port'])('rejects a ?%s= search param that would redirect the connection', (param) => {
    expect(() => assertLocal(`postgresql://u:p@localhost:5432/dev_core?${param}=db.example.com`, 'core')).toThrow(
      param,
    );
  });
});
