import { createModel3dProjectionStub } from '../../product-matching/services/__fixtures__/model3d-projection.stub';
// 이 스펙은 FO 생성·드래프트 박스 배선(fulfillment)이 필요해서 product-matching 이 아니라 여기에 둔다.
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { selectCompositionItemViews } from '../../product-matching/line-composition/line-composition-views';
import { ProductMatchingService } from '../../product-matching/services/product-matching.service';
import { inRollbackTx, makeDb, seedSalesOrder, wireLogistics } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { seedOrderWithDraftBox } from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const edit = wireLineCompositionEdit(dbService, logistics);
  return { dbService, logistics, edit };
}

async function skuViews(tx: DbTx, ids: string[]) {
  const rows = await tx
    .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
    .from(wmsTables.skus)
    .where(inArray(wmsTables.skus.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

describeIfDb('라인 구성 표시 읽기 (#1063 스펙 §8.1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('FO 상세 lines 가 FO 생성이 굳힌 구성을 SKU 코드·이름과 함께 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 2, qtyPerUnits: [1, 3] }] });
      const skus = await skuViews(tx, fx.skuIdsByLine[0]);

      const detail = await w.logistics.fulfillments.getOne(fx.fulfillmentOrderId, tx);

      expect(detail?.lines).toHaveLength(1);
      const [line] = detail?.lines ?? [];
      expect(line).toMatchObject({ salesOrderLineId: fx.lineIds[0], quantity: 2, compositionSource: 'matching' });
      expect(line.productName).toEqual(expect.any(String));
      expect(line.composition).toEqual(
        expect.arrayContaining(
          fx.skuIdsByLine[0].map((skuId, k) => ({
            skuId,
            skuCode: skus.get(skuId)?.code,
            skuName: skus.get(skuId)?.name,
            qtyPerUnit: [1, 3][k],
          })),
        ),
      );
    });
  });

  it('운영자 지정 뒤: 출처 operator, 새 구성, 빠진 SKU 의 FO 항목은 qty 0·canceledQty 0 (화면의 «대체됨» 재료)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      await w.edit.manager.assignToLine(
        fx.salesOrderId,
        fx.lineIds[0],
        [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }],
        null,
        actor,
        tx,
      );

      const detail = await w.logistics.fulfillments.getOne(fx.fulfillmentOrderId, tx);

      expect(detail?.lines?.[0]).toMatchObject({
        compositionSource: 'operator',
        composition: [expect.objectContaining({ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 })],
      });
      const replaced = detail?.items.find((item) => item.skuId === fx.skuIdsByLine[0][0]);
      expect(replaced).toMatchObject({ qty: 0, canceledQty: 0 });
    });
  });

  it('굳히지 않은 라인은 구성 맵에 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      const w = wire(tx);
      const frozen = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      const views = await selectCompositionItemViews(tx, [lineIds[0], frozen.lineIds[0]]);
      expect(views.has(frozen.lineIds[0])).toBe(true);
      expect(views.has(lineIds[0])).toBe(false);
    });
  });

  it('매칭체크 행에 composition 이 실린다(굳힌 라인)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [2] }] });
      const marker = `pr3-${randomUUID()}`;
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ productName: marker })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      const service = new ProductMatchingService(
        w.dbService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        createModel3dProjectionStub(),
      );

      const page = await service.getOrderLines({ keyword: marker, keywordType: 'productName' }, tx);

      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toMatchObject({
        compositionSource: 'matching',
        composition: [expect.objectContaining({ skuId: fx.skuIdsByLine[0][0], qtyPerUnit: 2 })],
      });
    });
  });
});
