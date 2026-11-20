import { UnshippedOrderRow, unshippedOrders } from './unshipped-orders';

const now = new Date('2026-11-18T15:00:00Z');
const base: UnshippedOrderRow = {
  fulfillmentOrderItemId: 'item-1',
  salesOrderId: 'order-1',
  orderNo: '3900',
  channelName: 'Test shop',
  orderDate: new Date('2026-11-18T14:59:59Z'),
  createdAt: new Date('2026-11-17T00:00:00Z'),
  customerName: '테스트주문자',
  remainingQuantity: 5,
  reservedQuantity: 5,
  shipmentStatus: null,
  shipmentQuantity: null,
  inspectedQuantity: null,
};

function item(overrides: Partial<UnshippedOrderRow> = {}) {
  return unshippedOrders([{ ...base, ...overrides }], now)[0];
}

describe('unshipped order mapping', () => {
  it('counts KST calendar boundaries even when only one second elapsed', () => {
    expect(item()).toMatchObject({ orderedAt: base.orderDate?.toISOString(), delayDays: 1 });
    expect(item({ orderDate: new Date('2026-11-18T15:00:00Z') }).delayDays).toBe(0);
    expect(item({ orderDate: new Date('2026-11-20T01:00:00Z') }).delayDays).toBe(0);
  });

  it('uses FO.createdAt and nullable display fields for standalone fulfillment', () => {
    expect(
      item({ orderDate: null, salesOrderId: null, orderNo: null, customerName: null, channelName: null }),
    ).toMatchObject({
      orderedAt: base.createdAt.toISOString(),
      delayDays: 2,
      salesOrderId: null,
      orderNo: null,
      customerName: null,
      channelName: null,
    });
  });

  it.each([
    [0, false],
    [4, false],
    [5, true],
    [6, true],
  ])('canShip uses FOI reserved quantity %i', (reservedQuantity, canShip) => {
    expect(item({ reservedQuantity }).canShip).toBe(canShip);
  });

  it('returns no rows for no demand', () => {
    expect(unshippedOrders([], now)).toEqual([]);
  });

  it('marks missing or partially assigned boxes as not_boxed', () => {
    expect(item().progress).toBe('not_boxed');
    expect(item({ shipmentStatus: 'planned', shipmentQuantity: 4, inspectedQuantity: 4 }).progress).toBe('not_boxed');
  });

  it.each<NonNullable<UnshippedOrderRow['shipmentStatus']>>([
    'canceled',
    'superseded',
    'shipped',
    'in_transit',
    'delivered',
    'failed',
  ])('ignores %s shipment history for remaining demand', (shipmentStatus) => {
    expect(item({ shipmentStatus, shipmentQuantity: 5, inspectedQuantity: 5 }).progress).toBe('not_boxed');
  });

  it.each<NonNullable<UnshippedOrderRow['shipmentStatus']>>(['draft', 'planned'])(
    'derives inspection progress for %s boxes',
    (shipmentStatus) => {
      expect(item({ shipmentStatus, shipmentQuantity: 5, inspectedQuantity: 0 }).progress).toBe('waiting');
      expect(item({ shipmentStatus, shipmentQuantity: 5, inspectedQuantity: 2 }).progress).toBe('inspecting');
      expect(item({ shipmentStatus, shipmentQuantity: 5, inspectedQuantity: 5 }).progress).toBe('inspected');
    },
  );

  it('folds split boxes once per FOI, keeps input order, and never adds FOI quantities twice', () => {
    const rows: UnshippedOrderRow[] = [
      { ...base, shipmentStatus: 'planned', shipmentQuantity: 3, inspectedQuantity: 3 },
      { ...base, shipmentStatus: 'draft', shipmentQuantity: 2, inspectedQuantity: 0 },
      { ...base, shipmentStatus: 'superseded', shipmentQuantity: 5, inspectedQuantity: 5 },
      { ...base, fulfillmentOrderItemId: 'item-2' },
    ];
    const items = unshippedOrders(rows, now);

    expect(items.map((row) => row.fulfillmentOrderItemId)).toEqual(['item-1', 'item-2']);
    expect(items[0]).toMatchObject({ remainingQuantity: 5, reservedQuantity: 5, progress: 'inspecting' });
    expect(items[0]).not.toHaveProperty('shipmentStatus');

    rows[1].inspectedQuantity = 2;

    expect(unshippedOrders(rows, now)[0].progress).toBe('inspected');

    rows[1].shipmentStatus = 'recovery_required';
    rows[1].shipmentQuantity = 1;

    expect(unshippedOrders(rows, now)[0].progress).toBe('recovery_required');
  });
});
