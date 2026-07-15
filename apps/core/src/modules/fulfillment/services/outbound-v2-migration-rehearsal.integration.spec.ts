import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import type { Sql } from 'postgres';
import {
  CLEANUP_ALLOWLIST,
  cleanup,
  createAuditArtifact,
  verify,
  type AuditArtifact,
} from '../../../../../../scripts/fulfillment-v2/toolkit';
import { FulfillmentOrderCreationBacklogWorker } from './fulfillment-order-creation-backlog.worker';
import { FulfillmentOrderCreationBacklogService } from '../backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService, seedMatching, seedSalesOrder, wireLogistics } from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const CUTOVER_AT = '2026-07-14T00:00:00.000Z';
const SIGNING_KEY = 'outbound-v2-real-migration-rehearsal-key';
const SNAPSHOT_ID = 'outbound-v2-real-migration-rehearsal-snapshot';
const MIGRATIONS_ROOT = join(process.cwd(), 'apps/core/drizzle');
const V2_MIGRATION_TAG = '20260714120854_certain_wendigo';
const EXPECTED_V2_TABLES = [
  'fulfillment_command_requests',
  'shipment_operations',
  'shipment_operation_members',
  'invoice_operations',
  'outbound_batch_work_items',
  'picking_plans',
  'picking_source_allocations',
  'batch_inventory_sessions',
  'batch_inventory_session_balances',
  'batch_inventory_session_events',
  'totes',
  'shipment_tote_assignments',
  'dispatch_attempts',
  'dispatch_attempt_sources',
] as const;

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

type RehearsalDatabase = {
  admin: Sql;
  client: Sql;
  databaseName: string;
  db: PostgresJsDatabase<typeof wmsSchema>;
  tempFolders: string[];
};

type LegacyIds = {
  warehouseId: string;
  holderId: string;
  skuId: string;
  locationId: string;
  salesOrderId: string;
};

async function createRehearsalDatabase(): Promise<RehearsalDatabase> {
  const source = new URL(DATABASE_URL as string);
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const databaseName = `outbound_v2_rehearsal_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false });
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const targetUrl = new URL(source);
  targetUrl.pathname = `/${databaseName}`;
  const client = postgres(targetUrl.toString(), { max: 6, prepare: false });
  return {
    admin,
    client,
    databaseName,
    db: drizzle(client, { schema: wmsSchema }),
    tempFolders: [],
  };
}

async function destroyRehearsalDatabase(database: RehearsalDatabase): Promise<void> {
  await database.client.end({ timeout: 5 }).catch(() => undefined);
  await database.admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
      `WHERE datname = '${database.databaseName}' AND pid <> pg_backend_pid()`,
  );
  await database.admin.unsafe(`DROP DATABASE IF EXISTS "${database.databaseName}"`);
  await database.admin.end({ timeout: 5 });
  await Promise.all(database.tempFolders.map((folder) => rm(folder, { recursive: true, force: true })));
}

async function migrationFolder(entries: JournalEntry[]): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'outbound-v2-migrations-'));
  await mkdir(join(folder, 'meta'));
  const sourceJournal = JSON.parse(await readFile(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8')) as Journal;
  await writeFile(
    join(folder, 'meta/_journal.json'),
    `${JSON.stringify({ ...sourceJournal, entries }, null, 2)}\n`,
    'utf8',
  );
  await Promise.all(
    entries.map((entry) => cp(join(MIGRATIONS_ROOT, `${entry.tag}.sql`), join(folder, basename(`${entry.tag}.sql`)))),
  );
  return folder;
}

async function splitMigrationFolders(database: RehearsalDatabase) {
  const journal = JSON.parse(await readFile(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8')) as Journal;
  const v2Index = journal.entries.findIndex((entry) => entry.tag === V2_MIGRATION_TAG);
  if (v2Index < 1) throw new Error(`V2 migration ${V2_MIGRATION_TAG} was not found in the journal`);
  const current = await migrationFolder(journal.entries.slice(0, v2Index));
  const expand = await migrationFolder(journal.entries.slice(v2Index));
  database.tempFolders.push(current, expand);
  return { current, expand, journal };
}

async function seedCurrentSchemaData(sql: Sql): Promise<LegacyIds> {
  const ids: LegacyIds = {
    warehouseId: randomUUID(),
    holderId: randomUUID(),
    skuId: randomUUID(),
    locationId: randomUUID(),
    salesOrderId: randomUUID(),
  };
  const receiveJournalId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO warehouses (id, name) VALUES (${ids.warehouseId}, 'V2 rehearsal warehouse')`;
    await tx`INSERT INTO holders (id, name) VALUES (${ids.holderId}, 'V2 rehearsal holder')`;
    await tx`INSERT INTO skus (id, holder_id, name, code)
             VALUES (${ids.skuId}, ${ids.holderId}, 'V2 rehearsal SKU', ${`V2-${ids.skuId}`})`;
    await tx`INSERT INTO locations (id, warehouse_id, code, location_type)
             VALUES (${ids.locationId}, ${ids.warehouseId}, 'V2-REHEARSAL-ZONE', 'zone')`;
    await tx`INSERT INTO stock_journals (id, source_type, idempotency_key)
             VALUES (${receiveJournalId}, 'RECEIPT', ${`receive-${ids.skuId}`})`;
    await tx`INSERT INTO stock_events
             (journal_id, sku_id, to_warehouse_id, to_location_id, to_state, transition_type,
              quantity, occurred_at, idempotency_key, event_status)
             VALUES (${receiveJournalId}, ${ids.skuId}, ${ids.warehouseId}, ${ids.locationId},
                     'ON_HAND', 'RECEIVE', 10, now(), ${`receive-event-${ids.skuId}`}, 'POSTED')`;
    await tx`INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty)
             VALUES (${ids.skuId}, ${ids.warehouseId}, ${ids.locationId}, 'ON_HAND', 10)`;
    await tx`INSERT INTO sales_orders
             (id, channel_order_id, sales_channel, status, shipping_address, order_date, created_at)
             VALUES (${ids.salesOrderId}, ${`legacy-${ids.salesOrderId}`}, 'medusa', 'confirmed',
                     '{"recipientName":"Legacy"}', '2026-07-13T00:00:00Z', '2026-07-13T00:00:00Z')`;
    await tx`INSERT INTO sales_order_lines
             (sales_order_id, variant_id, product_name, quantity)
             VALUES (${ids.salesOrderId}, ${randomUUID()}, 'Legacy protected product', 2)`;
    await tx`INSERT INTO order_events (event_id, order_id, event_type, payload)
             VALUES (${randomUUID()}, ${ids.salesOrderId}, 'ORDER_CREATED',
                     '{"createdAt":"2026-07-13T00:00:00.000Z"}')`;
  });
  return ids;
}

async function protectedHashes(sql: Sql, ids: LegacyIds) {
  // The expand migration adds only stock_ledgers.version to these protected
  // tables. Hash every pre-existing business column while excluding that
  // additive schema default so value drift cannot hide behind a partial hash.
  const [hashes] = await sql.unsafe<Array<{ sku: string; sales_order: string; ledger: string }>>(`
    SELECT
      (SELECT md5(to_jsonb(t)::text) FROM skus t WHERE id = '${ids.skuId}') AS sku,
      (SELECT md5(to_jsonb(t)::text) FROM sales_orders t WHERE id = '${ids.salesOrderId}') AS sales_order,
      (SELECT md5((to_jsonb(t) - 'version')::text) FROM stock_ledgers t
        WHERE sku_id = '${ids.skuId}' AND warehouse_id = '${ids.warehouseId}'
          AND location_id = '${ids.locationId}' AND stock_state = 'ON_HAND') AS ledger
  `);
  return hashes;
}

async function backlogRowCount(sql: Sql, salesOrderId: string): Promise<number> {
  const [row] = await sql.unsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM fulfillment_order_creation_backlogs WHERE sales_order_id = '${salesOrderId}'`,
  );
  return row.count;
}

async function seedLegacyCleanupGraph(database: RehearsalDatabase, ids: LegacyIds) {
  const foId = randomUUID();
  const itemId = randomUUID();
  const shipmentId = randomUUID();
  await database.client.begin(async (tx) => {
    await tx`INSERT INTO fulfillment_orders
             (id, sales_order_id, warehouse_id, status, total_items, total_qty, total_reserved_qty)
             VALUES (${foId}, ${ids.salesOrderId}, ${ids.warehouseId}, 'created', 1, 2, 2)`;
    await tx`INSERT INTO fulfillment_order_items
             (id, fulfillment_order_id, sales_order_id, sku_id, qty, reserved_qty)
             VALUES (${itemId}, ${foId}, ${ids.salesOrderId}, ${ids.skuId}, 2, 2)`;
    await tx`INSERT INTO stock_reservations
             (target_type, target_id, fulfillment_order_item_id, sku_id, warehouse_id, quantity, status)
             VALUES ('FULFILLMENT_ORDER', ${foId}, ${itemId}, ${ids.skuId}, ${ids.warehouseId}, 2, 'confirmed')`;
    await tx`INSERT INTO shipments (id, warehouse_id, opened_for_fulfillment_order_id, status)
             VALUES (${shipmentId}, ${ids.warehouseId}, ${foId}, 'open')`;
    await tx`INSERT INTO shipment_lines (shipment_id, fulfillment_order_item_id, sku_id, qty)
             VALUES (${shipmentId}, ${itemId}, ${ids.skuId}, 2)`;
    await tx`INSERT INTO fulfillment_order_creation_backlogs
             (sales_order_id, fulfillment_order_id, status, completed_at)
             VALUES (${ids.salesOrderId}, ${foId}, 'completed', '2026-07-13T00:00:00Z')`;
    await tx`INSERT INTO outbox_events
             (event_type, aggregate_type, aggregate_id, partition_key, payload, status)
             VALUES ('FulfillmentCreated', 'fulfillment', ${foId}, ${foId},
                     ${JSON.stringify({ fulfillmentOrderId: foId })}::jsonb, 'pending')`;
  });
}

async function audit(database: RehearsalDatabase): Promise<AuditArtifact> {
  return createAuditArtifact(database.client, {
    cutoverAt: CUTOVER_AT,
    workflowMode: 'maintenance',
    signingKey: SIGNING_KEY,
  });
}

describeIfDb('Outbound V2 real migration rehearsal (fresh PostgreSQL database)', () => {
  jest.setTimeout(180_000);

  it('migrates current data through expand, cleans V1, verifies and admits only a post-watermark V2 order', async () => {
    const database = await createRehearsalDatabase();
    try {
      const folders = await splitMigrationFolders(database);
      await migrate(database.db, { migrationsFolder: folders.current });

      const legacyIds = await seedCurrentSchemaData(database.client);
      await seedLegacyCleanupGraph(database, legacyIds);
      const hashesBeforeExpand = await protectedHashes(database.client, legacyIds);

      await migrate(database.db, { migrationsFolder: folders.expand });
      expect(await protectedHashes(database.client, legacyIds)).toEqual(hashesBeforeExpand);

      const [migrationJournal] = await database.client.unsafe<Array<{ rows: number; latest: string }>>(`
        SELECT count(*)::int AS rows, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations
      `);
      expect(migrationJournal.rows).toBe(folders.journal.entries.length);
      expect(Number(migrationJournal.latest)).toBe(folders.journal.entries.at(-1)!.when);

      const migratedTables = await database.client.unsafe<Array<{ table_name: string }>>(`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (${EXPECTED_V2_TABLES.map((table) => `'${table}'`).join(', ')})
         ORDER BY table_name
      `);
      expect(migratedTables.map((row) => row.table_name)).toEqual([...EXPECTED_V2_TABLES].sort());
      const [constraints] = await database.client.unsafe<Array<{ checks: number; foreign_keys: number }>>(`
        SELECT
          count(*) FILTER (WHERE conname = 'ck_dispatch_attempts_attempt_no_positive')::int AS checks,
          count(*) FILTER (
            WHERE conname = 'shipment_tracking_dispatch_attempt_id_dispatch_attempts_id_fk'
          )::int AS foreign_keys
        FROM pg_constraint
      `);
      expect(constraints).toEqual({ checks: 1, foreign_keys: 1 });

      const artifact = await audit(database);
      expect(artifact.blockers).toEqual([]);
      expect(artifact.allowlist).toEqual(CLEANUP_ALLOWLIST);
      expect(artifact.integrity.signature).not.toBeNull();

      const deleted = await cleanup(database.client, {
        artifact,
        snapshotId: SNAPSHOT_ID,
        execute: true,
        workflowMode: 'maintenance',
        cutoverAt: CUTOVER_AT,
        signingKey: SIGNING_KEY,
      });
      expect(deleted).toMatchObject({
        backlogs: 1,
        'fo-reservations': 1,
        'shipment-lines': 1,
        shipments: 1,
        'fo-items': 1,
        'fulfillment-orders': 1,
        'legacy-fulfillment-outbox': 1,
      });
      const report = await verify(database.client, artifact, {
        workflowMode: 'maintenance',
        cutoverAt: CUTOVER_AT,
        signingKey: SIGNING_KEY,
      });
      expect(Object.values(report.checks).every(Boolean)).toBe(true);
      expect(await protectedHashes(database.client, legacyIds)).toEqual(hashesBeforeExpand);

      const dbService = makeDbService(database.db);
      const logistics = wireLogistics(dbService, 'v2');
      const gate = new FulfillmentWorkflowGate(
        new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: CUTOVER_AT }),
      );
      const backlogService = new FulfillmentOrderCreationBacklogService(dbService, gate);
      // Isolate the cutover watermark from the redelivery short-circuit: this
      // pre-watermark order is new, so only the domain-time comparison can
      // refuse it. Passing isNewSalesOrder: false here would refuse the enqueue
      // before the watermark is ever consulted.
      await expect(
        backlogService.enqueueForSalesOrder(legacyIds.salesOrderId, {
          eventOccurredAt: '2026-07-13T23:59:59.999Z',
          isNewSalesOrder: true,
        }),
      ).resolves.toBeUndefined();
      // Redelivery of a pre-existing order is refused on its own, even with a
      // post-watermark event time.
      await expect(
        backlogService.enqueueForSalesOrder(legacyIds.salesOrderId, {
          eventOccurredAt: '2026-07-14T00:00:01.000Z',
          isNewSalesOrder: false,
        }),
      ).resolves.toBeUndefined();
      expect(await backlogRowCount(database.client, legacyIds.salesOrderId)).toBe(0);

      const variantId = randomUUID();
      const controlled = await database.db.transaction(async (tx) => {
        const [profile] = await tx
          .insert(wmsTables.deliveryProfiles)
          .values({
            name: `rehearsal-profile-${randomUUID()}`,
            sourceType: 'in_house',
            supportedFulfillmentModes: ['in_house'],
          })
          .returning();
        const [v2Sku] = await tx
          .insert(wmsTables.skus)
          .values({
            holderId: legacyIds.holderId,
            name: 'V2 controlled SKU',
            code: `V2-CONTROLLED-${randomUUID()}`,
            deliveryProfileId: profile.id,
          })
          .returning();
        await tx.insert(wmsTables.stockLedgers).values({
          skuId: v2Sku.id,
          warehouseId: legacyIds.warehouseId,
          locationId: legacyIds.locationId,
          stockState: 'ON_HAND',
          qty: 2,
        });
        await seedMatching(tx as unknown as DbTx, { variantId, skuId: v2Sku.id });
        const salesOrder = await seedSalesOrder(tx as unknown as DbTx, { lines: [{ variantId, quantity: 2 }] });
        return { ...salesOrder, skuId: v2Sku.id };
      });
      const accepted = await backlogService.enqueueForSalesOrder(controlled.salesOrderId, {
        eventOccurredAt: '2026-07-14T00:00:01.000Z',
        isNewSalesOrder: true,
      });
      expect(accepted).toMatchObject({ status: 'pending' });

      const worker = new FulfillmentOrderCreationBacklogWorker(
        dbService,
        backlogService,
        logistics.fulfillments,
        { getDefaultId: () => legacyIds.warehouseId } as never,
        gate,
      );
      await worker.processPending();

      const [backlog] = await database.db
        .select()
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, controlled.salesOrderId));
      expect(backlog.status).toBe('completed');
      expect(typeof backlog.fulfillmentOrderId).toBe('string');
      const [fo] = await database.db
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, backlog.fulfillmentOrderId!));
      const [line] = await database.db
        .select({
          shipmentId: wmsTables.shipmentLines.shipmentId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          qty: wmsTables.shipmentLines.qty,
          reservedQty: wmsTables.shipmentLines.reservedQty,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
      const [shipment] = await database.db
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, line.shipmentId));
      expect(fo).toMatchObject({ salesOrderId: controlled.salesOrderId, totalQty: 2, totalReservedQty: 2 });
      expect(shipment).toMatchObject({ status: 'draft', warehouseId: legacyIds.warehouseId });
      expect(line).toMatchObject({ skuId: controlled.skuId, qty: 2, reservedQty: 2 });

      const [exactReservation] = await database.db
        .select({
          targetType: wmsTables.stockReservations.targetType,
          quantity: wmsTables.stockReservations.quantity,
          shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        })
        .from(wmsTables.stockReservations)
        .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.shipmentLineId))
        .where(
          and(eq(wmsTables.shipmentLines.shipmentId, shipment.id), eq(wmsTables.stockReservations.status, 'confirmed')),
        );
      expect(exactReservation).toMatchObject({
        targetType: 'SHIPMENT_LINE',
        quantity: 2,
      });
      expect(typeof exactReservation.shipmentLineId).toBe('string');

      const oldRows = await database.db
        .select({ id: wmsTables.fulfillmentOrderCreationBacklogs.id })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, legacyIds.salesOrderId));
      expect(oldRows).toHaveLength(0);
      expect(await protectedHashes(database.client, legacyIds)).toEqual(hashesBeforeExpand);
    } finally {
      await destroyRehearsalDatabase(database);
    }
  });
});
