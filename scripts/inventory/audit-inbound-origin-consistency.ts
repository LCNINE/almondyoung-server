import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import postgres = require('postgres');
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  inboundPendingQuantitySql,
  inboundReceiptInvalidSql,
} from '../../apps/core/src/modules/inventory/shared/availability/inbound-origin-availability';

export interface InboundOriginAuditLine {
  lineId: string;
  receiptId: string;
  source: string;
  quantity: number;
  putawayFromOriginQty: number;
  returnedQty: number;
  canceledQty: number;
  pendingQty: number;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  possiblePendingUntil: string | null;
  completionBasis: 'OPEN' | 'WORK_LOGS' | 'UPDATED_AT';
}
export interface InboundOriginAuditReport {
  version: 1;
  warehouseId: string;
  checkedAt: string;
  candidates: Array<{
    skuId: string;
    originLocationId: string | null;
    onHandQty: number;
    pendingQty: number;
    batchControlledQty: number;
    generallyAvailableQty: number;
    lineIds: string[];
    eventIds: string[];
    lines: InboundOriginAuditLine[];
    reasons: Array<'INSUFFICIENT_ORIGIN' | 'POSSIBLE_BYPASS' | 'INVALID_RECEIPT'>;
  }>;
}

/** Uses the caller's connection, but owns a DB-enforced, consistent read-only snapshot. */
export async function auditInboundOrigins(
  client: postgres.Sql,
  warehouseId: string,
): Promise<InboundOriginAuditReport> {
  return client.begin('isolation level repeatable read read only', async (tx) => {
    const warehouses = await tx.unsafe(
      'SELECT id, transaction_timestamp() AS checked_at FROM warehouses WHERE id = $1',
      [warehouseId],
    );
    if (!warehouses.length) throw new Error('Unknown warehouse.');
    const checkedAt = warehouses[0].checked_at.toISOString();
    const query = new PgDialect().sqlToQuery(sql`
      WITH receipt_facts AS (
        SELECT irl.id AS line_id, ir.id AS receipt_id, ir.status, irl.sku_id, irl.origin_location_id,
          irl.source, irl.event_id, irl.quantity, irl.putaway_from_origin_qty, irl.returned_qty, irl.canceled_qty,
          ir.occurred_at, irl.created_at, irl.updated_at,
          ${inboundPendingQuantitySql} AS pending_qty,
          ${inboundReceiptInvalidSql} AS invalid,
          (origin.is_system = true AND origin.warehouse_id = ir.warehouse_id) AS protected_origin
        FROM inbound_receipt_lines irl
        JOIN inbound_receipts ir ON ir.id = irl.receipt_id
        LEFT JOIN locations origin ON origin.id = irl.origin_location_id
        WHERE ir.warehouse_id = ${warehouseId}
      ), valid_work AS (
        -- Merely mentioning an event ID is insufficient: match the actual receipt, source and movement.
        SELECT DISTINCT f.line_id, e.id AS event_id, e.quantity, e.occurred_at, e.event_status
        FROM receipt_facts f
        JOIN inbound_work_logs w ON w.line_id = f.line_id AND w.receipt_id = f.receipt_id
          AND w.sku_id = f.sku_id AND w.warehouse_id = ${warehouseId}
          AND w.from_location_id = f.origin_location_id
        JOIN stock_events e ON e.id = w.event_id AND e.sku_id = f.sku_id
          AND e.from_warehouse_id = ${warehouseId} AND e.from_location_id = f.origin_location_id
          AND e.from_state = 'ON_HAND' AND e.quantity = w.quantity AND e.event_status IN ('POSTED', 'VOIDED')
        WHERE (w.type = 'PUTAWAY' AND e.transition_type = 'MOVE' AND e.to_state = 'ON_HAND'
            AND e.to_warehouse_id = ${warehouseId} AND e.to_location_id = w.to_location_id
            AND e.to_location_id <> e.from_location_id)
          OR (w.type = 'RETURN' AND e.transition_type = 'ADJUST_DOWN' AND e.to_state IS NULL)
          OR (w.type = 'CANCEL' AND e.transition_type = 'ADJUST_DOWN' AND e.to_state IS NULL
            AND e.reversal_of_event_id = f.event_id)
      ), intervals AS (
        SELECT f.*, CASE WHEN f.pending_qty > 0 THEN NULL
          WHEN work.qty = f.quantity THEN work.completed_at ELSE f.updated_at END AS pending_until,
          CASE WHEN f.pending_qty > 0 THEN 'OPEN'
            WHEN work.qty = f.quantity THEN 'WORK_LOGS' ELSE 'UPDATED_AT' END AS completion_basis
        FROM receipt_facts f
        LEFT JOIN LATERAL (
          SELECT SUM(v.quantity) AS qty, MAX(v.occurred_at) AS completed_at
          FROM valid_work v WHERE v.line_id = f.line_id AND v.event_status = 'POSTED'
        ) work ON true
        WHERE f.status = 'posted' AND (f.protected_origin OR f.invalid)
      ), buckets AS (
        SELECT sku_id, origin_location_id,
          COALESCE(SUM(pending_qty) FILTER (WHERE protected_origin), 0) AS pending_qty,
          BOOL_OR(invalid) AS invalid,
          jsonb_agg(jsonb_build_object(
            'lineId', line_id, 'receiptId', receipt_id, 'source', source, 'quantity', quantity,
            'putawayFromOriginQty', putaway_from_origin_qty, 'returnedQty', returned_qty,
            'canceledQty', canceled_qty, 'pendingQty', pending_qty, 'occurredAt', occurred_at,
            'createdAt', created_at, 'updatedAt', updated_at, 'possiblePendingUntil', pending_until,
            'completionBasis', completion_basis
          ) ORDER BY line_id) AS lines
        FROM intervals GROUP BY sku_id, origin_location_id
      )
      SELECT b.*, COALESCE(ledger.qty, 0) AS on_hand_qty, COALESCE(custody.qty, 0) AS controlled_qty,
        COALESCE(evidence.ids, '[]'::jsonb) AS event_ids
      FROM buckets b
      LEFT JOIN LATERAL (
        SELECT SUM(sl.qty) AS qty FROM stock_ledgers sl WHERE sl.sku_id = b.sku_id
          AND sl.warehouse_id = ${warehouseId} AND sl.location_id = b.origin_location_id AND sl.stock_state = 'ON_HAND'
      ) ledger ON true
      LEFT JOIN LATERAL (
        SELECT SUM(balance.qty) AS qty FROM batch_inventory_session_balances balance
        JOIN batch_inventory_sessions session ON session.id = balance.session_id
        JOIN locations loc ON loc.id = balance.source_location_id AND loc.warehouse_id = ${warehouseId}
        WHERE balance.sku_id = b.sku_id AND balance.source_location_id = b.origin_location_id
          AND balance.custody_type <> 'SETTLED' AND session.status IN ('active', 'recovery_required')
      ) custody ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(e.id ORDER BY e.id) AS ids FROM stock_events e
        WHERE e.sku_id = b.sku_id AND e.from_warehouse_id = ${warehouseId}
          AND e.from_location_id = b.origin_location_id AND e.from_state = 'ON_HAND'
          AND e.event_status IN ('POSTED', 'VOIDED') AND e.occurred_at <= transaction_timestamp()
          AND (e.to_state IS DISTINCT FROM 'ON_HAND' OR e.to_location_id IS DISTINCT FROM e.from_location_id
            OR e.to_warehouse_id IS DISTINCT FROM e.from_warehouse_id)
          AND NOT EXISTS (SELECT 1 FROM valid_work w WHERE w.event_id = e.id)
          AND EXISTS (SELECT 1 FROM intervals i WHERE i.sku_id = b.sku_id
            AND i.origin_location_id = b.origin_location_id AND i.protected_origin
            AND e.occurred_at >= i.occurred_at
            AND (i.pending_until IS NULL OR e.occurred_at <= i.pending_until))
      ) evidence ON true
      ORDER BY b.sku_id, b.origin_location_id NULLS FIRST
    `);
    const rows = await tx.unsafe(query.sql, query.params as postgres.ParameterOrJSON<never>[]);
    const candidates: InboundOriginAuditReport['candidates'] = [];
    for (const row of rows) {
      const onHandQty = Number(row.on_hand_qty);
      const pendingQty = Number(row.pending_qty);
      const batchControlledQty = Number(row.controlled_qty);
      const eventIds = row.event_ids as string[];
      const reasons: InboundOriginAuditReport['candidates'][number]['reasons'] = [];
      if (onHandQty < pendingQty + batchControlledQty) reasons.push('INSUFFICIENT_ORIGIN');
      if (eventIds.length) reasons.push('POSSIBLE_BYPASS');
      if (row.invalid) reasons.push('INVALID_RECEIPT');
      if (!reasons.length) continue;
      const lines = (row.lines as InboundOriginAuditLine[]).map((line) => ({
        ...line,
        occurredAt: new Date(line.occurredAt).toISOString(),
        createdAt: new Date(line.createdAt).toISOString(),
        updatedAt: new Date(line.updatedAt).toISOString(),
        possiblePendingUntil: line.possiblePendingUntil ? new Date(line.possiblePendingUntil).toISOString() : null,
      }));
      candidates.push({
        skuId: row.sku_id as string,
        originLocationId: row.origin_location_id as string | null,
        onHandQty,
        pendingQty,
        batchControlledQty,
        generallyAvailableQty: Math.max(0, onHandQty - pendingQty - batchControlledQty),
        lineIds: lines.map((line) => line.lineId),
        eventIds,
        lines,
        reasons,
      });
    }
    return { version: 1, warehouseId, checkedAt, candidates };
  });
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--warehouse-id', '--output'].includes(flag) || values.has(flag) || !args[index + 1]) {
      throw new Error('Invalid arguments.');
    }
    values.set(flag, args[index + 1]);
  }
  const warehouseId = values.get('--warehouse-id') ?? '';
  const output = values.get('--output') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(warehouseId) || !isAbsolute(output)) {
    throw new Error('Expected warehouse UUID and absolute output path.');
  }
  return { warehouseId, output };
}

async function main(): Promise<void> {
  let client: postgres.Sql | undefined;
  let stage = 'input';
  try {
    const { warehouseId, output } = parseArguments(process.argv.slice(2));
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) throw new Error('DATABASE_URL required.');
    const parsed = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('PostgreSQL URL required.');
    stage = 'query';
    client = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => undefined });
    const report = await auditInboundOrigins(client, warehouseId);
    stage = 'output';
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.exitCode = report.candidates.length ? 2 : 0;
    console.log(`Audit completed: ${report.candidates.length} candidate bucket(s).`);
  } catch {
    // Never echo input paths, URLs, PostgreSQL errors or their credential-bearing diagnostics.
    console.error(
      `Inbound origin audit failed (${stage}). Check arguments, connection, warehouse and a new output path.`,
    );
    process.exitCode = 1;
  } finally {
    try {
      await client?.end({ timeout: 5 });
    } catch {
      console.error('Inbound origin audit failed (connection close).');
      process.exitCode = 1;
    }
  }
}

if (require.main === module) void main();
