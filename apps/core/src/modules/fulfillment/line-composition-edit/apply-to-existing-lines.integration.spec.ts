import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, wireLogistics } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { boxLinesOf, seedOrderWithDraftBox } from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  return { logistics, edit: wireLineCompositionEdit(dbService, logistics) };
}

describeIfDb('기존 출고에도 적용 (#1063 스펙 §7.2)', () => {
  jest.setTimeout(180_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('미리보기는 넷으로 세고, 적용은 «바꿀 수 있음»만 바꾸며, 다시 보내면 이미 같음이 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const variantId = fx.variantIds[0];
      const [newSku] = fx.spareSkuIds;
      // 같은 variant 를 판 주문 둘을 더 만든다 — 픽스처가 만든 자기 variant 를 첫 주문의 variant 로 옮긴다(굳힌 구성은 각자의 SKU)
      const operatorOrder = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
      });
      const busyOrder = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      for (const other of [operatorOrder, busyOrder]) {
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ variantId })
          .where(eq(wmsTables.salesOrderLines.id, other.lineIds[0]));
      }
      await w.edit.manager.assignToLine(
        operatorOrder.salesOrderId,
        operatorOrder.lineIds[0],
        [{ skuId: newSku, qtyPerUnit: 1 }],
        null,
        actor,
        tx,
      );
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, busyOrder.shipmentId));
      // 상품매칭을 새 SKU 로 바꾼다
      const [matching] = await tx
        .select({ id: wmsTables.productMatchings.id })
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId));
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: newSku })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id));

      expect(await w.edit.reader.previewExistingLines(variantId, tx)).toEqual({
        variantId,
        applicable: true,
        newComposition: [{ skuId: newSku, qtyPerUnit: 1 }],
        changeable: 1,
        skippedOperator: 1,
        skippedInProgress: 1,
        alreadySame: 0,
      });

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 1,
        skipped: [
          { reason: 'operator', count: 1 },
          { reason: 'in_progress', count: 1 },
        ],
      });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: newSku, qty: 1 }]);
      const [line] = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      expect(line.compositionSource).toBe('matching');

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 0,
        skipped: [
          { reason: 'operator', count: 1 },
          { reason: 'in_progress', count: 1 },
          { reason: 'same', count: 1 },
        ],
      });
    });
  });

  it('미리보기 뒤 운영자가 지정한 라인은 적용 때 다시 판정해 건너뛴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 2,
      });
      const variantId = fx.variantIds[0];
      const [matching] = await tx
        .select({ id: wmsTables.productMatchings.id })
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId));
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: fx.spareSkuIds[0] })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id));
      expect((await w.edit.reader.previewExistingLines(variantId, tx)).changeable).toBe(1);

      await w.edit.manager.assignToLine(
        fx.salesOrderId,
        fx.lineIds[0],
        [{ skuId: fx.spareSkuIds[1], qtyPerUnit: 1 }],
        null,
        actor,
        tx,
      );

      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({
        changed: 0,
        skipped: [{ reason: 'operator', count: 1 }],
      });
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: fx.spareSkuIds[1] }]);
    });
  });

  it('상품매칭이 void 면 적용할 것이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      const variantId = fx.variantIds[0];
      await tx
        .update(wmsTables.productMatchings)
        .set({ strategy: 'void' })
        .where(eq(wmsTables.productMatchings.variantId, variantId));

      expect(await w.edit.reader.previewExistingLines(variantId, tx)).toMatchObject({
        applicable: false,
        changeable: 0,
      });
      expect(await w.edit.manager.applyToExistingLines(variantId, actor, tx)).toEqual({ changed: 0, skipped: [] });
    });
  });
});
