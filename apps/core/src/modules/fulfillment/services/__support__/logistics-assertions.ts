import { and, eq } from 'drizzle-orm';
import { wmsTables, wmsViews, DbTx } from '../../../inventory/schema/inventory.schema';

// 부호 맵: 우리 시나리오가 만드는 이벤트는 RECEIVE(+)·SHIP(-) 뿐. (일반화하려면 DEFECTIVE 계열 추가 필요.)
const EVENT_SIGN: Record<string, number> = {
  RECEIVE: 1,
  ADJUST_UP: 1,
  SHIP: -1,
  ADJUST_DOWN: -1,
  SCRAP: -1,
};

export async function onHand(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const rows = await tx
    .select({ qty: wmsTables.stockLedgers.qty })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  return rows.reduce((s, r) => s + r.qty, 0);
}

export async function onHandAt(tx: DbTx, skuId: string, locationId: string): Promise<number> {
  const [row] = await tx
    .select({ qty: wmsTables.stockLedgers.qty })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.locationId, locationId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  return row?.qty ?? 0;
}

export async function availableFromView(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const [row] = await tx
    .select({ availableQty: wmsViews.stockSummary.availableQty })
    .from(wmsViews.stockSummary)
    .where(and(eq(wmsViews.stockSummary.skuId, skuId), eq(wmsViews.stockSummary.warehouseId, warehouseId)));
  return row?.availableQty ?? 0;
}

export async function confirmedReserved(tx: DbTx, skuId: string, warehouseId: string): Promise<number> {
  const rows = await tx
    .select({ q: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.skuId, skuId),
        eq(wmsTables.stockReservations.warehouseId, warehouseId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  return rows.reduce((s, r) => s + r.q, 0);
}

// I1 기반: sku 의 stock_events 를 부호합. (단일 창고 전제 — 본 스펙 월드가 그러함.)
export async function netFromEvents(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ t: wmsTables.stockEvents.transitionType, q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(eq(wmsTables.stockEvents.skuId, skuId));
  return rows.reduce((s, r) => s + (EVENT_SIGN[r.t as string] ?? 0) * r.q, 0);
}

export async function sumReceived(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ t: wmsTables.stockEvents.transitionType, q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(eq(wmsTables.stockEvents.skuId, skuId));
  return rows.filter((r) => r.t === 'RECEIVE' || r.t === 'ADJUST_UP').reduce((s, r) => s + r.q, 0);
}

export async function sumShipped(tx: DbTx, skuId: string): Promise<number> {
  const rows = await tx
    .select({ q: wmsTables.stockEvents.quantity })
    .from(wmsTables.stockEvents)
    .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
  return rows.reduce((s, r) => s + r.q, 0);
}

// I1(이벤트↔원장) + I2(가용 항등) + 골든값 을 한 번에.
export async function assertStockConsistent(
  tx: DbTx,
  args: { skuId: string; warehouseId: string; onHand: number; reserved: number },
): Promise<void> {
  const oh = await onHand(tx, args.skuId, args.warehouseId);
  expect(oh).toBe(args.onHand); // 골든값
  expect(await netFromEvents(tx, args.skuId)).toBe(oh); // I1
  expect(await confirmedReserved(tx, args.skuId, args.warehouseId)).toBe(args.reserved);
  expect(await availableFromView(tx, args.skuId, args.warehouseId)).toBe(oh - args.reserved); // I2
}

// I3(예약 3중 합): FO.totalReservedQty == Σ FOI.reservedQty == Σ confirmed 예약(targetId=FO).
export async function assertFoReservationAgg(tx: DbTx, fulfillmentOrderId: string): Promise<void> {
  const [fo] = await tx
    .select({ total: wmsTables.fulfillmentOrders.totalReservedQty })
    .from(wmsTables.fulfillmentOrders)
    .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  const fois = await tx
    .select({ r: wmsTables.fulfillmentOrderItems.reservedQty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
  const foiSum = fois.reduce((s, r) => s + r.r, 0);
  const resRows = await tx
    .select({ q: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.targetId, fulfillmentOrderId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  const resSum = resRows.reduce((s, r) => s + r.q, 0);
  expect(fo.total).toBe(foiSum);
  expect(fo.total).toBe(resSum);
}

// I6(물질보존): 골든 received/shipped 와 이벤트합·원장을 교차 확인. received == onHand + shipped.
export async function assertConservation(
  tx: DbTx,
  args: { skuId: string; warehouseId: string; received: number; shipped: number },
): Promise<void> {
  const oh = await onHand(tx, args.skuId, args.warehouseId);
  expect(await sumReceived(tx, args.skuId)).toBe(args.received);
  expect(await sumShipped(tx, args.skuId)).toBe(args.shipped);
  expect(args.received).toBe(oh + args.shipped);
}
