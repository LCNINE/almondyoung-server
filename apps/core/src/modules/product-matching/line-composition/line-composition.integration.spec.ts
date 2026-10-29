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
import { recordSalesOrderCancellation } from '../../sales-order/cancellation-record/record-cancellation';
import { readLineQuantities } from '../../sales-order/line-quantities/line-quantities.reader';
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

  it('라인마다 판정과 유효 수량(주문 수량 − 출고 전 취소)을 낸다', async () => {
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
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'it',
        },
        [{ salesOrderLineId: lineIds[1], quantity: 2 }],
      );

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

  // E2 — FO 생성 수량은 «출고 전 취소»만 뺀다(스펙 §6.1 demand = ordered − canceledBeforeShipment)
  it('fulfillable excludes only before-shipment cancellations', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 3 }] });
      await seedMatching(tx, { variantId, skuId: sku.a });
      // 한 번의 부분취소 2개 중 1개는 이미 나간 단위(보존 효과) → 라인 행 before 1 + after 1
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'it',
          effects: [
            {
              type: 'preserved_shipped_fulfillment_order_item',
              metadata: {
                salesOrderLineId: lineIds[0],
                skuId: sku.a,
                requestedFulfillmentQuantity: 2,
                affectedShippedQuantity: 1,
              },
            },
          ],
        },
        [{ salesOrderLineId: lineIds[0], quantity: 2 }],
      );
      // 전제: 씨앗이 정말 갈래 하나씩 1개를 남겼다
      expect((await readLineQuantities(tx, salesOrderId)).get(lineIds[0])).toMatchObject({
        canceledBeforeShipment: 1,
        canceledAfterShipment: 1,
      });

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.fulfillableQuantity).toBe(2);
    });
  });

  // E1 — 전체취소의 라인 행도 센다. 옛 파서는 V1 전체취소(cancelledLines 없음)를 못 봐 2 를 냈다
  it('v1 full cancellation leaves nothing fulfillable', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
      await seedMatching(tx, { variantId, skuId: sku.a });
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId,
          cancellationScope: 'full',
          reasonCode: 'it',
          metadata: {},
        },
        null,
      );
      // 전제: V1 전체취소가 라인의 남은 2개를 출고 전으로 남겼다
      expect((await readLineQuantities(tx, salesOrderId)).get(lineIds[0])).toMatchObject({
        canceledBeforeShipment: 2,
        canceledAfterShipment: 0,
      });

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.fulfillableQuantity).toBe(0);
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
  it('assignByOperator 는 출처와 무관하게 구성을 갈아 끼우고 operator·지정자를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const actorId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );

      await w.lineCompositionManager.assignByOperator(lineIds[0], [{ skuId: sku.b, qtyPerUnit: 3 }], actorId, tx);

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.resolution).toEqual({ kind: 'frozen', source: 'operator', items: [{ skuId: sku.b, qtyPerUnit: 3 }] });
      const [line] = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
      expect(line.compositionSetBy).toBe(actorId);
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('replaceMatchingComposition 은 matching 라인만 바꾸고 operator·미굳힘 라인에는 던진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: randomUUID(), quantity: 1 },
          { variantId: randomUUID(), quantity: 1 },
          { variantId: randomUUID(), quantity: 1 },
        ],
      });
      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );
      await w.lineCompositionManager.assignByOperator(lineIds[1], [{ skuId: sku.a, qtyPerUnit: 1 }], randomUUID(), tx);

      await w.lineCompositionManager.replaceMatchingComposition(lineIds[0], [{ skuId: sku.b, qtyPerUnit: 2 }], tx);
      const resolved = new Map((await w.lineCompositions.resolveForOrder(salesOrderId, tx)).map((r) => [r.line.id, r]));
      expect(resolved.get(lineIds[0])?.resolution).toEqual({
        kind: 'frozen',
        source: 'matching',
        items: [{ skuId: sku.b, qtyPerUnit: 2 }],
      });

      await expect(
        w.lineCompositionManager.replaceMatchingComposition(lineIds[1], [{ skuId: sku.b, qtyPerUnit: 1 }], tx),
      ).rejects.toThrow(/not matching-frozen/);
      await expect(
        w.lineCompositionManager.replaceMatchingComposition(lineIds[2], [{ skuId: sku.b, qtyPerUnit: 1 }], tx),
      ).rejects.toThrow(/not matching-frozen/);
    });
  });
  describe('copyFrozen (K8 PR11 교환 줄)', () => {
    const rowsOf = async (tx: DbTx, salesOrderLineId: string) =>
      (
        await tx
          .select({
            skuId: wmsTables.salesOrderLineCompositions.skuId,
            qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit,
          })
          .from(wmsTables.salesOrderLineCompositions)
          .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, salesOrderLineId))
      ).sort((x, y) => x.skuId.localeCompare(y.skuId));
    const lineOf = async (tx: DbTx, id: string) =>
      (await tx.select().from(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, id)))[0];

    it('원래 줄의 굳은 구성 행과 출처·지정자를 대상 줄에 복사한다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = wire();
        const sku = await twoSkus(tx);
        const actorId = randomUUID();
        const { lineIds } = await seedSalesOrder(tx, {
          lines: [
            { variantId: randomUUID(), quantity: 2 },
            { variantId: randomUUID(), quantity: 1 },
          ],
        });
        await w.lineCompositionManager.assignByOperator(
          lineIds[0],
          [
            { skuId: sku.a, qtyPerUnit: 2 },
            { skuId: sku.b, qtyPerUnit: 1 },
          ],
          actorId,
          tx,
        );

        await w.lineCompositionManager.copyFrozen({ sourceLineId: lineIds[0], targetLineId: lineIds[1] }, tx);

        expect(await rowsOf(tx, lineIds[1])).toEqual(await rowsOf(tx, lineIds[0]));
        expect(await rowsOf(tx, lineIds[1])).toHaveLength(2);
        const target = await lineOf(tx, lineIds[1]);
        expect(target).toMatchObject({ compositionSource: 'operator', compositionSetBy: actorId });
        expect(target.compositionSetAt).toBeInstanceOf(Date);
        expect(await findCompositionInvariantViolations(tx)).toEqual([]);
      });
    });

    it('원래 줄이 안 굳었으면 던지고 대상 줄은 그대로다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = wire();
        const { lineIds } = await seedSalesOrder(tx, {
          lines: [
            { variantId: randomUUID(), quantity: 1 },
            { variantId: randomUUID(), quantity: 1 },
          ],
        });

        await expect(
          w.lineCompositionManager.copyFrozen({ sourceLineId: lineIds[0], targetLineId: lineIds[1] }, tx),
        ).rejects.toThrow(/not frozen/);
        expect((await lineOf(tx, lineIds[1])).compositionSource).toBeNull();
        expect(await rowsOf(tx, lineIds[1])).toEqual([]);
      });
    });

    it('대상 줄이 이미 굳었으면 던진다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = wire();
        const sku = await twoSkus(tx);
        const { lineIds } = await seedSalesOrder(tx, {
          lines: [
            { variantId: randomUUID(), quantity: 1 },
            { variantId: randomUUID(), quantity: 1 },
          ],
        });
        await w.lineCompositionManager.freezeFromMatching(
          [
            { salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] },
            { salesOrderLineId: lineIds[1], items: [{ skuId: sku.b, qtyPerUnit: 1 }] },
          ],
          tx,
        );

        await expect(
          w.lineCompositionManager.copyFrozen({ sourceLineId: lineIds[0], targetLineId: lineIds[1] }, tx),
        ).rejects.toThrow(/already frozen/);
      });
    });
  });
});
