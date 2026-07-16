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

// 주의: stock_summary_view 는 materialized 아닌 live VIEW 라 availableFromView 는 매 호출마다
// on_hand − reserved − transit_out 을 base table 에서 즉시 재계산한다. 즉 이 값을 쓰는 I2 검증은
// "뷰 산술 회귀 + transit_out=0 전제"만 잡고 base-table/projection drift 는 잡지 못한다 — 진짜
// drift 검출은 I1(netFromEvents == onHand)이 담당한다.
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
  expect(await availableFromView(tx, args.skuId, args.warehouseId)).toBe(oh - args.reserved); // I2 — live VIEW 재계산 검증, base-table drift 는 미검출(위 availableFromView 주석 참고)
}

// sumReceived/sumShipped 가 실제로 커버하는 이벤트 타입. 이 밖의 타입(ADJUST_DOWN/SCRAP 등)이
// 섞이면 두 합계에서 조용히 누락되어 보존식이 거짓으로 통과할 수 있다 — assertConservation 가드용.
const CONSERVATION_COVERED_TYPES = new Set(['RECEIVE', 'ADJUST_UP', 'SHIP']);

// I6(물질보존): 골든 received/shipped 와 이벤트합·원장을 교차 확인. received == onHand + shipped.
export async function assertConservation(
  tx: DbTx,
  args: { skuId: string; warehouseId: string; received: number; shipped: number },
): Promise<void> {
  // 가드: sumReceived 는 RECEIVE+ADJUST_UP, sumShipped 는 SHIP 만 센다. 이 sku 에 그 밖의
  // transitionType(ADJUST_DOWN/SCRAP 등)이 하나라도 발생했다면 보존식이 조용히 깨질 수 있으므로,
  // 본 검증 전에 발생한 타입이 커버 집합 밖으로 새지 않았는지 먼저 확인한다. 현재 스위트는
  // RECEIVE/SHIP 만 생성하므로 이 가드는 no-op 이지만, 향후 회귀를 미리 막는다.
  const typeRows = await tx
    .selectDistinct({ t: wmsTables.stockEvents.transitionType })
    .from(wmsTables.stockEvents)
    .where(eq(wmsTables.stockEvents.skuId, args.skuId));
  const uncovered = typeRows.map((r) => r.t as string).filter((t) => !CONSERVATION_COVERED_TYPES.has(t));
  expect(uncovered).toEqual([]);

  const oh = await onHand(tx, args.skuId, args.warehouseId);
  expect(await sumReceived(tx, args.skuId)).toBe(args.received);
  expect(await sumShipped(tx, args.skuId)).toBe(args.shipped);
  expect(args.received).toBe(oh + args.shipped);
}
