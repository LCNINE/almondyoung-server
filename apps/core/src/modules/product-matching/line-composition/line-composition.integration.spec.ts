import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { findCompositionInvariantViolations } from './__support__/composition-invariant';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function twoSkus(tx: DbTx) {
  const { holderId } = await seedHolder(tx);
  const a = await seedSku(tx, holderId);
  const b = await seedSku(tx, holderId);
  return { a: a.skuId, b: b.skuId };
}

describeIfDb('LineCompositionReader / LineCompositionManager (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });
  const wire = () => wireLogistics(makeDbService(db));

  it('라인마다 판정과 유효 수량(주문 수량 − 부분 취소)을 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const matched = randomUUID();
      const unmatched = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: matched, quantity: 3 },
          { variantId: unmatched, quantity: 2 },
        ],
      });
      await seedMatching(tx, { variantId: matched, skuId: sku.a, quantity: 2 });
      await tx.insert(wmsTables.salesOrderCancellations).values({
        salesOrderId,
        cancellationScope: 'partial',
        reasonCode: 'it',
        metadata: { cancelledLines: [{ salesOrderLineId: lineIds[1], quantity: 2 }] },
      });

      const resolved = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      const byLine = new Map(resolved.map((r) => [r.line.id, r]));
      expect(byLine.get(lineIds[0])).toMatchObject({
        fulfillableQuantity: 3,
        resolution: { kind: 'follow', items: [{ skuId: sku.a, qtyPerUnit: 2 }] },
      });
      expect(byLine.get(lineIds[1])).toMatchObject({
        fulfillableQuantity: 0,
        resolution: { kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' },
      });
    });
  });

  it('굳히기는 출처 NULL 라인만 matching 으로 굳히고, 굳힌 뒤엔 상품매칭이 바뀌어도 굳힌 구성을 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      const { matchingId } = await seedMatching(tx, { variantId, skuId: sku.a });

      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );
      // 상품매칭을 다른 SKU 로 바꾼다
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: sku.b })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.resolution).toEqual({ kind: 'frozen', source: 'matching', items: [{ skuId: sku.a, qtyPerUnit: 1 }] });
      const [line] = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
      expect(line.compositionSource).toBe('matching');
      expect(line.compositionSetAt).toBeInstanceOf(Date);
      expect(line.compositionSetBy).toBeNull();
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('이미 굳힌 라인을 다시 굳히려 하면 던진다 — 판매주문 잠금 아래에선 경합이 아니라 결함이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      const entry = { salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] };
      await w.lineCompositionManager.freezeFromMatching([entry], tx);
      await expect(w.lineCompositionManager.freezeFromMatching([entry], tx)).rejects.toThrow(/already frozen/);
    });
  });

  it('구성이 빈 굳히기는 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      await expect(
        w.lineCompositionManager.freezeFromMatching([{ salesOrderLineId: lineIds[0], items: [] }], tx),
      ).rejects.toThrow(/empty/);
    });
  });
});
