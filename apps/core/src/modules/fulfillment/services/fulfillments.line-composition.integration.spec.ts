import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { findCompositionInvariantViolations } from '../../product-matching/line-composition/__support__/composition-invariant';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function freezeAsOperator(tx: DbTx, lineId: string, skuId: string, qtyPerUnit: number) {
  // 운영자 지정 API 는 PR 2 다 — 여기선 그 결과 상태를 직접 만든다
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'operator', compositionSetAt: new Date(), compositionSetBy: randomUUID() })
    .where(eq(wmsTables.salesOrderLines.id, lineId));
  await tx.insert(wmsTables.salesOrderLineCompositions).values({ salesOrderLineId: lineId, skuId, qtyPerUnit });
}

async function foItems(tx: DbTx, salesOrderId: string) {
  return tx
    .select({
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      skuId: wmsTables.fulfillmentOrderItems.skuId,
      qty: wmsTables.fulfillmentOrderItems.qty,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId));
}

async function compositionOf(tx: DbTx, lineId: string) {
  const [line] = await tx
    .select({ source: wmsTables.salesOrderLines.compositionSource })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.id, lineId));
  const rows = await tx
    .select({
      skuId: wmsTables.salesOrderLineCompositions.skuId,
      qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit,
    })
    .from(wmsTables.salesOrderLineCompositions)
    .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, lineId));
  return { source: line.source, rows };
}

describeIfDb('FO 생성의 라인 구성 판정·굳히기 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function world(tx: DbTx) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const a = (await seedSku(tx, holderId)).skuId;
    const b = (await seedSku(tx, holderId)).skuId;
    return { warehouseId, a, b };
  }

  it('상품매칭을 따르는 라인을 FO 생성 순간에 matching 으로 굳히고 그 구성으로 FO 항목을 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
      await seedMatching(tx, { variantId, skuId: a, quantity: 3 });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await compositionOf(tx, lineIds[0])).toEqual({ source: 'matching', rows: [{ skuId: a, qtyPerUnit: 3 }] });
      expect(await foItems(tx, salesOrderId)).toEqual([{ salesOrderLineId: lineIds[0], skuId: a, qty: 6 }]);
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('운영자가 굳힌 라인은 상품매칭이 없어도 그 구성으로 나가고, 섞인 다른 라인만 새로 굳힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a, b } = await world(tx);
      const operatorVariant = randomUUID();
      const followVariant = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: operatorVariant, quantity: 1 },
          { variantId: followVariant, quantity: 1 },
        ],
      });
      await freezeAsOperator(tx, lineIds[0], b, 2);
      await seedMatching(tx, { variantId: followVariant, skuId: a });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await compositionOf(tx, lineIds[0])).toEqual({ source: 'operator', rows: [{ skuId: b, qtyPerUnit: 2 }] });
      expect(await compositionOf(tx, lineIds[1])).toEqual({ source: 'matching', rows: [{ skuId: a, qtyPerUnit: 1 }] });
      const items = await foItems(tx, salesOrderId);
      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          { salesOrderLineId: lineIds[0], skuId: b, qty: 2 },
          { salesOrderLineId: lineIds[1], skuId: a, qty: 1 },
        ]),
      );
    });
  });

  it('운영자가 굳힌 라인은 상품매칭이 void 여도 굳힌 구성으로 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      await seedMatching(tx, { variantId, skuId: a, strategy: 'void' });
      await freezeAsOperator(tx, lineIds[0], a, 1);

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await foItems(tx, salesOrderId)).toEqual([{ salesOrderLineId: lineIds[0], skuId: a, qty: 1 }]);
    });
  });

  it('미매칭 라인이 있으면 아무것도 굳히지 않고 그 라인만 missingLines 로 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const matched = randomUUID();
      const missing = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: matched, quantity: 1 },
          { variantId: missing, quantity: 1 },
        ],
      });
      await seedMatching(tx, { variantId: matched, skuId: a });

      const error = await w.fulfillments.create({ salesOrderId, warehouseId }, tx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        missingLines: [{ salesOrderLineId: lineIds[1], variantId: missing, reason: 'NO_PRODUCT_SKU_MATCHING' }],
      });
      expect((await compositionOf(tx, lineIds[0])).source).toBeNull();
    });
  });

  it('굳힌 뒤 같은 트랜잭션의 검증(창고 SKU·직배송 SKU 혼합)이 실패하면 굳힌 것도 남지 않는다', async () => {
    const { warehouseId, salesOrderId } = await db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const seeded = await world(tx);
      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, seeded.b));
      const v1 = randomUUID();
      const v2 = randomUUID();
      const order = await seedSalesOrder(tx, {
        lines: [
          { variantId: v1, quantity: 1 },
          { variantId: v2, quantity: 1 },
        ],
      });
      await seedMatching(tx, { variantId: v1, skuId: seeded.a });
      await seedMatching(tx, { variantId: v2, skuId: seeded.b });
      return { ...seeded, ...order };
    });
    try {
      const w = wireLogistics(makeDbService(db));
      // tx 없이 부르면 create 가 자기 트랜잭션을 연다 — 실패 시 그 트랜잭션 전체가 롤백되는지 본다
      await expect(w.fulfillments.create({ salesOrderId, warehouseId })).rejects.toMatchObject({
        response: { code: 'V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT' },
      });
      const lines = await db
        .select({ source: wmsTables.salesOrderLines.compositionSource })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
      expect(lines.map((l) => l.source)).toEqual([null, null]);
    } finally {
      await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
    }
  });
});
