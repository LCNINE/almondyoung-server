import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import type { Sql } from 'postgres';
import {
  CLEANUP_ALLOWLIST,
  assertArtifactIntegrity,
  cleanup,
  createAuditArtifact,
  sealArtifact,
  verify,
  type AuditArtifact,
  type AuditArtifactBody,
} from './toolkit';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_FULFILLMENT_V2_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the fulfillment V2 cutover integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const CUTOVER_AT = '2026-07-14T00:00:00.000Z';
const SIGNING_KEY = 'fulfillment-v2-integration-test-signing-key';

type Fixture = {
  sql: Sql;
  schema: string;
  ids: {
    warehouseId: string;
    skuId: string;
    locationId: string;
    salesOrderId: string;
    fulfillmentOrderId: string;
    fulfillmentOrderItemId: string;
    shipmentId: string;
  };
};

async function createFixture(): Promise<Fixture> {
  const sql = postgres(DATABASE_URL as string, { max: 1, prepare: false });
  const schema = `fulfillment_v2_cutover_${randomUUID().replaceAll('-', '')}`;
  await sql.unsafe(`CREATE SCHEMA "${schema}"`);
  await sql.unsafe(`SET search_path TO "${schema}"`);

  const statements = [
    'CREATE TABLE warehouses (id uuid PRIMARY KEY)',
    'CREATE TABLE skus (id uuid PRIMARY KEY)',
    'CREATE TABLE locations (id uuid PRIMARY KEY, warehouse_id uuid NOT NULL)',
    'CREATE TABLE sales_orders (id uuid PRIMARY KEY, created_at timestamptz NOT NULL)',
    'CREATE TABLE sales_order_lines (id uuid PRIMARY KEY, sales_order_id uuid NOT NULL)',
    'CREATE TABLE outbound_batches (id uuid PRIMARY KEY, status text NOT NULL)',
    `CREATE TABLE fulfillment_orders (
      id uuid PRIMARY KEY,
      sales_order_id uuid REFERENCES sales_orders(id),
      batch_id uuid REFERENCES outbound_batches(id)
    )`,
    `CREATE TABLE fulfillment_order_items (
      id uuid PRIMARY KEY,
      fulfillment_order_id uuid NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
      sku_id uuid NOT NULL
    )`,
    `CREATE TABLE fulfillment_order_creation_backlogs (
      id uuid PRIMARY KEY,
      sales_order_id uuid NOT NULL REFERENCES sales_orders(id),
      fulfillment_order_id uuid REFERENCES fulfillment_orders(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE stock_reservations (
      id uuid PRIMARY KEY,
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      fulfillment_order_item_id uuid REFERENCES fulfillment_order_items(id) ON DELETE CASCADE,
      sku_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      quantity integer NOT NULL,
      status text NOT NULL
    )`,
    `CREATE TABLE shipments (
      id uuid PRIMARY KEY,
      opened_for_fulfillment_order_id uuid REFERENCES fulfillment_orders(id) ON DELETE SET NULL,
      status text NOT NULL
    )`,
    `CREATE TABLE shipment_lines (
      id uuid PRIMARY KEY,
      shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      fulfillment_order_item_id uuid NOT NULL REFERENCES fulfillment_order_items(id),
      sku_id uuid NOT NULL
    )`,
    `CREATE TABLE shipment_tracking (
      id uuid PRIMARY KEY,
      shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE inspection_issues (
      id uuid PRIMARY KEY,
      foi_id uuid NOT NULL REFERENCES fulfillment_order_items(id) ON DELETE CASCADE,
      shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE invoices (
      id uuid PRIMARY KEY,
      issued_for_fulfillment_order_id uuid NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
      shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
      status text NOT NULL
    )`,
    `CREATE TABLE fulfillment_order_batches (
      fulfillment_order_id uuid NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
      batch_id uuid NOT NULL REFERENCES outbound_batches(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE outbox_events (
      id uuid PRIMARY KEY,
      event_type text NOT NULL,
      aggregate_type text NOT NULL,
      status text NOT NULL,
      published_at timestamptz,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb
    )`,
    `CREATE TABLE stock_journals (
      id uuid PRIMARY KEY,
      source_type text,
      source_id uuid
    )`,
    `CREATE TABLE stock_events (
      id uuid PRIMARY KEY,
      journal_id uuid REFERENCES stock_journals(id),
      sku_id uuid NOT NULL,
      from_warehouse_id uuid,
      from_location_id uuid,
      to_warehouse_id uuid,
      to_location_id uuid,
      from_state text,
      to_state text,
      transition_type text NOT NULL,
      quantity integer NOT NULL,
      event_status text NOT NULL,
      voided_by_event_id uuid
    )`,
    `CREATE TABLE stock_ledgers (
      sku_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      location_id uuid NOT NULL,
      stock_state text NOT NULL,
      qty integer NOT NULL,
      PRIMARY KEY (sku_id, warehouse_id, location_id, stock_state)
    )`,
    'CREATE TABLE audit_logs (id uuid PRIMARY KEY)',
    `CREATE TABLE order_events (
      id uuid PRIMARY KEY,
      event_id text NOT NULL UNIQUE,
      order_id uuid NOT NULL REFERENCES sales_orders(id),
      event_type text NOT NULL,
      payload jsonb NOT NULL
    )`,
    `CREATE TABLE returns (
      id uuid PRIMARY KEY,
      shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL
    )`,
    'CREATE TABLE dispatch_attempts (id uuid PRIMARY KEY)',
  ];
  for (const statement of statements) await sql.unsafe(statement);

  const ids = {
    warehouseId: randomUUID(),
    skuId: randomUUID(),
    locationId: randomUUID(),
    salesOrderId: randomUUID(),
    fulfillmentOrderId: randomUUID(),
    fulfillmentOrderItemId: randomUUID(),
    shipmentId: randomUUID(),
  };
  const batchId = randomUUID();
  const receiveJournalId = randomUUID();

  await sql.unsafe(`INSERT INTO warehouses VALUES ('${ids.warehouseId}')`);
  await sql.unsafe(`INSERT INTO skus VALUES ('${ids.skuId}')`);
  await sql.unsafe(`INSERT INTO locations VALUES ('${ids.locationId}', '${ids.warehouseId}')`);
  await sql.unsafe(`INSERT INTO sales_orders VALUES ('${ids.salesOrderId}', '2026-07-13T00:00:00Z')`);
  await sql.unsafe(`INSERT INTO sales_order_lines VALUES ('${randomUUID()}', '${ids.salesOrderId}')`);
  await sql.unsafe(`INSERT INTO outbound_batches VALUES ('${batchId}', 'created')`);
  await sql.unsafe(
    `INSERT INTO fulfillment_orders VALUES ('${ids.fulfillmentOrderId}', '${ids.salesOrderId}', '${batchId}')`,
  );
  await sql.unsafe(
    `INSERT INTO fulfillment_order_items VALUES ` +
      `('${ids.fulfillmentOrderItemId}', '${ids.fulfillmentOrderId}', '${ids.skuId}')`,
  );
  await sql.unsafe(
    `INSERT INTO fulfillment_order_creation_backlogs VALUES ` +
      `('${randomUUID()}', '${ids.salesOrderId}', '${ids.fulfillmentOrderId}')`,
  );
  await sql.unsafe(
    `INSERT INTO stock_reservations VALUES ` +
      `('${randomUUID()}', 'FULFILLMENT_ORDER', '${ids.fulfillmentOrderId}', ` +
      `'${ids.fulfillmentOrderItemId}', '${ids.skuId}', '${ids.warehouseId}', 2, 'confirmed'), ` +
      `('${randomUUID()}', 'TRANSFER', '${randomUUID()}', NULL, ` +
      `'${ids.skuId}', '${ids.warehouseId}', 1, 'confirmed')`,
  );
  await sql.unsafe(`INSERT INTO shipments VALUES ('${ids.shipmentId}', '${ids.fulfillmentOrderId}', 'open')`);
  await sql.unsafe(
    `INSERT INTO shipment_lines VALUES ` +
      `('${randomUUID()}', '${ids.shipmentId}', '${ids.fulfillmentOrderItemId}', '${ids.skuId}')`,
  );
  await sql.unsafe(`INSERT INTO shipment_tracking VALUES ('${randomUUID()}', '${ids.shipmentId}')`);
  await sql.unsafe(
    `INSERT INTO inspection_issues VALUES ` +
      `('${randomUUID()}', '${ids.fulfillmentOrderItemId}', '${ids.shipmentId}')`,
  );
  await sql.unsafe(
    `INSERT INTO invoices VALUES ` + `('${randomUUID()}', '${ids.fulfillmentOrderId}', '${ids.shipmentId}', 'issued')`,
  );
  await sql.unsafe(`INSERT INTO fulfillment_order_batches VALUES ('${ids.fulfillmentOrderId}', '${batchId}')`);
  await sql.unsafe(
    `INSERT INTO outbox_events VALUES ` +
      `('${randomUUID()}', 'FulfillmentShipped', 'fulfillment', 'pending', NULL, '{}'), ` +
      `('${randomUUID()}', 'FulfillmentUnexpected', 'FulfillmentOrder', 'pending', now(), '{}'), ` +
      `('${randomUUID()}', 'ShipmentUnexpected', 'Other', 'failed', NULL, '{}'), ` +
      `('${randomUUID()}', 'StockAdjusted', 'Stock', 'pending', NULL, '{}')`,
  );
  await sql.unsafe(`INSERT INTO stock_journals VALUES ('${receiveJournalId}', 'RECEIPT', NULL)`);
  await sql.unsafe(
    `INSERT INTO stock_events VALUES ` +
      `('${randomUUID()}', '${receiveJournalId}', '${ids.skuId}', NULL, NULL, '${ids.warehouseId}', ` +
      `'${ids.locationId}', NULL, 'ON_HAND', 'RECEIVE', 10, 'POSTED', NULL)`,
  );
  await sql.unsafe(
    `INSERT INTO stock_ledgers VALUES ` + `('${ids.skuId}', '${ids.warehouseId}', '${ids.locationId}', 'ON_HAND', 10)`,
  );
  await sql.unsafe(
    `INSERT INTO order_events VALUES ` +
      `('${randomUUID()}', '${randomUUID()}', '${ids.salesOrderId}', 'ORDER_CREATED', ` +
      `' {"createdAt":"2026-07-13T00:00:00.000Z"}')`,
  );
  return { sql, schema, ids };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
  await fixture.sql.unsafe('SET search_path TO public');
  await fixture.sql.unsafe(`DROP SCHEMA "${fixture.schema}" CASCADE`);
  await fixture.sql.end({ timeout: 5 });
}

async function audit(fixture: Fixture): Promise<AuditArtifact> {
  return createAuditArtifact(fixture.sql, {
    cutoverAt: CUTOVER_AT,
    workflowMode: 'maintenance',
    signingKey: SIGNING_KEY,
  });
}

function cleanupOptions(artifact: AuditArtifact, overrides: Record<string, unknown> = {}) {
  return {
    artifact,
    snapshotId: 'snapshot-test-001',
    execute: true,
    workflowMode: 'maintenance',
    cutoverAt: CUTOVER_AT,
    signingKey: SIGNING_KEY,
    ...overrides,
  };
}

function artifactBody(overrides: Partial<AuditArtifactBody> = {}): AuditArtifactBody {
  return {
    schemaVersion: 'fulfillment-v2-cutover-audit/v1',
    generatedAt: new Date(0).toISOString(),
    database: {
      database: 'core',
      databaseOid: '1',
      schema: 'public',
      serverAddress: 'local',
      serverPort: 5432,
    },
    workflowMode: 'maintenance',
    cutoverAt: CUTOVER_AT,
    snapshotId: '__PLATFORM_SNAPSHOT_ID_REQUIRED_BEFORE_CLEANUP__',
    allowlist: CLEANUP_ALLOWLIST,
    state: {} as AuditArtifactBody['state'],
    auditStateHash: '0'.repeat(64),
    protectedFingerprints: {},
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

describe('fulfillment V2 audit integrity', () => {
  it('detects an artifact modified after hashing', () => {
    const body = artifactBody();
    const artifact = sealArtifact(body, SIGNING_KEY);
    artifact.workflowMode = 'v2';
    expect(() => assertArtifactIntegrity(artifact, SIGNING_KEY)).toThrow('hash mismatch');
  });

  it('rejects an artifact whose signed allowlist does not match the executing toolkit', async () => {
    const artifact = sealArtifact(
      artifactBody({ allowlist: [] as unknown as AuditArtifactBody['allowlist'] }),
      SIGNING_KEY,
    );

    await expect(cleanup({} as Sql, cleanupOptions(artifact))).rejects.toThrow('allowlist does not match');
  });

  it('requires a signed artifact for every destructive cleanup, regardless of NODE_ENV', async () => {
    const artifact = sealArtifact(artifactBody());

    await expect(
      cleanup({} as Sql, cleanupOptions(artifact, { signingKey: undefined, execute: true })),
    ).rejects.toThrow('Cleanup --execute requires an HMAC-signed artifact');
  });
});

describeIfDb('fulfillment V2 hard-cutover cleanup (DB integration)', () => {
  jest.setTimeout(30_000);

  it('aborts when a shipment-linked SHIP journal/event exists', async () => {
    const fixture = await createFixture();
    try {
      const journalId = randomUUID();
      await fixture.sql.unsafe(
        `INSERT INTO stock_journals VALUES ('${journalId}', 'SHIPMENT', '${fixture.ids.shipmentId}')`,
      );
      await fixture.sql.unsafe(
        `INSERT INTO stock_events VALUES ` +
          `('${randomUUID()}', '${journalId}', '${fixture.ids.skuId}', '${fixture.ids.warehouseId}', ` +
          `'${fixture.ids.locationId}', NULL, NULL, 'ON_HAND', NULL, 'SHIP', 1, 'POSTED', NULL)`,
      );
      const artifact = await audit(fixture);
      expect(artifact.blockers.join(' ')).toContain('SHIP evidence exists');
      await expect(cleanup(fixture.sql, cleanupOptions(artifact))).rejects.toThrow('Audit has blockers');
      const [shipment] = await fixture.sql.unsafe<Array<{ rows: number }>>('SELECT count(*)::int rows FROM shipments');
      expect(shipment.rows).toBe(1);
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('preserves unrelated reservations/outbox and protected stock/order data', async () => {
    const fixture = await createFixture();
    try {
      const artifact = await audit(fixture);
      expect(artifact.blockers).toEqual([]);
      await cleanup(fixture.sql, cleanupOptions(artifact));

      const [target] = await fixture.sql.unsafe<Array<{ rows: number }>>(
        "SELECT count(*)::int rows FROM stock_reservations WHERE lower(target_type) = 'fulfillment_order'",
      );
      const [unrelatedReservation] = await fixture.sql.unsafe<Array<{ rows: number }>>(
        "SELECT count(*)::int rows FROM stock_reservations WHERE target_type = 'TRANSFER'",
      );
      const [unrelatedOutbox] = await fixture.sql.unsafe<Array<{ rows: number }>>(
        "SELECT count(*)::int rows FROM outbox_events WHERE aggregate_type = 'Stock'",
      );
      const [replayableFulfillmentOutbox] = await fixture.sql.unsafe<Array<{ rows: number }>>(
        `SELECT count(*)::int rows FROM outbox_events
          WHERE status IN ('pending', 'failed')
            AND (lower(aggregate_type) IN ('fulfillment', 'fulfillment_order', 'fulfillmentorder', 'shipment')
              OR lower(event_type) LIKE 'fulfillment%' OR lower(event_type) LIKE 'shipment%')`,
      );
      const [protectedRows] = await fixture.sql.unsafe<Array<{ orders: number; events: number; ledgers: number }>>(`
        SELECT (SELECT count(*) FROM sales_orders)::int AS orders,
               (SELECT count(*) FROM stock_events)::int AS events,
               (SELECT count(*) FROM stock_ledgers)::int AS ledgers
      `);
      expect(target.rows).toBe(0);
      expect(unrelatedReservation.rows).toBe(1);
      expect(unrelatedOutbox.rows).toBe(1);
      expect(replayableFulfillmentOutbox.rows).toBe(0);
      expect(protectedRows).toEqual({ orders: 1, events: 1, ledgers: 1 });
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('rolls back every prior delete when cleanup fails mid-transaction', async () => {
    const fixture = await createFixture();
    try {
      const artifact = await audit(fixture);
      await expect(cleanup(fixture.sql, cleanupOptions(artifact, { failAfterStep: 'invoices' }))).rejects.toThrow(
        'Injected failure',
      );
      const [remaining] = await fixture.sql.unsafe<
        Array<{ backlogs: number; invoices: number; reservations: number }>
      >(`
        SELECT (SELECT count(*) FROM fulfillment_order_creation_backlogs)::int AS backlogs,
               (SELECT count(*) FROM invoices)::int AS invoices,
               (SELECT count(*) FROM stock_reservations
                 WHERE lower(target_type) = 'fulfillment_order')::int AS reservations
      `);
      expect(remaining).toEqual({ backlogs: 1, invoices: 1, reservations: 1 });
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('blocks a non-FO reservation that would be cascaded through an allowlisted table FK', async () => {
    const fixture = await createFixture();
    try {
      await fixture.sql.unsafe(
        `UPDATE stock_reservations
            SET fulfillment_order_item_id = '${fixture.ids.fulfillmentOrderItemId}'
          WHERE target_type = 'TRANSFER'`,
      );

      const artifact = await audit(fixture);

      expect(artifact.blockers.join(' ')).toContain('Non-allowlisted FK');
      expect(
        artifact.state.foreignKeyClosure.some(
          (edge) => edge.sourceTable === 'stock_reservations' && edge.uncoveredReferencingRows === 1,
        ),
      ).toBe(true);
      await expect(cleanup(fixture.sql, cleanupOptions(artifact))).rejects.toThrow('Audit has blockers');
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('fails verification if a V2 row appears after cleanup', async () => {
    const fixture = await createFixture();
    try {
      const artifact = await audit(fixture);
      await cleanup(fixture.sql, cleanupOptions(artifact));
      await fixture.sql.unsafe(`INSERT INTO dispatch_attempts VALUES ('${randomUUID()}')`);

      await expect(
        verify(fixture.sql, artifact, {
          workflowMode: 'maintenance',
          cutoverAt: CUTOVER_AT,
          signingKey: SIGNING_KEY,
        }),
      ).rejects.toThrow('noV2RowsBeforeActivation');
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('finds SHIP evidence by audited shipment ID even after the shipment row was deleted', async () => {
    const fixture = await createFixture();
    try {
      const artifact = await audit(fixture);
      await cleanup(fixture.sql, cleanupOptions(artifact));
      await fixture.sql.unsafe(
        `INSERT INTO stock_journals VALUES ('${randomUUID()}', 'SHIPMENT', '${fixture.ids.shipmentId}')`,
      );

      await expect(
        verify(fixture.sql, artifact, {
          workflowMode: 'maintenance',
          cutoverAt: CUTOVER_AT,
          signingKey: SIGNING_KEY,
        }),
      ).rejects.toThrow('noShipEvidenceForAuditedShipments');
    } finally {
      await destroyFixture(fixture);
    }
  });

  it('keeps dry-run read-only and verify is idempotent after cleanup', async () => {
    const fixture = await createFixture();
    try {
      const artifact = await audit(fixture);
      const dryRun = await cleanup(fixture.sql, cleanupOptions(artifact, { execute: false }));
      expect(dryRun).toEqual({});
      const [beforeExecute] = await fixture.sql.unsafe<Array<{ rows: number }>>(
        'SELECT count(*)::int rows FROM fulfillment_orders',
      );
      expect(beforeExecute.rows).toBe(1);

      await cleanup(fixture.sql, cleanupOptions(artifact));
      const first = await verify(fixture.sql, artifact, {
        workflowMode: 'maintenance',
        cutoverAt: CUTOVER_AT,
        signingKey: SIGNING_KEY,
      });
      const second = await verify(fixture.sql, artifact, {
        workflowMode: 'maintenance',
        cutoverAt: CUTOVER_AT,
        signingKey: SIGNING_KEY,
      });
      expect(Object.values(first.checks).every(Boolean)).toBe(true);
      expect(second.checks).toEqual(first.checks);
    } finally {
      await destroyFixture(fixture);
    }
  });
});
