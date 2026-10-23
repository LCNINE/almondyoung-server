import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  seedBox,
  seedFo,
  seedOrder,
  seedWorld,
} from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import {
  inRollbackTx,
  makeDb,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import {
  seedCancellableOrder,
  seedShippedBeforeBoxingFulfillment,
  wireCancellation,
} from '../cancellation-record/__support__/cancellation-scenarios';
import { recallParcel, seedDispatchedParcel } from './__support__/shipment-facts.fixtures';
import { LineQuantities, LineSkuQuantities, readLineQuantities } from './line-quantities.reader';
import { lineCanceledQuantitySql, lineDemandSql, lineRemainingSql, lineSkuQuantitiesSql } from './line-quantities.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Expected = [ordered: number, before: number, after: number, canceled: number, demand: number, remaining: number];

/** 2a 시나리오는 라인 칸만 단언한다(`toMatchObject`) — SKU 층은 아래 SKU 시나리오가 본다. 교차 검사는 둘 다 받는다. */
function quantities(
  salesOrderLineId: string,
  [ordered, before, after, canceled, demand, remaining]: Expected,
): Omit<LineQuantities, 'skus'> {
  return {
    salesOrderLineId,
    ordered,
    canceledBeforeShipment: before,
    canceledAfterShipment: after,
    canceled,
    demand,
    remaining,
  };
}

type SkuExpected = [
  required: number,
  shipped: number,
  forwarded: number,
  delivered: number,
  partnerCompleted: number,
  outstanding: number,
];

/**
 * 2b 시나리오에는 청구도 출고 뒤 취소도 없다 — 청구 칸은 0, `claimable` 은 구성 안 SKU 면 배송완료 그대로, 구성 밖이면 0(N4).
 * 청구 사실은 `claim-facts.integration.spec.ts` 가 본다.
 */
function skuQuantities(
  skuId: string,
  qtyPerUnit: number | null,
  [required, shipped, forwarded, delivered, partnerCompleted, outstanding]: SkuExpected,
): LineSkuQuantities {
  return {
    skuId,
    qtyPerUnit,
    required,
    shipped,
    forwarded,
    delivered,
    partnerCompleted,
    outstanding,
    returnActive: 0,
    returnConsumed: 0,
    exchangeActive: 0,
    claimable: qtyPerUnit === null ? 0 : delivered,
  };
}

type SkuRow = {
  sales_order_id: string;
  sales_order_line_id: string;
  sku_id: string;
  qty_per_unit: number | null;
  required: number;
  shipped: number;
  forwarded: number;
  delivered: number;
  partner_completed: number;
  outstanding: number;
  return_active: number;
  return_consumed: number;
  exchange_active: number;
  claimable: number;
};

/** (나) SKU 층 — 문과 다른 범위 모양(주문 테이블 select)으로 조각을 직접 select 하고 여기서 라인별로 묶는다. */
async function readSkusDirectly(tx: DbTx, salesOrderId: string): Promise<Map<string, LineSkuQuantities[]>> {
  const rows = await tx.execute<SkuRow>(
    lineSkuQuantitiesSql(sql`select so.id from ${wmsTables.salesOrders} as so where so.id = ${salesOrderId}`),
  );
  const byLine = new Map<string, LineSkuQuantities[]>();
  for (const row of [...rows].sort((a, b) => (a.sku_id < b.sku_id ? -1 : 1))) {
    expect(row.sales_order_id).toBe(salesOrderId);
    byLine.set(row.sales_order_line_id, [
      ...(byLine.get(row.sales_order_line_id) ?? []),
      {
        skuId: row.sku_id,
        qtyPerUnit: row.qty_per_unit,
        required: row.required,
        shipped: row.shipped,
        forwarded: row.forwarded,
        delivered: row.delivered,
        partnerCompleted: row.partner_completed,
        outstanding: row.outstanding,
        returnActive: row.return_active,
        returnConsumed: row.return_consumed,
        exchangeActive: row.exchange_active,
        claimable: row.claimable,
      },
    ]);
  }
  return byLine;
}

/**
 * (나) 문을 거치지 않고 조각만으로 — 주문에서 라인으로 들어가는 다른 조인 모양 — 같은 값을 구한다.
 * 문과 이 쿼리가 갈리면 조각이 바깥 쿼리 모양에 따라 다르게 풀린다는 뜻이다.
 */
async function readDirectly(tx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>> {
  const sol = wmsTables.salesOrderLines;
  const so = wmsTables.salesOrders;
  const skus = await readSkusDirectly(tx, salesOrderId);
  const rows = await tx
    .select({
      salesOrderLineId: sol.id,
      ordered: sol.quantity,
      canceledBeforeShipment: lineCanceledQuantitySql(sol.id, 'before_shipment'),
      canceledAfterShipment: lineCanceledQuantitySql(sol.id, 'after_shipment'),
      canceled: lineCanceledQuantitySql(sol.id, 'any'),
      demand: lineDemandSql(sol.quantity, sol.id),
      remaining: lineRemainingSql(sol.quantity, sol.id),
    })
    .from(so)
    .innerJoin(sol, eq(sol.salesOrderId, so.id))
    .where(eq(so.id, salesOrderId));
  return new Map(rows.map((row) => [row.salesOrderLineId, { ...row, skus: skus.get(row.salesOrderLineId) ?? [] }]));
}

/** (가)·(나) — 문의 결과를 돌려주고, 문을 거치지 않은 결과와 같은지 본다. */
async function readAndCrossCheck(tx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>> {
  const read = await readLineQuantities(tx, salesOrderId);
  expect(await readDirectly(tx, salesOrderId)).toEqual(read);
  return read;
}

async function insertLine(
  tx: DbTx,
  salesOrderId: string,
  values: { quantity: number; fulfillmentKind?: 'digital'; requiresShipping?: boolean },
) {
  const [line] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId,
      variantId: randomUUID(),
      productName: values.fulfillmentKind === 'digital' ? 'IT Digital' : 'IT Product',
      unitPrice: 1000,
      ...values,
    })
    .returning();
  return line.id;
}

describeIfDb('readLineQuantities — 라인 수량은 취소 라인 행 한 곳에서 (K6 PR2a)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('no cancellations', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);

      const read = await readAndCrossCheck(tx, o.salesOrderId);

      expect([...read.values()]).toMatchObject([quantities(o.lineId, [3, 0, 0, 0, 3, 3])]);
    });
  });

  it('lines without cancellations appear with zeros', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      const untouchedLineId = await insertLine(tx, o.salesOrderId, { quantity: 1 });

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect(read.size).toBe(2);
      expect(read.get(o.lineId)).toMatchObject(quantities(o.lineId, [2, 1, 0, 1, 1, 1]));
      expect(read.get(untouchedLineId)).toMatchObject(quantities(untouchedLineId, [1, 0, 0, 0, 1, 1]));
    });
  });

  it('repeated partial before shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);

      for (let i = 0; i < 2; i += 1) {
        await w.salesOrders.cancel(
          o.salesOrderId,
          { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
          tx,
        );
      }

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect([...read.values()]).toMatchObject([quantities(o.lineId, [3, 2, 0, 2, 1, 1])]);
    });
  });

  it('partial after shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      await seedShippedBeforeBoxingFulfillment(tx, o, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      // 이미 나간 수량의 취소는 수요에서 빼지 않는다(E2) — demand 3, 더 취소할 수 있는 건 2.
      expect([...read.values()]).toMatchObject([quantities(o.lineId, [3, 0, 1, 1, 3, 2])]);
    });
  });

  it('bundle with one shipped component', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const { warehouseId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId: skuA } = await seedSku(tx, holderId);
      const { skuId: skuB } = await seedSku(tx, holderId);
      const variantId = randomUUID();
      const { matchingId } = await seedMatching(tx, { variantId, skuId: skuA, quantity: 1 });
      await tx
        .insert(wmsTables.productVariantSkuLinks)
        .values({ productMatchingId: matchingId, skuId: skuB, quantity: 1 });
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      const [lineId] = lineIds;
      // 상자 없는 옛(상자 전) FO — 세트 구성품 A 만 나갔다(FOI shipped_qty=1), B 는 아직.
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ salesOrderId, warehouseId, totalItems: 2, totalQty: 2 })
        .returning();
      await tx.insert(wmsTables.fulfillmentOrderItems).values([
        { fulfillmentOrderId: fo.id, salesOrderId, salesOrderLineId: lineId, skuId: skuA, qty: 1, shippedQty: 1 },
        { fulfillmentOrderId: fo.id, salesOrderId, salesOrderLineId: lineId, skuId: skuB, qty: 1 },
      ]);

      await w.salesOrders.cancel(
        salesOrderId,
        { lines: [{ salesOrderLineId: lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const read = await readAndCrossCheck(tx, salesOrderId);
      // 구성품이 하나라도 나간 판매 단위는 출고 후 취소다(PR 1 규칙) — 문은 라인 행을 재해석하지 않고 합한다.
      expect([...read.values()]).toMatchObject([quantities(lineId, [1, 0, 1, 1, 1, 0])]);
    });
  });

  it('상자 전 전체 after partial', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );
      await w.salesOrders.cancel(o.salesOrderId, { cancelledBy: 'naver' }, tx);

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect([...read.values()]).toMatchObject([quantities(o.lineId, [3, 3, 0, 3, 0, 0])]);
      // E1 — 전체취소의 라인 행까지 센다(옛 metadata 파서는 partial 만 세어 1 을 냈다).
      expect(read.get(o.lineId)?.canceled).toBe(3);
    });
  });

  it('상자 후 전체 with digital line', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      const digitalLineId = await insertLine(tx, o.salesOrderId, {
        quantity: 1,
        fulfillmentKind: 'digital',
        requiresShipping: false,
      });
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'customer', metadata: { sourceEventId: `self-${randomUUID()}` } },
        tx,
      );

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect(read.size).toBe(2);
      // 물리 라인은 상자에 남아 있던(outstanding) 2 를 모두 출고 전에 취소했다.
      expect(read.get(o.lineId)).toMatchObject(quantities(o.lineId, [2, 2, 0, 2, 0, 0]));
      expect(read.get(digitalLineId)).toMatchObject(quantities(digitalLineId, [1, 1, 0, 1, 0, 0]));
    });
  });
});

describeIfDb('readLineQuantities — SKU 층 출고·배송 사실 (K6 PR2b)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  /** 라인 하나의 SKU 층 — 문과 교차 검사를 거친 값. */
  async function skusOf(tx: DbTx, order: { salesOrderId: string; lineId: string }): Promise<LineSkuQuantities[]> {
    const read = await readAndCrossCheck(tx, order.salesOrderId);
    return read.get(order.lineId)?.skus ?? [];
  }

  async function setItem(tx: DbTx, foItemId: string, values: { shippedQty?: number; canceledQty?: number }) {
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set(values)
      .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
  }

  it('before fulfillment the sku layer is empty', async () => {
    await inRollbackTx(db, async (tx) => {
      await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect(read.get(o.lineId)?.skus).toEqual([]);
    });
  });

  it('operator composition before FO is empty', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      // FO 전 1회 지정(#1063 스펙 D1) — 실제 쓰기 문으로 구성을 굳힌다
      await new LineCompositionManager(ambientDbService(tx)).assignByOperator(
        o.lineId,
        [{ skuId: w.skuId, qtyPerUnit: 1 }],
        randomUUID(),
        tx,
      );
      const frozen = await tx
        .select({ id: wmsTables.salesOrderLineCompositions.id })
        .from(wmsTables.salesOrderLineCompositions)
        .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, o.lineId));
      expect(frozen).toHaveLength(1);

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      expect(read.get(o.lineId)?.skus).toEqual([]);
    });
  });

  it('fo created nothing shipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      await seedFo(tx, w, o, { qty: 2 });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [2, 0, 0, 0, 0, 2])]);
    });
  });

  it('dispatched parcel not yet delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      const { foItemId } = await seedFo(tx, w, o, { qty: 2 });
      const box = await seedBox(tx, w, [foItemId], { status: 'planned', qty: [2] });
      await seedDispatchedParcel(tx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId, qty: 2 }],
        delivered: false,
      });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [2, 2, 0, 0, 0, 0])]);
    });
  });

  it('delivered parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      const { foItemId } = await seedFo(tx, w, o, { qty: 2 });
      const box = await seedBox(tx, w, [foItemId], { status: 'planned', qty: [2] });
      await seedDispatchedParcel(tx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId, qty: 2 }],
        delivered: true,
      });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [2, 2, 0, 2, 0, 0])]);
    });
  });

  it('recalled attempt is neither shipped nor delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      const { foItemId } = await seedFo(tx, w, o, { qty: 2 });
      const box = await seedBox(tx, w, [foItemId], { status: 'planned', qty: [2] });
      const { dispatchAttemptId } = await seedDispatchedParcel(tx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId, qty: 2 }],
        delivered: true,
      });

      await recallParcel(tx, { dispatchAttemptId, lines: [{ foItemId, qty: 2 }] });

      // 추적 행은 남아 있다 — 배송완료는 시도가 `dispatched` 일 때만 센다
      const tracking = await tx
        .select({ id: wmsTables.shipmentTracking.id })
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, dispatchAttemptId));
      expect(tracking).toHaveLength(1);
      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [2, 0, 0, 0, 0, 2])]);
    });
  });

  it('split shipment one parcel delivered', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 3 });
      const { foItemId } = await seedFo(tx, w, o, { qty: 3 });
      const first = await seedBox(tx, w, [foItemId], { status: 'planned', qty: [2] });
      await seedBox(tx, w, [foItemId], { status: 'draft', qty: [1] });
      await seedDispatchedParcel(tx, w, {
        shipmentId: first.shipmentId,
        lines: [{ shipmentLineId: first.lineIds[0], foItemId, qty: 2 }],
        delivered: true,
      });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [3, 2, 0, 2, 0, 1])]);
    });
  });

  it('forwarded drop-ship moves but is not shipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx);
      await seedFo(tx, w, o, { dropShip: 'forwarded', qty: 1 });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [1, 0, 1, 0, 0, 1])]);
    });
  });

  it('completed drop-ship is shipped by partner', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx);
      const { foItemId } = await seedFo(tx, w, o, { dropShip: 'completed', qty: 1 });
      await setItem(tx, foItemId, { shippedQty: 1 });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [1, 1, 0, 0, 1, 0])]);
    });
  });

  it('cellmate marking is shipped without parcels', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx);
      const { foItemId } = await seedFo(tx, w, o, { qty: 1 });
      // 셀메이트 스크립트는 상자·소포 없이 FOI shipped_qty=qty 만 찍는다 — 배송완료는 «모름»(0)
      await setItem(tx, foItemId, { shippedQty: 1 });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [1, 1, 0, 0, 0, 0])]);
    });
  });

  it('상자 후 canceled quantity leaves required', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx, { quantity: 2 });
      const { foItemId } = await seedFo(tx, w, o, { qty: 2 });
      await setItem(tx, foItemId, { canceledQty: 1 });

      expect(await skusOf(tx, o)).toEqual([skuQuantities(w.skuId, 1, [1, 0, 0, 0, 0, 1])]);
    });
  });

  it('item of another order pointing at the line is not counted', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const a = await seedOrder(tx);
      const b = await seedOrder(tx);
      const aFo = await seedFo(tx, w, a, { qty: 1 });
      await seedFo(tx, w, b, { qty: 1 });
      // 주문 A 의 FO 에 주문 B 의 라인을 가리키는 FOI — 키 갈래가 거르는 모양을 사실 갈래도 걸러야 한다
      await tx.insert(wmsTables.fulfillmentOrderItems).values({
        fulfillmentOrderId: aFo.foId,
        salesOrderId: a.salesOrderId,
        salesOrderLineId: b.lineId,
        skuId: w.skuId,
        qty: 5,
      });

      // 두 주문을 한 범위로 읽어야 FO 범위 필터만으로는 못 거른다
      const rows = await tx.execute<SkuRow>(
        lineSkuQuantitiesSql(
          sql`select so.id from ${wmsTables.salesOrders} as so where so.id in (${a.salesOrderId}, ${b.salesOrderId})`,
        ),
      );
      const bRow = [...rows].find((row) => row.sales_order_line_id === b.lineId);
      expect(bRow?.required).toBe(1);
      expect(bRow?.outstanding).toBe(1);
    });
  });

  it('composition sku without an item appears with zeros', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const o = await seedOrder(tx);
      await seedFo(tx, w, o, { qty: 1 });
      const [skuB] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'op-sku-b', code: `OP-${randomUUID().toUpperCase()}`, holderId: w.holderId })
        .returning();
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: o.lineId, skuId: skuB.id, qtyPerUnit: 1 });

      const skus = await skusOf(tx, o);
      expect(skus).toHaveLength(2);
      expect(skus.find((sku) => sku.skuId === w.skuId)).toEqual(skuQuantities(w.skuId, 1, [1, 0, 0, 0, 0, 1]));
      expect(skus.find((sku) => sku.skuId === skuB.id)).toEqual(skuQuantities(skuB.id, 1, [0, 0, 0, 0, 0, 0]));
    });
  });
});
