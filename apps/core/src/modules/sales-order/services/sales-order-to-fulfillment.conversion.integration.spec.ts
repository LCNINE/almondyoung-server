import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedSalesOrder,
  seedMatching,
  receiveStock,
} from '../../fulfillment/services/__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SO→FO 변환·상품매칭 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  // (sku, 창고, 재고 100, 매칭 준비) 공통 배경. matched=false 면 매칭 미생성.
  async function background(tx: DbTx, opts: { matched: boolean; soQty: number; variantId: string }) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: [{ variantId: opts.variantId, quantity: opts.soQty }],
    });
    if (opts.matched) await seedMatching(tx, { variantId: opts.variantId, skuId, quantity: 1 });
    return { warehouseId, skuId, salesOrderId, salesOrderLineId: lineIds[0] };
  }

  it('1a) 매칭된 라인은 FO 로 변환되고 FOI.qty == SO라인.qty × link.quantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: true, soQty: 5, variantId });

      const fo = await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      expect(fo).toBeTruthy();

      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, bg.salesOrderId));
      expect(foRow).toBeTruthy();

      const fois = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id));
      expect(fois).toHaveLength(1);
      expect(fois[0]).toMatchObject({ skuId: bg.skuId, qty: 5 });
    });
  });

  it('1b) 매칭 없는 라인은 PRODUCT_SKU_MATCHING_REQUIRED 로 실패하고 backlog 를 awaiting_matching 으로 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: false, soQty: 3, variantId });

      // 변환 시도 → throw. 에러 payload 검증.
      let caught: BadRequestException | undefined;
      try {
        await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const payload = caught!.getResponse() as { code: string; missingLines: unknown[] };
      expect(payload).toMatchObject({ code: 'PRODUCT_SKU_MATCHING_REQUIRED' });
      expect(payload.missingLines).toEqual([expect.objectContaining({ variantId, reason: 'NO_PRODUCT_SKU_MATCHING' })]);

      // 백로그 enqueue → processing 으로 만든 뒤 markAwaitingMatching.
      await w.backlog.enqueueForSalesOrder(
        bg.salesOrderId,
        { eventOccurredAt: new Date().toISOString(), isNewSalesOrder: true },
        tx,
      );
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'processing' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, bg.salesOrderId));
      await w.backlog.markAwaitingMatching(
        (await backlogRow(tx, bg.salesOrderId)).id,
        [{ salesOrderLineId: bg.salesOrderLineId, variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }],
        tx,
      );

      const bl = await backlogRow(tx, bg.salesOrderId);
      expect(bl.status).toBe('awaiting_matching');
      expect(bl.waitingVariantIds).toContain(variantId);
    });
  });

  it('1c) 재매칭 upsert 는 backlog 를 pending 으로 깨우고, 재변환 시 FO 가 생성된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const bg = await background(tx, { matched: false, soQty: 4, variantId });
      const { holderId } = await seedHolder(tx);
      const { skuId: skuForMatch } = await seedSku(tx, holderId);

      // 1b 상태 재현: enqueue → processing → awaiting_matching.
      await w.backlog.enqueueForSalesOrder(
        bg.salesOrderId,
        { eventOccurredAt: new Date().toISOString(), isNewSalesOrder: true },
        tx,
      );
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'processing' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, bg.salesOrderId));
      await w.backlog.markAwaitingMatching(
        (await backlogRow(tx, bg.salesOrderId)).id,
        [{ salesOrderLineId: bg.salesOrderLineId, variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }],
        tx,
      );
      expect((await backlogRow(tx, bg.salesOrderId)).status).toBe('awaiting_matching');

      // 재매칭 → wakeBacklogsWaitingForVariant 가 pending 으로.
      await w.productSkuMapping.upsert(variantId, { links: [{ skuId: skuForMatch, quantity: 1 }] }, tx);
      expect((await backlogRow(tx, bg.salesOrderId)).status).toBe('pending');

      // 재변환 성공.
      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, bg.salesOrderId));
      expect(foRow).toBeTruthy();
      const fois = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id));
      expect(fois).toEqual([expect.objectContaining({ skuId: skuForMatch, qty: 4 })]);
    });
  });

  it('1d) void 전략 매칭은 라인을 드롭한다 (physical FOI 0건)', async () => {
    await inRollbackTx(db, async (tx) => {
      const variantId = randomUUID();
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
      const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
      await seedMatching(tx, { variantId, skuId, strategy: 'void' });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      const [foRow] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
      const fois = foRow
        ? await tx
            .select({ id: wmsTables.fulfillmentOrderItems.id })
            .from(wmsTables.fulfillmentOrderItems)
            .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foRow.id))
        : [];
      expect(fois).toHaveLength(0); // void → physical item 없음
    });
  });

  async function backlogRow(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({
        id: wmsTables.fulfillmentOrderCreationBacklogs.id,
        status: wmsTables.fulfillmentOrderCreationBacklogs.status,
        waitingVariantIds: wmsTables.fulfillmentOrderCreationBacklogs.waitingVariantIds,
      })
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
    return row;
  }
});
