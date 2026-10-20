import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../fulfillment/services/__support__';
import { sumCancelledByLine } from '../../product-matching/line-composition/partial-cancellation';
import {
  seedCancellableOrder,
  seedShippedV1Fulfillment,
  wireCancellation,
} from '../cancellation-record/__support__/cancellation-scenarios';
import { LineQuantities, readLineQuantities } from './line-quantities.reader';
import { lineCanceledQuantitySql, lineDemandSql, lineRemainingSql } from './line-quantities.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Expected = [ordered: number, before: number, after: number, canceled: number, demand: number, remaining: number];

function quantities(
  salesOrderLineId: string,
  [ordered, before, after, canceled, demand, remaining]: Expected,
): LineQuantities {
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

/**
 * (나) 문을 거치지 않고 조각만으로 — 주문에서 라인으로 들어가는 다른 조인 모양 — 같은 값을 구한다.
 * 문과 이 쿼리가 갈리면 조각이 바깥 쿼리 모양에 따라 다르게 풀린다는 뜻이다.
 */
async function readDirectly(tx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>> {
  const sol = wmsTables.salesOrderLines;
  const so = wmsTables.salesOrders;
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
  return new Map(rows.map((row) => [row.salesOrderLineId, row]));
}

/** (가)·(나) — 문의 결과를 돌려주고, 문을 거치지 않은 결과와 같은지 본다. */
async function readAndCrossCheck(tx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>> {
  const read = await readLineQuantities(tx, salesOrderId);
  expect(await readDirectly(tx, salesOrderId)).toEqual(read);
  return read;
}

/** (다) 옛 정의 — 그 주문 partial 취소의 metadata.cancelledLines 합. */
async function legacyCancelledByLine(tx: DbTx, salesOrderId: string): Promise<Map<string, number>> {
  const partials = await tx
    .select({ metadata: wmsTables.salesOrderCancellations.metadata })
    .from(wmsTables.salesOrderCancellations)
    .where(
      and(
        eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
        eq(wmsTables.salesOrderCancellations.cancellationScope, 'partial'),
      ),
    );
  return sumCancelledByLine(partials.map((partial) => partial.metadata));
}

/** (다) 전체취소가 없는 주문에서는 옛 정의와 새 정의(`canceled`)가 같다 — 소비자 전환이 동작을 안 바꾼다. */
async function expectLegacyAgrees(tx: DbTx, salesOrderId: string, read: Map<string, LineQuantities>) {
  const legacy = await legacyCancelledByLine(tx, salesOrderId);
  for (const [lineId, line] of read) {
    expect({ lineId, canceled: legacy.get(lineId) ?? 0 }).toEqual({ lineId, canceled: line.canceled });
  }
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

      expect([...read.values()]).toEqual([quantities(o.lineId, [3, 0, 0, 0, 3, 3])]);
      await expectLegacyAgrees(tx, o.salesOrderId, read);
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
      expect(read.get(o.lineId)).toEqual(quantities(o.lineId, [2, 1, 0, 1, 1, 1]));
      expect(read.get(untouchedLineId)).toEqual(quantities(untouchedLineId, [1, 0, 0, 0, 1, 1]));
      await expectLegacyAgrees(tx, o.salesOrderId, read);
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
      expect([...read.values()]).toEqual([quantities(o.lineId, [3, 2, 0, 2, 1, 1])]);
      await expectLegacyAgrees(tx, o.salesOrderId, read);
    });
  });

  it('partial after shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      await seedShippedV1Fulfillment(tx, o, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const read = await readAndCrossCheck(tx, o.salesOrderId);
      // 이미 나간 수량의 취소는 수요에서 빼지 않는다(E2) — demand 3, 더 취소할 수 있는 건 2.
      expect([...read.values()]).toEqual([quantities(o.lineId, [3, 0, 1, 1, 3, 2])]);
      await expectLegacyAgrees(tx, o.salesOrderId, read);
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
      // 상자 없는 옛(V1) FO — 세트 구성품 A 만 나갔다(FOI shipped_qty=1), B 는 아직.
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
      expect([...read.values()]).toEqual([quantities(lineId, [1, 0, 1, 1, 1, 0])]);
      await expectLegacyAgrees(tx, salesOrderId, read);
    });
  });

  it('v1 full after partial', async () => {
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
      expect([...read.values()]).toEqual([quantities(o.lineId, [3, 3, 0, 3, 0, 0])]);
      // E1 — 옛 정의는 partial 만 세어 1, 새 정의는 전체취소의 라인 행까지 세어 3.
      const legacy = await legacyCancelledByLine(tx, o.salesOrderId);
      expect(legacy.get(o.lineId)).toBe(1);
      expect(read.get(o.lineId)?.canceled).not.toBe(legacy.get(o.lineId));
    });
  });

  it('v2 full with digital line', async () => {
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
      expect(read.get(o.lineId)).toEqual(quantities(o.lineId, [2, 2, 0, 2, 0, 0]));
      expect(read.get(digitalLineId)).toEqual(quantities(digitalLineId, [1, 1, 0, 1, 0, 0]));
    });
  });
});
