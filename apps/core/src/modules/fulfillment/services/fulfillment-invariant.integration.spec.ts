import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentReconciliationService } from './fulfillment-reconciliation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('fulfillment-invariant (PostgreSQL locks and read-only reconciliation)', () => {
  jest.setTimeout(120_000);

  let sqlClient: postgres.Sql;
  let contenderClient: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const invariant = new FulfillmentInvariantService();

  beforeAll(() => {
    sqlClient = postgres(DATABASE_URL as string, { max: 2 });
    contenderClient = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sqlClient, { schema: wmsSchema });
  });

  afterAll(async () => {
    await sqlClient.end();
    await contenderClient.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function fixture(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `invariant-wh-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `invariant-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'invariant-sku', code: `INVARIANT-${suffix}`, holderId: holder.id })
      .returning();
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `invariant-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: sku.id, qty: 10 })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({ warehouseId: warehouse.id, status: 'draft', openedForFulfillmentOrderId: fulfillmentOrder.id })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: shipment.id, fulfillmentOrderItemId: item.id, skuId: sku.id, qty: 10 })
      .returning();
    return { warehouse, holder, sku, salesOrder, fulfillmentOrder, item, shipment, line };
  }

  it('accepts a conserved Draft and rejects active-line drift in the same transaction', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expect(invariant.assertFulfillmentOrders([f.fulfillmentOrder.id], tx)).resolves.toBeUndefined();

      await tx.update(wmsTables.shipmentLines).set({ qty: 9 }).where(eq(wmsTables.shipmentLines.id, f.line.id));
      let invariantError: unknown;
      try {
        await invariant.assertFulfillmentOrders([f.fulfillmentOrder.id], tx);
      } catch (error) {
        invariantError = error;
      }
      expect(invariantError).toBeInstanceOf(ConflictException);
      expect((invariantError as ConflictException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_INVARIANT_VIOLATION',
      });
    });
  });

  it('holds an exact FOI FOR UPDATE lock until the mutation transaction ends', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await invariant.assertFulfillmentOrders([f.fulfillmentOrder.id], tx);

      let lockError: unknown;
      try {
        await contenderClient.begin(async (contender) => {
          await contender`SET LOCAL lock_timeout = '100ms'`;
          await contender`UPDATE fulfillment_order_items SET updated_at = now() WHERE id = ${f.item.id}`;
        });
      } catch (error) {
        lockError = error;
      }
      expect(lockError).toMatchObject({ code: '55P03' });
    });
  });

  it('reconciliation reports the violating ID and never auto-corrects it', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx.update(wmsTables.shipmentLines).set({ qty: 9 }).where(eq(wmsTables.shipmentLines.id, f.line.id));
      const dbService = { run: (fn: (trx: DbTx) => Promise<unknown>) => fn(tx) };
      const reconciliation = new FulfillmentReconciliationService(dbService as never, {} as never);

      const report = await reconciliation.reconcile(tx);
      expect(report.resourceIds.ACTIVE_LINE_QUANTITY).toContain(f.item.id);

      const [unchanged] = await tx
        .select({ qty: wmsTables.shipmentLines.qty })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, f.line.id));
      expect(unchanged.qty).toBe(9);
    });
  });

  it('returns retry conflict when line shipment membership changes while locks are acquired', async () => {
    const f = await db.transaction((tx) => fixture(tx as unknown as DbTx));
    const [targetShipment] = await db
      .insert(wmsTables.shipments)
      .values({ warehouseId: f.warehouse.id, status: 'draft' })
      .returning();
    let allowMove!: () => void;
    const moveAllowed = new Promise<void>((resolve) => {
      allowMove = resolve;
    });
    let lineLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      lineLocked = resolve;
    });

    const mover = contenderClient.begin(async (contender) => {
      await contender`SELECT id FROM shipment_lines WHERE id = ${f.line.id} FOR UPDATE`;
      lineLocked();
      await moveAllowed;
      await contender`UPDATE shipment_lines SET shipment_id = ${targetShipment.id} WHERE id = ${f.line.id}`;
    });

    try {
      await locked;
      const checked = db
        .transaction((tx) => invariant.assertFulfillmentOrders([f.fulfillmentOrder.id], tx as unknown as DbTx))
        .then(() => undefined)
        .catch((error: unknown) => error);

      let checkerWaitedOnLock = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const [row] = await sqlClient<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query ILIKE '%shipment_lines%'
          ) AS waiting
        `;
        if (row.waiting) {
          checkerWaitedOnLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      allowMove();
      await mover;
      const error = await checked;
      expect(checkerWaitedOnLock).toBe(true);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
      });
    } finally {
      allowMove();
      await mover.catch(() => undefined);
      await db.transaction(async (tx) => {
        await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, [f.shipment.id, targetShipment.id]));
        await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, f.salesOrder.id));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, f.sku.id));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, f.holder.id));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, f.warehouse.id));
      });
    }
  });
});
