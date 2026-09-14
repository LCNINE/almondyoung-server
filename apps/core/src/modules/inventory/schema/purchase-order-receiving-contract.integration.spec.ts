import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inboundReceiptLines, inboundReceipts, inboundWorkLogs, inventorySchema } from './inventory.schema';
import {
  applyMigrations,
  causeChainMessage,
  ContractDatabaseHarness,
  describeIfDb,
  openClient,
  seedContractFixture,
  type ContractFixture,
} from './__fixtures__/purchase-order-receiving-contract-harness';

interface ContractState {
  objects: Array<{ plans: string | null; items: string | null; plan_type: string | null }>;
  columns: Array<{ table_name: string; column_name: string }>;
  planRows: Array<Record<string, unknown>>;
  itemRows: Array<Record<string, unknown>>;
  purchaseOrders: Array<Record<string, unknown>>;
  purchaseOrderLines: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  receiptLines: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  workLogs: Array<Record<string, unknown>>;
  views: Array<Record<string, unknown>>;
  stockSummary: Array<Record<string, unknown>>;
  journal: Array<Record<string, unknown>>;
}

async function captureContractState(client: postgres.Sql, fixture: ContractFixture): Promise<ContractState> {
  const objects = await client<Array<{ plans: string | null; items: string | null; plan_type: string | null }>>`
    SELECT to_regclass('public.inbound_plans')::text AS plans,
           to_regclass('public.inbound_plan_items')::text AS items,
           to_regtype('public.plan_type')::text AS plan_type`;
  const columns = await client<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ('inbound_receipt_lines', 'plan_item_id'),
         ('inbound_work_logs', 'plan_item_id')
       )
     ORDER BY table_name, column_name`;
  const planRows = objects[0]?.plans ? await client`SELECT * FROM inbound_plans ORDER BY id` : [];
  const itemRows = objects[0]?.items ? await client`SELECT * FROM inbound_plan_items ORDER BY id` : [];
  const purchaseOrders = await client`
    SELECT id, type::text, status::text, source_warehouse_id, destination_warehouse_id, requires_transfer
      FROM purchase_orders WHERE id = ${fixture.poId} ORDER BY id`;
  const purchaseOrderLines = await client`
    SELECT po_id, sku_id, quantity, status::text, ordered_qty, received_qty, closed_reason, closed_at, closed_by
      FROM purchase_order_lines WHERE po_id = ${fixture.poId} ORDER BY po_id, sku_id`;
  const receipts = await client`
    SELECT id, method::text, warehouse_id, occurred_at, status::text, total_quantity, journal_id, created_at, updated_at
      FROM inbound_receipts
     WHERE id IN (${fixture.purchaseReceiptId}, ${fixture.directReceiptId}) ORDER BY id`;
  const receiptLines = await client`
    SELECT id, receipt_id, sku_id, quantity, origin_location_id, event_id, memo, returned_qty, canceled_qty,
           putaway_from_origin_qty, source::text, created_at, updated_at
      FROM inbound_receipt_lines
     WHERE id IN (${fixture.purchaseReceiptLineId}, ${fixture.directReceiptLineId}) ORDER BY id`;
  const links = await client`
    SELECT po_id, sku_id, receipt_line_id, created_at
      FROM purchase_order_receipt_lines WHERE po_id = ${fixture.poId} ORDER BY receipt_line_id`;
  const workLogs = await client`
    SELECT id, type::text, timestamp, receipt_id, line_id, sku_id, warehouse_id, from_location_id, to_location_id,
           quantity, method::text, reason, event_id
      FROM inbound_work_logs WHERE id = ${fixture.workLogId} ORDER BY id`;
  const views = await client`
    SELECT c.oid::text AS oid, n.nspname AS schema_name, c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'v' AND n.nspname = 'public'
     ORDER BY c.relname`;
  const stockSummary = await client`
    SELECT sku_id, warehouse_id, on_hand_qty, defective_qty, in_transfer_qty, reserved_qty, available_qty,
           inbound_pending_qty, on_order_qty, transfer_pending_qty, projected_available_qty
      FROM stock_summary_view
     WHERE sku_id IN (${fixture.poSkuId}, ${fixture.directSkuId})
       AND warehouse_id IN (${fixture.warehouseId}, ${fixture.otherWarehouseId})
     ORDER BY sku_id, warehouse_id`;
  const journal = await client`
    SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`;

  return {
    objects,
    columns,
    planRows,
    itemRows,
    purchaseOrders,
    purchaseOrderLines,
    receipts,
    receiptLines,
    links,
    workLogs,
    views,
    stockSummary,
    journal,
  };
}

async function expectContractRejected(
  harness: ContractDatabaseHarness,
  label: string,
  prepare: (client: postgres.Sql, fixture: ContractFixture) => Promise<void>,
  expectedMessage: RegExp,
  verifyPreserved?: (client: postgres.Sql) => Promise<void>,
): Promise<void> {
  await harness.withPrBDatabase(label, async ({ client }) => {
    const fixture = await seedContractFixture(client);
    await prepare(client, fixture);
    const before = await captureContractState(client, fixture);
    let caught: unknown;
    try {
      await applyMigrations(client, harness.chain.throughContract);
    } catch (error) {
      caught = error;
    }
    expect(causeChainMessage(caught)).toMatch(expectedMessage);
    expect(await captureContractState(client, fixture)).toEqual(before);
    await verifyPreserved?.(client);
  });
}

async function insertAndReadWithCurrentSchema(
  client: postgres.Sql,
  fixture: ContractFixture,
  memo: string,
): Promise<void> {
  const db = drizzle(client, { schema: inventorySchema });
  const receiptId = randomUUID();
  const lineId = randomUUID();
  const workLogId = randomUUID();
  await db.insert(inboundReceipts).values({
    id: receiptId,
    method: 'simple',
    warehouseId: fixture.warehouseId,
    occurredAt: new Date('2026-09-11T01:02:03Z'),
    totalQuantity: 3,
  });
  await db.insert(inboundReceiptLines).values({
    id: lineId,
    receiptId,
    skuId: fixture.directSkuId,
    quantity: 3,
    source: 'direct',
    memo,
  });
  await db.insert(inboundWorkLogs).values({
    id: workLogId,
    type: 'INBOUND',
    receiptId,
    lineId,
    skuId: fixture.directSkuId,
    warehouseId: fixture.warehouseId,
    quantity: 3,
    method: 'simple',
    reason: memo,
  });
  expect(
    await db
      .select({ id: inboundReceiptLines.id, memo: inboundReceiptLines.memo, source: inboundReceiptLines.source })
      .from(inboundReceiptLines)
      .where(eq(inboundReceiptLines.id, lineId)),
  ).toEqual([{ id: lineId, memo, source: 'direct' }]);
  expect(
    await db
      .select({ id: inboundWorkLogs.id, reason: inboundWorkLogs.reason })
      .from(inboundWorkLogs)
      .where(eq(inboundWorkLogs.id, workLogId)),
  ).toEqual([{ id: workLogId, reason: memo }]);
}

describeIfDb('purchase-order receiving PR-C contract migration (isolated PostgreSQL)', () => {
  jest.setTimeout(240_000);
  const harness = new ContractDatabaseHarness();

  beforeAll(async () => {
    await harness.setup();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('keeps PR-B backfill, PR-C guard, and PR-C DDL consecutive in that order', () => {
    const backfillIndex = harness.chain.tags.findIndex((tag) => tag.endsWith('_backfill-purchase-order-receiving'));
    expect(harness.chain.tags.slice(backfillIndex, backfillIndex + 3).map((tag) => tag.replace(/^\d+_/, ''))).toEqual([
      'backfill-purchase-order-receiving',
      'guard-purchase-order-receiving-contract',
      'drop-legacy-inbound-plans',
    ]);
  });

  it('installs the clean empty chain through the contract migration', async () => {
    await harness.withEmptyDatabase('empty_chain', async ({ client }) => {
      await applyMigrations(client, harness.chain.throughContract);
      expect(await client`SELECT to_regclass('public.inbound_plans') AS name`).toEqual([{ name: null }]);
      expect(await client`SELECT to_regclass('public.inbound_plan_items') AS name`).toEqual([{ name: null }]);
      expect(await client`SELECT to_regtype('public.plan_type') AS name`).toEqual([{ name: null }]);
    });
  });

  it('drops only the legacy contract and preserves receiving data plus every existing view', async () => {
    await harness.withPrBDatabase('acceptance', async ({ client }) => {
      const fixture = await seedContractFixture(client);
      const before = await captureContractState(client, fixture);

      await applyMigrations(client, harness.chain.throughContract);

      expect(await client`SELECT to_regclass('public.inbound_plans') AS name`).toEqual([{ name: null }]);
      expect(await client`SELECT to_regclass('public.inbound_plan_items') AS name`).toEqual([{ name: null }]);
      expect(await client`SELECT to_regtype('public.plan_type') AS name`).toEqual([{ name: null }]);
      expect(
        await client`
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             ('inbound_receipt_lines', 'plan_item_id'),
             ('inbound_work_logs', 'plan_item_id')
           )`,
      ).toEqual([]);

      const after = await captureContractState(client, fixture);
      expect(after.purchaseOrders).toEqual(before.purchaseOrders);
      expect(after.purchaseOrderLines).toEqual(before.purchaseOrderLines);
      expect(after.receipts).toEqual(before.receipts);
      expect(after.receiptLines).toEqual(before.receiptLines);
      expect(after.links).toEqual(before.links);
      expect(after.workLogs).toEqual(before.workLogs);
      expect(after.views).toEqual(before.views);
      expect(after.stockSummary).toEqual(before.stockSummary);
      expect(after.journal).toHaveLength(before.journal.length + 2);
    });
  });

  it('rejects a legacy plan item without a matching purchase-order line and rolls back', async () => {
    await expectContractRejected(
      harness,
      'orphan_item',
      async (client, fixture) => {
        await client`INSERT INTO inbound_plan_items (plan_id, sku_id, expected_qty)
          VALUES (${fixture.planId}, ${fixture.directSkuId}, 1)`;
      },
      /PR-C guard:.*발주 라인/,
    );
  });

  it('rejects a legacy receipt line without a purchase-order receipt link and rolls back', async () => {
    await harness.withPrBDatabase('missing_link', async ({ client }) => {
      const fixture = await seedContractFixture(client, { createLink: false });
      const before = await captureContractState(client, fixture);
      let caught: unknown;
      try {
        await applyMigrations(client, harness.chain.throughContract);
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/PR-C guard:.*링크/);
      expect(await captureContractState(client, fixture)).toEqual(before);
    });
  });

  it('rejects a received counter that differs from net linked receipts including cancellation and rolls back', async () => {
    await harness.withPrBDatabase('stale_counter', async ({ client }) => {
      const fixture = await seedContractFixture(client, { receivedQty: 7, receiptQuantity: 7, canceledQty: 2 });
      const before = await captureContractState(client, fixture);
      let caught: unknown;
      try {
        await applyMigrations(client, harness.chain.throughContract);
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/PR-C guard:.*누계/);
      expect(await captureContractState(client, fixture)).toEqual(before);
    });
  });

  it('times out behind a concurrent purchase-order-line writer and leaves PR-B unchanged', async () => {
    await harness.withPrBDatabase('lock_timeout', async ({ client, url }) => {
      const fixture = await seedContractFixture(client);
      const before = await captureContractState(client, fixture);
      const blocker = openClient(url);
      try {
        await blocker.unsafe('BEGIN');
        await blocker.unsafe('LOCK TABLE purchase_order_lines IN ROW EXCLUSIVE MODE');
        let caught: unknown;
        try {
          await applyMigrations(client, harness.chain.throughContract);
        } catch (error) {
          caught = error;
        }
        expect(causeChainMessage(caught)).toMatch(/lock timeout|canceling statement due to lock timeout/i);
        expect(await captureContractState(client, fixture)).toEqual(before);
      } finally {
        await blocker.unsafe('ROLLBACK');
        await blocker.end();
      }
    });
  });

  it.each([
    [
      'a view over a legacy plan table',
      'CREATE VIEW contract_plan_view AS SELECT id FROM inbound_plans',
      'contract_plan_view',
    ],
    [
      'a view over a removed surviving-table column',
      'CREATE VIEW contract_plan_column_view AS SELECT plan_item_id FROM inbound_receipt_lines',
      'contract_plan_column_view',
    ],
    [
      'an external column using plan_type',
      'CREATE TABLE contract_plan_type_dependency (kind plan_type NOT NULL)',
      'contract_plan_type_dependency',
    ],
    [
      'an unexpected foreign key to a legacy plan table',
      'CREATE TABLE contract_plan_fk_dependency (plan_id uuid REFERENCES inbound_plans(id))',
      'contract_plan_fk_dependency',
    ],
  ])(
    'rejects %s without deleting any dependent object or migration history',
    async (_label, dependencySql, dependencyName) => {
      await expectContractRejected(
        harness,
        `dependency_${randomUUID().slice(0, 8)}`,
        async (client) => {
          await client.unsafe(dependencySql);
        },
        /depend|cannot drop|still reference/i,
        async (client) => {
          expect(await client`SELECT to_regclass(${`public.${dependencyName}`})::text AS name`).toEqual([
            { name: dependencyName },
          ]);
          if (dependencyName === 'contract_plan_fk_dependency') {
            expect(
              await client`
                SELECT conname FROM pg_constraint
                 WHERE conrelid = 'contract_plan_fk_dependency'::regclass AND contype = 'f'`,
            ).toHaveLength(1);
          }
        },
      );
    },
  );

  it('uses the current Drizzle schema for insert and select before and after contract migration', async () => {
    await harness.withPrBDatabase('drizzle_transition', async ({ client }) => {
      const fixture = await seedContractFixture(client);
      await insertAndReadWithCurrentSchema(client, fixture, 'before contract');
      await applyMigrations(client, harness.chain.throughContract);
      await insertAndReadWithCurrentSchema(client, fixture, 'after contract');
    });
  });
});
