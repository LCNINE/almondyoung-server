import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { DbTx, fulfillmentStatusEnum, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { salesChannels } from '../../../catalog/schema/catalog.schema';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { StockProjectionReader } from './stock-projection.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_UNSHIPPED_ORDERS_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_UNSHIPPED_ORDERS_DB=1 requires DATABASE_URL');
}

class Rollback extends Error {}

describeIfDb('unshipped orders (DB integration, rollback-only)', () => {
  let dbService: DbService<typeof wmsSchema>;
  let reader: StockProjectionReader;

  beforeAll(async () => {
    if (!DATABASE_URL) return;

    dbService = new DbService({ connectionString: DATABASE_URL }, wmsSchema);
    const module = await Test.createTestingModule({
      providers: [
        StockProjectionReader,
        { provide: DbService, useValue: dbService },
        { provide: StockEventStore, useValue: {} },
      ],
    }).compile();

    reader = module.get(StockProjectionReader);
  });

  afterAll(async () => {
    await dbService?.onApplicationShutdown();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      dbService.run(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx) {
    const [warehouse, otherWarehouse] = await tx
      .insert(wmsTables.warehouses)
      .values([{ name: randomUUID() }, { name: randomUUID() }])
      .returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: randomUUID() }).returning();
    const [sku, otherSku] = await tx
      .insert(wmsTables.skus)
      .values([
        { name: 'Unshipped test', code: randomUUID(), holderId: holder.id },
        { name: 'Other SKU', code: randomUUID(), holderId: holder.id },
      ])
      .returning();

    return { warehouse, otherWarehouse, sku, otherSku };
  }

  async function demandFor(
    tx: DbTx,
    skuId: string,
    warehouseId: string,
    status: (typeof fulfillmentStatusEnum.enumValues)[number] = 'created',
    item: Partial<
      Pick<typeof wmsTables.fulfillmentOrderItems.$inferInsert, 'qty' | 'shippedQty' | 'canceledQty' | 'status'>
    > = {},
  ) {
    const [fo] = await tx.insert(wmsTables.fulfillmentOrders).values({ warehouseId, status }).returning();
    const [foi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fo.id, skuId, qty: 10, ...item })
      .returning();

    return { fo, foi };
  }

  it('uses exactly the grouped summary demand definition and isolates SKU and warehouse', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, otherWarehouse, sku, otherSku } = await seed(tx);
      const openStatuses: (typeof fulfillmentStatusEnum.enumValues)[number][] = [
        'created',
        'partially_reserved',
        'ready',
        'processing',
        'partially_shipped',
        'recovery_required',
      ];

      for (const status of openStatuses) {
        await demandFor(tx, sku.id, warehouse.id, status, { qty: 10, shippedQty: 3, canceledQty: 2 });
      }

      await demandFor(tx, sku.id, warehouse.id, 'shipped');
      await demandFor(tx, sku.id, warehouse.id, 'completed');
      await demandFor(tx, sku.id, warehouse.id, 'canceled');
      await demandFor(tx, sku.id, warehouse.id, 'created', { status: 'canceled' });
      await demandFor(tx, sku.id, warehouse.id, 'created', { qty: 5, shippedQty: 3, canceledQty: 2 });
      await demandFor(tx, sku.id, otherWarehouse.id);
      await demandFor(tx, otherSku.id, warehouse.id);

      const result = await reader.listUnshippedOrders(sku.id, warehouse.id, tx);
      const summary = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id }, tx);
      const summarySku = summary.data.flatMap((group) => group.skus).find((row) => row.skuId === sku.id);

      expect(result.items).toHaveLength(openStatuses.length);
      expect(result.items.every((row) => row.remainingQuantity === 5 && row.progress === 'not_boxed')).toBe(true);
      expect(result.items.reduce((sum, row) => sum + row.remainingQuantity, 0)).toBe(summarySku?.unshippedQuantity);
      expect(await reader.listUnshippedOrders(randomUUID(), warehouse.id, tx)).toEqual({ items: [] });
      expect(await reader.listUnshippedOrders(sku.id, randomUUID(), tx)).toEqual({ items: [] });
    });
  });

  it('joins display number, customer, channel and order date, folds split boxes, and sorts by date then FOI', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const orderDate = new Date('2026-01-02T15:00:00Z');

      await tx.insert(salesChannels).values({ site: '3pl', name: 'Test channel' }).onConflictDoNothing();

      const [channel] = await tx
        .select({ name: salesChannels.name })
        .from(salesChannels)
        .where(eq(salesChannels.site, '3pl'));
      const [so] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: randomUUID(),
          displayOrderNo: '3900',
          salesChannel: '3pl',
          customerName: '테스트주문자',
          shippingAddress: {},
          orderDate,
        })
        .returning();
      const { fo, foi } = await demandFor(tx, sku.id, warehouse.id, 'partially_shipped', {
        shippedQty: 3,
        canceledQty: 2,
      });

      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ salesOrderId: so.id })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      const [secondItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fo.id,
          skuId: sku.id,
          qty: 1,
        })
        .returning();
      const [firstBox, secondBox, shippedBox] = await tx
        .insert(wmsTables.shipments)
        .values([
          { warehouseId: warehouse.id, status: 'planned' },
          { warehouseId: warehouse.id, status: 'draft' },
          { warehouseId: warehouse.id, status: 'shipped' },
        ])
        .returning();

      const [firstLine, secondLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values([
          { shipmentId: firstBox.id, fulfillmentOrderItemId: foi.id, skuId: sku.id, qty: 3, inspectedQty: 3 },
          { shipmentId: secondBox.id, fulfillmentOrderItemId: foi.id, skuId: sku.id, qty: 2 },
          { shipmentId: shippedBox.id, fulfillmentOrderItemId: foi.id, skuId: sku.id, qty: 3, inspectedQty: 3 },
        ])
        .returning();

      // 출고 가능 여부는 FOI.reserved_qty 가 아니라 상자 라인의 confirmed 예약으로 센다.
      await tx.insert(wmsTables.stockReservations).values(
        [
          { line: firstLine, quantity: 3, status: 'confirmed' as const },
          { line: secondLine, quantity: 2, status: 'confirmed' as const },
          { line: secondLine, quantity: 4, status: 'released' as const },
        ].map(({ line, quantity, status }) => ({
          targetType: 'SHIPMENT_LINE',
          targetId: line.id,
          shipmentLineId: line.id,
          skuId: sku.id,
          warehouseId: warehouse.id,
          quantity,
          status,
        })),
      );

      const standalone = await demandFor(tx, sku.id, warehouse.id);

      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(wmsTables.fulfillmentOrders.id, standalone.fo.id));

      const result = await reader.listUnshippedOrders(sku.id, warehouse.id, tx);

      expect(result.items.map((row) => row.fulfillmentOrderItemId)).toEqual([
        standalone.foi.id,
        ...[foi.id, secondItem.id].sort(),
      ]);
      expect(result.items[0]).toMatchObject({
        salesOrderId: null,
        orderNo: null,
        channelName: null,
        customerName: null,
        orderedAt: '2026-01-01T00:00:00.000Z',
        progress: 'not_boxed',
      });
      expect(result.items.find((row) => row.fulfillmentOrderItemId === foi.id)).toMatchObject({
        salesOrderId: so.id,
        orderNo: '3900',
        channelName: channel.name,
        customerName: so.customerName,
        orderedAt: orderDate.toISOString(),
        remainingQuantity: 5,
        reservedQuantity: 5,
        canShip: true,
        progress: 'inspecting',
      });

      await tx.update(wmsTables.salesOrders).set({ displayOrderNo: null }).where(eq(wmsTables.salesOrders.id, so.id));

      const fallback = await reader.listUnshippedOrders(sku.id, warehouse.id, tx);

      expect(fallback.items.find((row) => row.fulfillmentOrderItemId === foi.id)?.orderNo).toBe(so.channelOrderId);
    });
  });
});
