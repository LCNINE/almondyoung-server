import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx, fulfillmentStatusEnum } from '../../schema/inventory.schema';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { StockProjectionReader } from './stock-projection.reader';
import { GetStockSummaryByGroupQueryDto } from '../dto/stock-summary-by-group.dto';
import {
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
} from '../../../catalog/schema/catalog.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_STOCK_GROUP_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_STOCK_GROUP_DB=1 requires DATABASE_URL');
}

class Rollback extends Error {}

describeIfDb('stock summary by group (DB integration, rollback-only)', () => {
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
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `group-test-${randomUUID()}` })
      .returning();
    const [otherWarehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `group-other-${randomUUID()}` })
      .returning();
    const [location] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: 'A', locationType: 'zone' })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `group-holder-${randomUUID()}` })
      .returning();
    const [group] = await tx.insert(wmsTables.skuGroups).values({ name: 'Z product', code: randomUUID() }).returning();
    const [demand, sibling, empty, standalone] = await tx
      .insert(wmsTables.skus)
      .values([
        { name: 'A demand', code: randomUUID(), holderId: holder.id, groupId: group.id },
        { name: 'B sibling', code: randomUUID(), holderId: holder.id, groupId: group.id },
        { name: 'C unused', code: randomUUID(), holderId: holder.id, groupId: group.id },
        { name: 'A standalone', code: randomUUID(), holderId: holder.id },
      ])
      .returning();

    await tx.insert(wmsTables.stockLedgers).values([
      { skuId: sibling.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'ON_HAND', qty: 2 },
      { skuId: sibling.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'DEFECTIVE', qty: 1 },
      { skuId: sibling.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'IN_TRANSFER', qty: 3 },
      { skuId: sibling.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'RETURNED', qty: 4 },
    ]);
    await tx.insert(wmsTables.skuShelfPositions).values({ skuId: sibling.id, positionCode: 'A-02' });
    await tx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId: sibling.id, safetyStock: 3 });

    return { warehouse, otherWarehouse, group, demand, sibling, empty, standalone };
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

    await tx.insert(wmsTables.fulfillmentOrderItems).values({ fulfillmentOrderId: fo.id, skuId, qty: 10, ...item });
  }

  it('sums FOI demand by warehouse without reservations and excludes terminal FOs and canceled items', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, otherWarehouse, demand } = await seed(tx);

      const openStatuses: (typeof fulfillmentStatusEnum.enumValues)[number][] = [
        'created',
        'partially_reserved',
        'ready',
        'processing',
        'partially_shipped',
        'recovery_required',
      ];

      for (const status of openStatuses) {
        await demandFor(tx, demand.id, warehouse.id, status, { qty: 10, shippedQty: 3, canceledQty: 2 });
      }
      await demandFor(tx, demand.id, warehouse.id, 'shipped');
      await demandFor(tx, demand.id, warehouse.id, 'completed');
      await demandFor(tx, demand.id, warehouse.id, 'canceled');
      await demandFor(tx, demand.id, warehouse.id, 'created', { status: 'canceled' });
      await demandFor(tx, demand.id, warehouse.id, 'created', { qty: 5, shippedQty: 3, canceledQty: 2 });
      await demandFor(tx, demand.id, otherWarehouse.id, 'created', { qty: 7 });

      const result = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, queue: 'unshipped' }, tx);

      expect(result.total).toBe(1);
      expect(result.data[0].skus[0]).toMatchObject({
        skuId: demand.id,
        currentQuantity: 0,
        unshippedQuantity: 30,
        shortageQuantity: 30,
      });
      expect(result.data[0].skus).toHaveLength(2);

      const other = await reader.listStockSummariesByGroup({ warehouseId: otherWarehouse.id }, tx);

      expect(other.data[0].skus).toHaveLength(1);
      expect(other.data[0].skus[0].unshippedQuantity).toBe(7);
    });
  });

  it('paginates groups and keeps sibling rows, shelf text and physical stock states', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, group, demand, sibling, standalone } = await seed(tx);

      await demandFor(tx, demand.id, warehouse.id, 'created', { qty: 12 });
      await demandFor(tx, standalone.id, warehouse.id, 'created', { qty: 1 });

      const first = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, limit: 1 }, tx);
      const second = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, page: 2, limit: 1 }, tx);
      const pastEnd = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, page: 3, limit: 1 }, tx);

      expect(first).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(first.data[0].groupId).toBe(group.id);
      expect(first.data[0].skus.map((sku) => sku.skuId)).toEqual([demand.id, sibling.id]);
      expect(first.data[0].skus[1]).toMatchObject({
        shelfPosition: 'A-02',
        currentQuantity: 10,
        safetyStock: 3,
        belowSafetyStock: true,
      });
      expect(second.data[0]).toMatchObject({ groupId: null, groupName: standalone.name, groupCode: null });
      expect(pastEnd).toMatchObject({ data: [], total: 2 });
    });
  });

  it('applies every queue to the group while retaining nonmatching siblings', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, group, demand } = await seed(tx);

      await demandFor(tx, demand.id, warehouse.id);

      const queues: GetStockSummaryByGroupQueryDto['queue'][] = ['unshipped', 'below_safety_stock', 'out_of_stock'];

      for (const queue of queues) {
        const result = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, queue }, tx);

        expect(result.data[0].groupId).toBe(group.id);
        expect(result.data[0].skus).toHaveLength(2);
      }

      const inbound = await reader.listStockSummariesByGroup(
        { warehouseId: warehouse.id, queue: 'inbound_pending' },
        tx,
      );

      expect(inbound).toMatchObject({ data: [], total: 0 });

      const [po] = await tx
        .insert(wmsTables.purchaseOrders)
        .values({ type: 'domestic', sourceWarehouseId: warehouse.id, destinationWarehouseId: warehouse.id })
        .returning();

      await tx
        .insert(wmsTables.purchaseOrderLines)
        .values({ poId: po.id, skuId: demand.id, quantity: 5, orderedQty: 5, status: 'ordered' });

      const pending = await reader.listStockSummariesByGroup(
        { warehouseId: warehouse.id, queue: 'inbound_pending' },
        tx,
      );

      expect(pending.total).toBe(1);
      expect(pending.data[0].skus).toHaveLength(2);
    });
  });

  it('matches SKU name/code and supplier without dropping siblings or multiplying quantities', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, demand } = await seed(tx);
      const [supplier, anotherSupplier] = await tx
        .insert(wmsTables.suppliers)
        .values([{ name: randomUUID() }, { name: randomUUID() }])
        .returning();

      await demandFor(tx, demand.id, warehouse.id);
      await tx.insert(wmsTables.skuSuppliers).values([
        { skuId: demand.id, supplierId: supplier.id },
        { skuId: demand.id, supplierId: anotherSupplier.id },
      ]);

      for (const search of [`  ${demand.code}  `, 'a DEMAND']) {
        const result = await reader.listStockSummariesByGroup(
          { warehouseId: warehouse.id, supplierId: supplier.id, search },
          tx,
        );

        expect(result.total).toBe(1);
        expect(result.data[0].skus).toHaveLength(2);
        expect(result.data[0].skus[0].unshippedQuantity).toBe(10);
      }

      expect(
        await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, supplierId: randomUUID() }, tx),
      ).toMatchObject({ data: [], total: 0 });
    });
  });

  it('matches active, undeleted product names through all matching links', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, demand } = await seed(tx);
      const [master] = await tx.insert(productMasters).values({}).returning();
      const [variant] = await tx.insert(productVariants).values({}).returning();
      const [version] = await tx
        .insert(productMasterVersions)
        .values({ masterId: master.id, name: 'Unique catalog title', status: 'active' })
        .returning();
      const [matching] = await tx
        .insert(wmsTables.productMatchings)
        .values({ masterId: master.id, variantId: variant.id })
        .returning();

      await tx
        .insert(productMasterVariants)
        .values({ masterId: master.id, variantId: variant.id, versionId: version.id });
      await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: matching.id, skuId: demand.id });
      await demandFor(tx, demand.id, warehouse.id);

      const query = { warehouseId: warehouse.id, search: 'catalog TITLE' };
      const active = await reader.listStockSummariesByGroup(query, tx);

      expect(active.total).toBe(1);
      expect(active.data[0].skus).toHaveLength(2);

      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive' })
        .where(eq(productMasterVersions.id, version.id));
      expect(await reader.listStockSummariesByGroup(query, tx)).toMatchObject({ data: [], total: 0 });

      await tx
        .update(productMasterVersions)
        .set({ status: 'active', deletedAt: new Date() })
        .where(eq(productMasterVersions.id, version.id));
      expect(await reader.listStockSummariesByGroup(query, tx)).toMatchObject({ data: [], total: 0 });
    });
  });

  it('breaks shortage ties by maximum unshipped, then group name', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, group, sibling, standalone } = await seed(tx);

      await demandFor(tx, sibling.id, warehouse.id, 'created', { qty: 15 });
      await demandFor(tx, standalone.id, warehouse.id, 'created', { qty: 5 });

      const first = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, limit: 1 }, tx);

      expect(first.data[0].groupId).toBe(group.id);

      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ qty: 0 })
        .where(eq(wmsTables.fulfillmentOrderItems.skuId, sibling.id));
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ qty: 0 })
        .where(eq(wmsTables.fulfillmentOrderItems.skuId, standalone.id));
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: 'B', locationType: 'zone' })
        .returning();

      await tx.insert(wmsTables.stockLedgers).values({
        skuId: standalone.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        stockState: 'ON_HAND',
        qty: 1,
      });

      const tied = await reader.listStockSummariesByGroup({ warehouseId: warehouse.id, limit: 1 }, tx);

      expect(tied.data[0].groupName).toBe('A standalone');
    });
  });
});
