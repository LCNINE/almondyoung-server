import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import type { Sql, TransactionSql } from 'postgres';

type QuerySql = Sql | TransactionSql;

export const AUDIT_SCHEMA_VERSION = 'fulfillment-v2-cutover-audit/v1' as const;
export const SNAPSHOT_ID_PLACEHOLDER = '__PLATFORM_SNAPSHOT_ID_REQUIRED_BEFORE_CLEANUP__' as const;
export const CUTOVER_LOCK_KEY = 'fulfillment-v2-hard-cutover/v1' as const;

const CLEANUP_TABLES = [
  'fulfillment_order_creation_backlogs',
  'stock_reservations',
  'shipment_tracking',
  'inspection_issues',
  'invoices',
  'shipment_lines',
  'shipments',
  'fulfillment_order_batches',
  'fulfillment_order_items',
  'fulfillment_orders',
  'outbound_batches',
  'outbox_events',
] as const;

const FULL_DELETE_TABLES = new Set<string>([
  'fulfillment_order_creation_backlogs',
  'shipment_tracking',
  'inspection_issues',
  'invoices',
  'shipment_lines',
  'shipments',
  'fulfillment_order_batches',
  'fulfillment_order_items',
  'fulfillment_orders',
  'outbound_batches',
]);

const PROTECTED_TABLES = [
  'sales_orders',
  'sales_order_lines',
  'skus',
  'warehouses',
  'locations',
  'stock_journals',
  'stock_events',
  'stock_ledgers',
  'audit_logs',
  'order_events',
] as const;

const V2_ONLY_TABLES = [
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

export const CLEANUP_ALLOWLIST = [
  {
    table: 'fulfillment_order_creation_backlogs',
    predicate: 'all rows',
    reason: 'pre-cutover FO creation queue',
  },
  {
    table: 'stock_reservations',
    predicate: "lower(target_type) = 'fulfillment_order'",
    reason: 'V1 FO-target reservations only',
  },
  { table: 'shipment_tracking', predicate: 'all rows', reason: 'V1 shipment tracking' },
  { table: 'inspection_issues', predicate: 'all rows', reason: 'V1 FO/shipment inspection work' },
  { table: 'invoices', predicate: 'all rows', reason: 'V1 FO-owned invoices' },
  { table: 'shipment_lines', predicate: 'all rows', reason: 'V1 shipment lines' },
  { table: 'shipments', predicate: 'all rows', reason: 'V1 shipments' },
  { table: 'fulfillment_order_batches', predicate: 'all rows', reason: 'V1 FO/batch membership' },
  { table: 'fulfillment_order_items', predicate: 'all rows', reason: 'V1 fulfillment demand rows' },
  { table: 'fulfillment_orders', predicate: 'all rows', reason: 'V1 fulfillment orders' },
  { table: 'outbound_batches', predicate: 'all rows', reason: 'V1 outbound batches' },
  {
    table: 'outbox_events',
    predicate: "status IN ('pending','failed') AND fulfillment/shipment aggregate or event family",
    reason: 'all replayable V1 fulfillment/shipment rows covered by the maintenance dispatcher filter',
  },
] as const;

export type DatabaseIdentity = {
  database: string;
  databaseOid: string;
  schema: string;
  serverAddress: string;
  serverPort: number | null;
};

export type RowCount = { rows: number };
export type StatusCount = { status: string; rows: number; quantity?: number };
export type AffectedStock = {
  warehouseId: string;
  skuId: string;
  pendingQty: number;
  confirmedQty: number;
  totalQty: number;
};

export type ForeignKeyClosure = {
  constraint: string;
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  deleteAction: string;
  referencingRows: number;
  uncoveredReferencingRows: number;
  sourceAllowlisted: boolean;
};

export type AuditState = {
  counts: Record<string, RowCount>;
  reservationStatus: StatusCount[];
  invoiceStatus: StatusCount[];
  shipmentStatus: StatusCount[];
  batchStatus: StatusCount[];
  affectedStock: AffectedStock[];
  shipEvidence: { journals: number; events: number; shipmentIds: string[] };
  foreignKeyClosure: ForeignKeyClosure[];
  replaySafety: {
    invalidCreatedAtEvents: number;
    oldCreatedEvents: number;
    oldEventsWithBacklog: number;
    oldEventsWithFulfillmentOrder: number;
  };
  v2Rows: Record<string, RowCount>;
};

export type Fingerprint = { rows: number; digest: string };

export type AuditArtifactBody = {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  generatedAt: string;
  database: DatabaseIdentity;
  workflowMode: string;
  cutoverAt: string;
  snapshotId: typeof SNAPSHOT_ID_PLACEHOLDER;
  allowlist: typeof CLEANUP_ALLOWLIST;
  state: AuditState;
  auditStateHash: string;
  protectedFingerprints: Record<string, Fingerprint>;
  blockers: string[];
  warnings: string[];
};

export type AuditArtifact = AuditArtifactBody & {
  integrity: {
    algorithm: 'sha256';
    artifactHash: string;
    signature: { algorithm: 'hmac-sha256'; digest: string } | null;
  };
};

export type VerificationReport = {
  verifiedAt: string;
  auditHash: string;
  database: DatabaseIdentity;
  checks: Record<string, boolean>;
  reservationDrift: ReservationDrift[];
  ledgerDrift: LedgerDrift[];
  replaySafety: AuditState['replaySafety'];
};

type ReservationDrift = {
  warehouseId: string;
  skuId: string;
  onHandQty: number;
  confirmedReservationQty: number;
  shortfall: number;
};

type LedgerDrift = {
  warehouseId: string;
  skuId: string;
  locationId: string;
  stockState: string;
  eventDerivedQty: number;
  ledgerQty: number;
  delta: number;
};

type CreateAuditOptions = {
  cutoverAt: string;
  workflowMode: string;
  signingKey?: string;
};

type CleanupOptions = {
  artifact: AuditArtifact;
  snapshotId: string;
  execute: boolean;
  workflowMode: string;
  cutoverAt: string;
  signingKey?: string;
  failAfterStep?: string;
};

export function connectDatabase(databaseUrl = process.env.DATABASE_URL): Sql {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (Core logical database).');
  }
  return postgres(databaseUrl, { max: 1, prepare: false });
}

export function requireCutoverAt(value = process.env.FULFILLMENT_V2_CUTOVER_AT): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error('FULFILLMENT_V2_CUTOVER_AT must be a valid ISO timestamp.');
  }
  return new Date(value).toISOString();
}

export function requireWorkflowMode(value = process.env.FULFILLMENT_WORKFLOW_MODE): string {
  if (!value || !['legacy', 'maintenance', 'v2'].includes(value)) {
    throw new Error('FULFILLMENT_WORKFLOW_MODE must be legacy, maintenance, or v2.');
  }
  return value;
}

export function parseArgs(argv: string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const equals = token.indexOf('=');
    if (equals >= 0) {
      parsed.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

export function requiredArg(args: Map<string, string | true>, name: string): string {
  const value = args.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
}

function signHash(hash: string, signingKey?: string): AuditArtifact['integrity']['signature'] {
  if (!signingKey) return null;
  if (Buffer.byteLength(signingKey, 'utf8') < 32) {
    throw new Error('FULFILLMENT_V2_AUDIT_SIGNING_KEY must contain at least 32 bytes.');
  }
  return { algorithm: 'hmac-sha256', digest: createHmac('sha256', signingKey).update(hash).digest('hex') };
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function sealArtifact(body: AuditArtifactBody, signingKey?: string): AuditArtifact {
  const artifactHash = sha256(body);
  return {
    ...body,
    integrity: { algorithm: 'sha256', artifactHash, signature: signHash(artifactHash, signingKey) },
  };
}

export function assertArtifactIntegrity(artifact: AuditArtifact, signingKey?: string): void {
  if (artifact.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new Error(`Unsupported audit schema: ${String(artifact.schemaVersion)}`);
  }
  const { integrity, ...body } = artifact;
  const computed = sha256(body);
  if (!safeEqualHex(integrity.artifactHash, computed)) {
    throw new Error('Audit artifact hash mismatch; the artifact was modified or corrupted.');
  }
  if (integrity.signature) {
    if (!signingKey) {
      throw new Error('FULFILLMENT_V2_AUDIT_SIGNING_KEY is required to verify this signed artifact.');
    }
    const expected = signHash(computed, signingKey)?.digest ?? '';
    if (!safeEqualHex(integrity.signature.digest, expected)) {
      throw new Error('Audit artifact HMAC signature mismatch.');
    }
  }
}

function assertArtifactScope(artifact: AuditArtifact): void {
  if (canonicalJson(artifact.allowlist) !== canonicalJson(CLEANUP_ALLOWLIST)) {
    throw new Error(
      'Audit cleanup allowlist does not match this toolkit version; generate and review a new audit artifact.',
    );
  }
}

export async function writeArtifact(path: string, artifact: AuditArtifact): Promise<void> {
  const handle = await fs.open(path, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readArtifact(path: string): Promise<AuditArtifact> {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Audit path must be a regular, non-symlink file: ${path}`);
  }
  return JSON.parse(await fs.readFile(path, 'utf8')) as AuditArtifact;
}

function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new Error(`Unsafe database count/quantity: ${String(value)}`);
  return number;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function legacyOutboxPredicate(alias = ''): string {
  const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
  return (
    `${prefix}status IN ('pending', 'failed') AND (` +
    `lower(${prefix}aggregate_type) IN ('fulfillment', 'fulfillment_order', 'fulfillmentorder', 'shipment') ` +
    `OR lower(${prefix}event_type) LIKE 'fulfillment%' ` +
    `OR lower(${prefix}event_type) LIKE 'shipment%')`
  );
}

async function databaseIdentity(sql: QuerySql): Promise<DatabaseIdentity> {
  const [row] = await sql.unsafe<
    Array<{
      database: string;
      database_oid: string | number;
      schema: string;
      server_address: string | null;
      server_port: string | number | null;
    }>
  >(`
    SELECT current_database() AS database,
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
           current_schema() AS schema,
           coalesce(inet_server_addr()::text, 'local-socket') AS server_address,
           inet_server_port() AS server_port
  `);
  return {
    database: row.database,
    databaseOid: String(row.database_oid),
    schema: row.schema,
    serverAddress: row.server_address ?? 'local-socket',
    serverPort: row.server_port === null ? null : asNumber(row.server_port),
  };
}

async function rowCount(sql: QuerySql, table: string, predicate = 'TRUE'): Promise<RowCount> {
  const [row] = await sql.unsafe<Array<{ rows: string | number }>>(
    `SELECT count(*)::bigint AS rows FROM ${quoteIdentifier(table)} WHERE ${predicate}`,
  );
  return { rows: asNumber(row.rows) };
}

async function tableExists(sql: QuerySql, table: string): Promise<boolean> {
  const [row] = await sql.unsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = '${table}'
    ) AS exists
  `);
  return row.exists;
}

async function columnExists(sql: QuerySql, table: string, column: string): Promise<boolean> {
  const [row] = await sql.unsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'
    ) AS exists
  `);
  return row.exists;
}

async function statusCounts(
  sql: QuerySql,
  table: string,
  options: { predicate?: string; quantityColumn?: string } = {},
): Promise<StatusCount[]> {
  const quantity = options.quantityColumn
    ? `, coalesce(sum(${quoteIdentifier(options.quantityColumn)}), 0)::bigint AS quantity`
    : '';
  const rows = await sql.unsafe<Array<{ status: string; rows: string | number; quantity?: string | number }>>(`
    SELECT status::text AS status, count(*)::bigint AS rows ${quantity}
      FROM ${quoteIdentifier(table)}
     WHERE ${options.predicate ?? 'TRUE'}
     GROUP BY status
     ORDER BY status
  `);
  return rows.map((row) => ({
    status: row.status,
    rows: asNumber(row.rows),
    ...(row.quantity === undefined ? {} : { quantity: asNumber(row.quantity) }),
  }));
}

async function affectedStock(sql: QuerySql): Promise<AffectedStock[]> {
  const rows = await sql.unsafe<
    Array<{
      warehouse_id: string;
      sku_id: string;
      pending_qty: string | number;
      confirmed_qty: string | number;
      total_qty: string | number;
    }>
  >(`
    SELECT warehouse_id, sku_id,
           coalesce(sum(quantity) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_qty,
           coalesce(sum(quantity) FILTER (WHERE status = 'confirmed'), 0)::bigint AS confirmed_qty,
           coalesce(sum(quantity), 0)::bigint AS total_qty
      FROM stock_reservations
     WHERE lower(target_type) = 'fulfillment_order'
     GROUP BY warehouse_id, sku_id
     ORDER BY warehouse_id, sku_id
  `);
  return rows.map((row) => ({
    warehouseId: row.warehouse_id,
    skuId: row.sku_id,
    pendingQty: asNumber(row.pending_qty),
    confirmedQty: asNumber(row.confirmed_qty),
    totalQty: asNumber(row.total_qty),
  }));
}

async function shipEvidence(sql: QuerySql): Promise<AuditState['shipEvidence']> {
  const [row] = await sql.unsafe<
    Array<{
      journals: string | number;
      events: string | number;
      shipment_ids: string[] | null;
    }>
  >(`
    SELECT count(DISTINCT j.id)::bigint AS journals,
           count(DISTINCT e.id) FILTER (WHERE e.transition_type::text = 'SHIP')::bigint AS events,
           array_agg(DISTINCT s.id::text ORDER BY s.id::text)
             FILTER (WHERE s.id IS NOT NULL) AS shipment_ids
      FROM shipments s
      LEFT JOIN stock_journals j
        ON j.source_id = s.id AND upper(coalesce(j.source_type, '')) = 'SHIPMENT'
      LEFT JOIN stock_events e ON e.journal_id = j.id
  `);
  return {
    journals: asNumber(row.journals),
    events: asNumber(row.events),
    shipmentIds: row.shipment_ids ?? [],
  };
}

function uuidLiteral(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid audited UUID: ${value}`);
  }
  return `'${value}'::uuid`;
}

async function preservedShipEvidence(
  sql: QuerySql,
  shipmentIds: string[],
): Promise<{ journals: number; events: number }> {
  if (shipmentIds.length === 0) return { journals: 0, events: 0 };
  const [row] = await sql.unsafe<Array<{ journals: string | number; events: string | number }>>(`
    SELECT count(DISTINCT j.id)::bigint AS journals,
           count(DISTINCT e.id) FILTER (WHERE e.transition_type::text = 'SHIP')::bigint AS events
      FROM stock_journals j
      LEFT JOIN stock_events e ON e.journal_id = j.id
     WHERE upper(coalesce(j.source_type, '')) = 'SHIPMENT'
       AND j.source_id IN (${shipmentIds.map(uuidLiteral).join(', ')})
  `);
  return { journals: asNumber(row.journals), events: asNumber(row.events) };
}

type RawForeignKey = {
  constraint_name: string;
  source_table: string;
  source_columns: string[];
  target_table: string;
  target_columns: string[];
  delete_action: string;
};

async function foreignKeyClosure(sql: QuerySql): Promise<ForeignKeyClosure[]> {
  const rows = await sql.unsafe<RawForeignKey[]>(`
    SELECT c.conname AS constraint_name,
           src.relname AS source_table,
           array_agg(src_att.attname ORDER BY keys.ordinality) AS source_columns,
           dst.relname AS target_table,
           array_agg(dst_att.attname ORDER BY keys.ordinality) AS target_columns,
           CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS delete_action
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class dst ON dst.oid = c.confrelid
      JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
      JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY
        AS keys(source_attnum, target_attnum, ordinality) ON TRUE
      JOIN pg_attribute src_att ON src_att.attrelid = src.oid AND src_att.attnum = keys.source_attnum
      JOIN pg_attribute dst_att ON dst_att.attrelid = dst.oid AND dst_att.attnum = keys.target_attnum
     WHERE c.contype = 'f'
       AND src_ns.nspname = current_schema()
       AND dst_ns.nspname = current_schema()
       AND dst.relname IN (${CLEANUP_TABLES.map((table) => `'${table}'`).join(', ')})
     GROUP BY c.conname, src.relname, dst.relname, c.confdeltype
     ORDER BY src.relname, c.conname
  `);

  const result: ForeignKeyClosure[] = [];
  for (const row of rows) {
    const joins = row.source_columns
      .map(
        (sourceColumn, index) =>
          `src.${quoteIdentifier(sourceColumn)} = dst.${quoteIdentifier(row.target_columns[index])}`,
      )
      .join(' AND ');
    const targetPredicate = FULL_DELETE_TABLES.has(row.target_table)
      ? 'TRUE'
      : cleanupPredicate(row.target_table, 'dst');
    const [count] = await sql.unsafe<Array<{ rows: string | number }>>(`
      SELECT count(*)::bigint AS rows
        FROM ${quoteIdentifier(row.source_table)} src
        JOIN ${quoteIdentifier(row.target_table)} dst ON ${joins}
       WHERE ${targetPredicate}
    `);
    const sourceCoverage = FULL_DELETE_TABLES.has(row.source_table)
      ? 'TRUE'
      : CLEANUP_TABLES.includes(row.source_table as (typeof CLEANUP_TABLES)[number])
        ? cleanupPredicate(row.source_table, 'src')
        : 'FALSE';
    const [uncovered] = await sql.unsafe<Array<{ rows: string | number }>>(`
      SELECT count(*)::bigint AS rows
        FROM ${quoteIdentifier(row.source_table)} src
        JOIN ${quoteIdentifier(row.target_table)} dst ON ${joins}
       WHERE ${targetPredicate} AND NOT (${sourceCoverage})
    `);
    const uncoveredReferencingRows = asNumber(uncovered.rows);
    result.push({
      constraint: row.constraint_name,
      sourceTable: row.source_table,
      sourceColumns: row.source_columns,
      targetTable: row.target_table,
      targetColumns: row.target_columns,
      deleteAction: row.delete_action,
      referencingRows: asNumber(count.rows),
      uncoveredReferencingRows,
      sourceAllowlisted: uncoveredReferencingRows === 0,
    });
  }
  return result;
}

function cleanupPredicate(table: string, alias = ''): string {
  const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
  if (table === 'stock_reservations') return `lower(${prefix}target_type) = 'fulfillment_order'`;
  if (table === 'outbox_events') return legacyOutboxPredicate(alias);
  if (FULL_DELETE_TABLES.has(table)) return 'TRUE';
  throw new Error(`No cleanup predicate for ${table}`);
}

async function replaySafety(sql: QuerySql, cutoverAt: string): Promise<AuditState['replaySafety']> {
  const [row] = await sql.unsafe<
    Array<{
      invalid_created_at_events: string | number;
      old_created_events: string | number;
      old_events_with_backlog: string | number;
      old_events_with_fulfillment_order: string | number;
    }>
  >(`
    WITH created AS (
      SELECT oe.order_id,
             CASE
               WHEN coalesce(oe.payload->>'createdAt', '') ~
                    '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([.]\\d+)?(Z|[+-]\\d{2}:?\\d{2})$'
               THEN (oe.payload->>'createdAt')::timestamptz
               ELSE NULL
             END AS domain_created_at
        FROM order_events oe
       WHERE oe.event_type::text = 'ORDER_CREATED'
    )
    SELECT count(*) FILTER (WHERE domain_created_at IS NULL)::bigint AS invalid_created_at_events,
           count(*) FILTER (WHERE domain_created_at < '${cutoverAt}'::timestamptz)::bigint AS old_created_events,
           count(*) FILTER (
             WHERE domain_created_at < '${cutoverAt}'::timestamptz AND EXISTS (
               SELECT 1 FROM fulfillment_order_creation_backlogs b WHERE b.sales_order_id = created.order_id
             )
           )::bigint AS old_events_with_backlog,
           count(*) FILTER (
             WHERE domain_created_at < '${cutoverAt}'::timestamptz AND EXISTS (
               SELECT 1 FROM fulfillment_orders fo WHERE fo.sales_order_id = created.order_id
             )
           )::bigint AS old_events_with_fulfillment_order
      FROM created
  `);
  return {
    invalidCreatedAtEvents: asNumber(row.invalid_created_at_events),
    oldCreatedEvents: asNumber(row.old_created_events),
    oldEventsWithBacklog: asNumber(row.old_events_with_backlog),
    oldEventsWithFulfillmentOrder: asNumber(row.old_events_with_fulfillment_order),
  };
}

async function collectAuditState(sql: QuerySql, cutoverAt: string): Promise<AuditState> {
  const counts: Record<string, RowCount> = {};
  for (const table of CLEANUP_TABLES) {
    counts[table] = await rowCount(sql, table, cleanupPredicate(table));
  }
  const v2Rows: Record<string, RowCount> = {};
  for (const table of V2_ONLY_TABLES) {
    v2Rows[table] = (await tableExists(sql, table)) ? await rowCount(sql, table) : { rows: 0 };
  }
  v2Rows.v2_status_shipments = await rowCount(
    sql,
    'shipments',
    "status::text NOT IN ('open','shipped','in_transit','delivered','failed','canceled')",
  );
  v2Rows.topic_routed_outbox = (await columnExists(sql, 'outbox_events', 'topic'))
    ? await rowCount(sql, 'outbox_events', "topic IN ('shipments.events.v1','fulfillments.events.v2')")
    : { rows: 0 };

  return {
    counts,
    reservationStatus: await statusCounts(sql, 'stock_reservations', {
      predicate: cleanupPredicate('stock_reservations'),
      quantityColumn: 'quantity',
    }),
    invoiceStatus: await statusCounts(sql, 'invoices'),
    shipmentStatus: await statusCounts(sql, 'shipments'),
    batchStatus: await statusCounts(sql, 'outbound_batches'),
    affectedStock: await affectedStock(sql),
    shipEvidence: await shipEvidence(sql),
    foreignKeyClosure: await foreignKeyClosure(sql),
    replaySafety: await replaySafety(sql, cutoverAt),
    v2Rows,
  };
}

async function fingerprint(sql: QuerySql, table: string, predicate = 'TRUE'): Promise<Fingerprint> {
  const [row] = await sql.unsafe<Array<{ rows: string | number; digest: string }>>(`
    SELECT count(*)::bigint AS rows,
           md5(
             count(*)::text || ':' ||
             coalesce(sum(('x' || substr(row_hash, 1, 16))::bit(64)::bigint)::text, '0') || ':' ||
             coalesce(sum(('x' || substr(row_hash, 17, 16))::bit(64)::bigint)::text, '0')
           ) AS digest
      FROM (
        SELECT md5(to_jsonb(t)::text) AS row_hash
          FROM ${quoteIdentifier(table)} t
         WHERE ${predicate}
      ) hashed
  `);
  return { rows: asNumber(row.rows), digest: row.digest };
}

async function protectedFingerprints(sql: QuerySql): Promise<Record<string, Fingerprint>> {
  const fingerprints: Record<string, Fingerprint> = {};
  for (const table of PROTECTED_TABLES) fingerprints[table] = await fingerprint(sql, table);
  fingerprints.unrelated_outbox_events = await fingerprint(
    sql,
    'outbox_events',
    `NOT (${cleanupPredicate('outbox_events')})`,
  );
  fingerprints.non_fo_stock_reservations = await fingerprint(
    sql,
    'stock_reservations',
    `NOT (${cleanupPredicate('stock_reservations')})`,
  );
  return fingerprints;
}

function collectBlockers(state: AuditState): string[] {
  const blockers: string[] = [];
  if (state.shipEvidence.journals > 0 || state.shipEvidence.events > 0) {
    blockers.push(
      `SHIP evidence exists (journals=${state.shipEvidence.journals}, events=${state.shipEvidence.events}); ` +
        'stop and perform a separate stock/accounting audit.',
    );
  }
  const externalReferences = state.foreignKeyClosure.filter((edge) => edge.uncoveredReferencingRows > 0);
  for (const edge of externalReferences) {
    blockers.push(
      `Non-allowlisted FK ${edge.constraint} has ${edge.uncoveredReferencingRows} uncovered row(s) ` +
        `of ${edge.referencingRows} total reference(s): ` +
        `${edge.sourceTable} -> ${edge.targetTable} (${edge.deleteAction}).`,
    );
  }
  if (state.replaySafety.invalidCreatedAtEvents > 0) {
    blockers.push(
      `${state.replaySafety.invalidCreatedAtEvents} ORDER_CREATED tombstone(s) have missing/invalid payload.createdAt; ` +
        'the cutover gate must fail closed and the rows require review.',
    );
  }
  const v2Rows = Object.entries(state.v2Rows).filter(([, count]) => count.rows > 0);
  if (v2Rows.length > 0) {
    blockers.push(`V2 rows already exist; stop intake and repair in V2: ${canonicalJson(Object.fromEntries(v2Rows))}`);
  }
  return blockers;
}

export async function createAuditArtifact(sql: Sql, options: CreateAuditOptions): Promise<AuditArtifact> {
  const cutoverAt = requireCutoverAt(options.cutoverAt);
  const snapshot = await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => ({
    state: await collectAuditState(tx, cutoverAt),
    database: await databaseIdentity(tx),
    protectedFingerprints: await protectedFingerprints(tx),
  }));
  const body: AuditArtifactBody = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    database: snapshot.database,
    workflowMode: options.workflowMode,
    cutoverAt,
    snapshotId: SNAPSHOT_ID_PLACEHOLDER,
    allowlist: CLEANUP_ALLOWLIST,
    state: snapshot.state,
    auditStateHash: sha256(snapshot.state),
    protectedFingerprints: snapshot.protectedFingerprints,
    blockers: collectBlockers(snapshot.state),
    warnings: options.signingKey
      ? []
      : ['Artifact is SHA-256 protected but not HMAC signed; production cleanup rejects unsigned artifacts.'],
  };
  return sealArtifact(body, options.signingKey);
}

function assertDatabaseIdentity(expected: DatabaseIdentity, actual: DatabaseIdentity): void {
  const comparable = (identity: DatabaseIdentity) => ({
    database: identity.database,
    databaseOid: identity.databaseOid,
    schema: identity.schema,
    serverAddress: identity.serverAddress,
    serverPort: identity.serverPort,
  });
  if (canonicalJson(comparable(expected)) !== canonicalJson(comparable(actual))) {
    throw new Error(
      `Audit database identity mismatch. expected=${canonicalJson(expected)} actual=${canonicalJson(actual)}`,
    );
  }
}

async function acquireCleanupLock(sql: QuerySql): Promise<void> {
  const [row] = await sql.unsafe<Array<{ acquired: boolean }>>(
    `SELECT pg_try_advisory_xact_lock(hashtext('${CUTOVER_LOCK_KEY}')) AS acquired`,
  );
  if (!row.acquired) throw new Error('Another fulfillment V2 cutover operation holds the advisory lock.');
}

const DELETE_STEPS: Array<{ name: string; sql: string }> = [
  { name: 'backlogs', sql: 'DELETE FROM fulfillment_order_creation_backlogs' },
  {
    name: 'fo-reservations',
    sql: `DELETE FROM stock_reservations WHERE ${cleanupPredicate('stock_reservations')}`,
  },
  { name: 'shipment-tracking', sql: 'DELETE FROM shipment_tracking' },
  { name: 'inspection-issues', sql: 'DELETE FROM inspection_issues' },
  { name: 'invoices', sql: 'DELETE FROM invoices' },
  { name: 'shipment-lines', sql: 'DELETE FROM shipment_lines' },
  { name: 'shipments', sql: 'DELETE FROM shipments' },
  { name: 'fo-batch-links', sql: 'DELETE FROM fulfillment_order_batches' },
  { name: 'fo-items', sql: 'DELETE FROM fulfillment_order_items' },
  { name: 'fulfillment-orders', sql: 'DELETE FROM fulfillment_orders' },
  { name: 'outbound-batches', sql: 'DELETE FROM outbound_batches' },
  {
    name: 'legacy-fulfillment-outbox',
    sql: `DELETE FROM outbox_events WHERE ${cleanupPredicate('outbox_events')}`,
  },
];

function assertSigningRequired(artifact: AuditArtifact, signingKey: string | undefined, destructive: boolean): void {
  if ((destructive || process.env.NODE_ENV === 'production') && (!artifact.integrity.signature || !signingKey)) {
    throw new Error(
      destructive
        ? 'Cleanup --execute requires an HMAC-signed artifact and FULFILLMENT_V2_AUDIT_SIGNING_KEY.'
        : 'Production verification requires an HMAC-signed artifact and FULFILLMENT_V2_AUDIT_SIGNING_KEY.',
    );
  }
}

export async function cleanup(sql: Sql, options: CleanupOptions): Promise<Record<string, number>> {
  assertArtifactIntegrity(options.artifact, options.signingKey);
  assertArtifactScope(options.artifact);
  assertSigningRequired(options.artifact, options.signingKey, options.execute);
  if (options.workflowMode !== 'maintenance') {
    throw new Error('Cleanup is allowed only while FULFILLMENT_WORKFLOW_MODE=maintenance.');
  }
  if (options.artifact.workflowMode !== 'maintenance') {
    throw new Error('Audit artifact was not captured while FULFILLMENT_WORKFLOW_MODE=maintenance.');
  }
  if (requireCutoverAt(options.cutoverAt) !== options.artifact.cutoverAt) {
    throw new Error('FULFILLMENT_V2_CUTOVER_AT does not match the audited cutover timestamp.');
  }
  if (!options.snapshotId || options.snapshotId === SNAPSHOT_ID_PLACEHOLDER) {
    throw new Error('A real platform --snapshot-id is required before cleanup.');
  }
  if (options.artifact.blockers.length > 0) {
    throw new Error(`Audit has blockers:\n- ${options.artifact.blockers.join('\n- ')}`);
  }

  return sql.begin('ISOLATION LEVEL SERIALIZABLE', async (tx) => {
    await acquireCleanupLock(tx);
    assertDatabaseIdentity(options.artifact.database, await databaseIdentity(tx));
    const current = await collectAuditState(tx, options.artifact.cutoverAt);
    if (!safeEqualHex(options.artifact.auditStateHash, sha256(current))) {
      throw new Error('Live cleanup state no longer matches auditStateHash; run a new audit and snapshot review.');
    }
    if (current.shipEvidence.journals > 0 || current.shipEvidence.events > 0) {
      throw new Error('SHIP evidence appeared after audit; cleanup aborted.');
    }
    const before = await protectedFingerprints(tx);

    const dryRunSavepoint = !options.execute;
    if (dryRunSavepoint) await tx.unsafe('SAVEPOINT fulfillment_v2_cleanup_dry_run');
    try {
      const deleted: Record<string, number> = {};
      for (const step of DELETE_STEPS) {
        const result = await tx.unsafe(step.sql);
        deleted[step.name] = result.count;
        if (options.failAfterStep === step.name) throw new Error(`Injected failure after ${step.name}`);
      }
      const after = await protectedFingerprints(tx);
      if (canonicalJson(before) !== canonicalJson(after)) {
        throw new Error(
          `Protected data changed during cleanup. before=${canonicalJson(before)} after=${canonicalJson(after)}`,
        );
      }

      const postState = await collectAuditState(tx, options.artifact.cutoverAt);
      const remaining = Object.entries(postState.counts).filter(([, count]) => count.rows !== 0);
      if (remaining.length > 0) {
        throw new Error(`Allowlisted cleanup rows remain: ${canonicalJson(Object.fromEntries(remaining))}`);
      }
      const reservationDrift = await findReservationDrift(tx, options.artifact.state.affectedStock);
      const ledgerDrift = await findLedgerDrift(tx, options.artifact.state.affectedStock);
      if (reservationDrift.length > 0 || ledgerDrift.length > 0) {
        throw new Error(
          `Affected stock reconciliation failed: reservations=${canonicalJson(reservationDrift)} ` +
            `ledger=${canonicalJson(ledgerDrift)}`,
        );
      }
      if (dryRunSavepoint) {
        await tx.unsafe('ROLLBACK TO SAVEPOINT fulfillment_v2_cleanup_dry_run');
        await tx.unsafe('RELEASE SAVEPOINT fulfillment_v2_cleanup_dry_run');
        return {};
      }
      return deleted;
    } catch (error) {
      if (dryRunSavepoint) {
        await tx.unsafe('ROLLBACK TO SAVEPOINT fulfillment_v2_cleanup_dry_run');
      }
      throw error;
    }
  });
}

async function findReservationDrift(sql: QuerySql, affected: AffectedStock[]): Promise<ReservationDrift[]> {
  const drifts: ReservationDrift[] = [];
  for (const pair of affected) {
    const [row] = await sql.unsafe<Array<{ on_hand_qty: string | number; confirmed_qty: string | number }>>(`
      SELECT coalesce((
               SELECT sum(qty) FROM stock_ledgers
                WHERE warehouse_id = '${pair.warehouseId}'::uuid
                  AND sku_id = '${pair.skuId}'::uuid AND stock_state::text = 'ON_HAND'
             ), 0)::bigint AS on_hand_qty,
             coalesce((
               SELECT sum(quantity) FROM stock_reservations
                WHERE warehouse_id = '${pair.warehouseId}'::uuid
                  AND sku_id = '${pair.skuId}'::uuid AND status::text = 'confirmed'
             ), 0)::bigint AS confirmed_qty
    `);
    const onHandQty = asNumber(row.on_hand_qty);
    const confirmedReservationQty = asNumber(row.confirmed_qty);
    if (confirmedReservationQty > onHandQty) {
      drifts.push({
        warehouseId: pair.warehouseId,
        skuId: pair.skuId,
        onHandQty,
        confirmedReservationQty,
        shortfall: confirmedReservationQty - onHandQty,
      });
    }
  }
  return drifts;
}

async function findLedgerDrift(sql: QuerySql, affected: AffectedStock[]): Promise<LedgerDrift[]> {
  const drifts: LedgerDrift[] = [];
  for (const pair of affected) {
    const rows = await sql.unsafe<
      Array<{
        warehouse_id: string;
        sku_id: string;
        location_id: string;
        stock_state: string;
        event_derived_qty: string | number;
        ledger_qty: string | number;
      }>
    >(`
      WITH derived AS (
        SELECT sku_id, wh AS warehouse_id, loc AS location_id, state AS stock_state, sum(quantity)::bigint AS qty
          FROM (
            SELECT sku_id, to_warehouse_id AS wh, to_location_id AS loc, to_state::text AS state, quantity
              FROM stock_events
             WHERE event_status::text = 'POSTED' AND voided_by_event_id IS NULL AND to_state IS NOT NULL
            UNION ALL
            SELECT sku_id, from_warehouse_id, from_location_id, from_state::text, -quantity
              FROM stock_events
             WHERE event_status::text = 'POSTED' AND voided_by_event_id IS NULL AND from_state IS NOT NULL
          ) movements
         GROUP BY sku_id, wh, loc, state
      )
      SELECT coalesce(d.warehouse_id, l.warehouse_id)::text AS warehouse_id,
             coalesce(d.sku_id, l.sku_id)::text AS sku_id,
             coalesce(d.location_id, l.location_id)::text AS location_id,
             coalesce(d.stock_state, l.stock_state::text) AS stock_state,
             coalesce(d.qty, 0)::bigint AS event_derived_qty,
             coalesce(l.qty, 0)::bigint AS ledger_qty
        FROM derived d
        FULL OUTER JOIN stock_ledgers l
          ON d.sku_id = l.sku_id AND d.warehouse_id = l.warehouse_id
         AND d.location_id = l.location_id AND d.stock_state = l.stock_state::text
       WHERE coalesce(d.warehouse_id, l.warehouse_id) = '${pair.warehouseId}'::uuid
         AND coalesce(d.sku_id, l.sku_id) = '${pair.skuId}'::uuid
         AND coalesce(d.qty, 0) <> coalesce(l.qty, 0)
       ORDER BY location_id, stock_state
    `);
    for (const row of rows) {
      const eventDerivedQty = asNumber(row.event_derived_qty);
      const ledgerQty = asNumber(row.ledger_qty);
      drifts.push({
        warehouseId: row.warehouse_id,
        skuId: row.sku_id,
        locationId: row.location_id,
        stockState: row.stock_state,
        eventDerivedQty,
        ledgerQty,
        delta: ledgerQty - eventDerivedQty,
      });
    }
  }
  return drifts;
}

export async function verify(
  sql: Sql,
  artifact: AuditArtifact,
  options: { workflowMode: string; cutoverAt: string; signingKey?: string },
): Promise<VerificationReport> {
  assertArtifactIntegrity(artifact, options.signingKey);
  assertArtifactScope(artifact);
  assertSigningRequired(artifact, options.signingKey, false);
  if (!['maintenance', 'v2'].includes(options.workflowMode)) {
    throw new Error('Verify requires workflow mode maintenance or v2.');
  }
  if (artifact.workflowMode !== 'maintenance') {
    throw new Error('Audit artifact was not captured while FULFILLMENT_WORKFLOW_MODE=maintenance.');
  }
  if (requireCutoverAt(options.cutoverAt) !== artifact.cutoverAt) {
    throw new Error('FULFILLMENT_V2_CUTOVER_AT does not match the audited cutover timestamp.');
  }
  const actualDatabase = await databaseIdentity(sql);
  assertDatabaseIdentity(artifact.database, actualDatabase);

  return sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const state = await collectAuditState(tx, artifact.cutoverAt);
    const reservationDrift = await findReservationDrift(tx, artifact.state.affectedStock);
    const ledgerDrift = await findLedgerDrift(tx, artifact.state.affectedStock);
    const preservedShipmentEvidence = await preservedShipEvidence(tx, artifact.state.shipEvidence.shipmentIds);
    const confirmedFoReservations = state.reservationStatus.find((status) => status.status === 'confirmed');
    const checks: Record<string, boolean> = {
      allAllowlistedCountsZero: Object.values(state.counts).every((count) => count.rows === 0),
      confirmedFoReservationsZero: !confirmedFoReservations || confirmedFoReservations.quantity === 0,
      noPendingLegacyOutbox: state.counts.outbox_events.rows === 0,
      noOldBacklogReplay: state.replaySafety.oldEventsWithBacklog === 0,
      noOldFulfillmentOrderReplay: state.replaySafety.oldEventsWithFulfillmentOrder === 0,
      noInvalidOrderDomainTime: state.replaySafety.invalidCreatedAtEvents === 0,
      affectedReservationReconciliationClean: reservationDrift.length === 0,
      affectedLedgerReconciliationClean: ledgerDrift.length === 0,
      noV2RowsBeforeActivation: Object.values(state.v2Rows).every((count) => count.rows === 0),
      noShipEvidenceForAuditedShipments:
        preservedShipmentEvidence.journals === 0 && preservedShipmentEvidence.events === 0,
    };
    const failed = Object.entries(checks).filter(([, passed]) => !passed);
    if (failed.length > 0) throw new Error(`Cutover verification failed: ${failed.map(([name]) => name).join(', ')}`);
    return {
      verifiedAt: new Date().toISOString(),
      auditHash: artifact.integrity.artifactHash,
      database: actualDatabase,
      checks,
      reservationDrift,
      ledgerDrift,
      replaySafety: state.replaySafety,
    };
  });
}
