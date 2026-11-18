import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
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
  Wired,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 생성 — 위탁 업체 화주면 3pl (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;

  beforeAll(() => {
    wired = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function vendor(tx: DbTx): Promise<string> {
    const [row] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-vendor-${randomUUID().slice(0, 8)}`, isOurAsset: false })
      .returning({ id: wmsTables.holders.id });

    return row.id;
  }

  async function stockedSku(tx: DbTx, w: { warehouseId: string; locationId: string }, holderId: string) {
    const { skuId } = await seedSku(tx, holderId);
    await tx
      .insert(wmsTables.stockLedgers)
      .values({ skuId, warehouseId: w.warehouseId, locationId: w.locationId, stockState: 'ON_HAND', qty: 5 });

    return skuId;
  }

  async function orderOf(tx: DbTx, skuIds: string[]) {
    const variants = skuIds.map(() => randomUUID());
    const { salesOrderId } = await seedSalesOrder(tx, {
      lines: variants.map((variantId) => ({ variantId, quantity: 1 })),
    });
    for (const [i, skuId] of skuIds.entries()) await seedMatching(tx, { variantId: variants[i], skuId });

    return salesOrderId;
  }

  it('전부 한 위탁 업체 SKU 면 3pl 과 그 화주로 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWarehouseWithZone(tx);
      const holderId = await vendor(tx);
      const salesOrderId = await orderOf(tx, [await stockedSku(tx, w, holderId)]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);

      expect(fo).toMatchObject({ fulfillmentMode: '3pl', ownerId: holderId });
    });
  });

  it('자사 SKU 면 지금처럼 in_house', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const salesOrderId = await orderOf(tx, [await stockedSku(tx, w, holderId)]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);

      expect(fo).toMatchObject({ fulfillmentMode: 'in_house', ownerId: null });
    });
  });

  it('자사와 위탁 업체 SKU 가 섞이면 만들지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const salesOrderId = await orderOf(tx, [
        await stockedSku(tx, w, holderId),
        await stockedSku(tx, w, await vendor(tx)),
      ]);

      await expect(wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx)).rejects.toMatchObject({
        response: { code: 'FULFILLMENT_HOLDERS_MIXED' },
      });
    });
  });
});
