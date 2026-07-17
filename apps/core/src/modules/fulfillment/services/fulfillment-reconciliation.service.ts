import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { MetricsService } from '../../inventory/shared/services/metrics.service';
import {
  FULFILLMENT_INVARIANT_KINDS,
  FulfillmentInvariantViolation,
  FulfillmentInvariantViolationKind,
} from './fulfillment-invariant.service';

interface ReconciliationQueryRow {
  kind: FulfillmentInvariantViolationKind;
  resource_id: string;
  message: string;
}

export interface FulfillmentReconciliationReport {
  checkedAt: Date;
  totalViolations: number;
  counts: Record<FulfillmentInvariantViolationKind, number>;
  /** Full identifiers are retained here and in structured logs, not high-cardinality Prometheus labels. */
  resourceIds: Record<FulfillmentInvariantViolationKind, string[]>;
  violations: FulfillmentInvariantViolation[];
}

const EMPTY_COUNTS = (): Record<FulfillmentInvariantViolationKind, number> =>
  Object.fromEntries(FULFILLMENT_INVARIANT_KINDS.map((kind) => [kind, 0])) as Record<
    FulfillmentInvariantViolationKind,
    number
  >;

const EMPTY_IDS = (): Record<FulfillmentInvariantViolationKind, string[]> =>
  Object.fromEntries(FULFILLMENT_INVARIANT_KINDS.map((kind) => [kind, [] as string[]])) as Record<
    FulfillmentInvariantViolationKind,
    string[]
  >;

@Injectable()
export class FulfillmentReconciliationService {
  private readonly logger = new Logger(FulfillmentReconciliationService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Read-only, single-statement reconciliation. It intentionally contains no repair
   * branch: a violation blocks the owning command or is handed to an explicit recovery operation.
   */
  async reconcile(tx?: DbTx): Promise<FulfillmentReconciliationReport> {
    const query = sql`
      WITH active_line_totals AS (
        SELECT sl.fulfillment_order_item_id AS foi_id, SUM(sl.qty)::int AS qty
          FROM shipment_lines sl
          JOIN shipments s ON s.id = sl.shipment_id
         WHERE s.status IN ('draft', 'planned', 'recovery_required')
         GROUP BY sl.fulfillment_order_item_id
      ), reservation_totals AS (
        SELECT shipment_line_id, SUM(quantity)::int AS qty
          FROM stock_reservations
         WHERE status = 'confirmed' AND shipment_line_id IS NOT NULL
         GROUP BY shipment_line_id
      ), session_remaining AS (
        SELECT session_id, SUM(qty)::int AS qty
          FROM batch_inventory_session_balances
         WHERE custody_type <> 'SETTLED'
         GROUP BY session_id
      ), attempt_line_sources AS (
        SELECT da.id AS attempt_id, sl.id AS line_id, sl.qty AS line_qty,
               coalesce(SUM(das.qty), 0)::int AS source_qty
          FROM dispatch_attempts da
          JOIN shipment_lines sl ON sl.shipment_id = da.shipment_id
          LEFT JOIN dispatch_attempt_sources das
            ON das.dispatch_attempt_id = da.id AND das.shipment_line_id = sl.id
         WHERE da.status IN ('dispatched', 'recalled')
         GROUP BY da.id, sl.id, sl.qty
      ), attempt_source_counts AS (
        SELECT da.id AS attempt_id, da.stock_journal_id,
               COUNT(DISTINCT das.id)::int AS source_count,
               COUNT(DISTINCT se.id)::int AS event_count,
               COUNT(DISTINCT CASE WHEN das.stock_event_id = se.id THEN se.id END)::int AS linked_event_count
          FROM dispatch_attempts da
          LEFT JOIN dispatch_attempt_sources das ON das.dispatch_attempt_id = da.id
          LEFT JOIN stock_events se ON se.journal_id = da.stock_journal_id
         WHERE da.status IN ('dispatched', 'recalled')
         GROUP BY da.id, da.stock_journal_id
      )
      SELECT 'FOI_QUANTITY'::text AS kind, foi.id::text AS resource_id,
             concat('qty=', foi.qty, ', shipped=', foi.shipped_qty, ', canceled=', foi.canceled_qty) AS message
        FROM fulfillment_order_items foi
       WHERE foi.qty <= 0 OR foi.shipped_qty < 0 OR foi.canceled_qty < 0
          OR foi.shipped_qty + foi.canceled_qty > foi.qty
      UNION ALL
      SELECT 'ACTIVE_LINE_QUANTITY', foi.id::text,
             concat('qty=', foi.qty, ', settled=', foi.shipped_qty + foi.canceled_qty,
                    ', activeLines=', coalesce(alt.qty, 0))
        FROM fulfillment_order_items foi
        LEFT JOIN active_line_totals alt ON alt.foi_id = foi.id
       WHERE foi.qty <> foi.shipped_qty + foi.canceled_qty + coalesce(alt.qty, 0)
      UNION ALL
      SELECT 'LINE_QUANTITY', sl.id::text,
             concat('qty=', sl.qty, ', inspected=', sl.inspected_qty)
        FROM shipment_lines sl
       WHERE sl.qty <= 0 OR sl.inspected_qty < 0 OR sl.inspected_qty > sl.qty
      UNION ALL
      SELECT 'CONFIRMED_RESERVATION', sl.id::text,
             concat('shipmentStatus=', s.status, ', lineQty=', sl.qty, ', confirmed=', coalesce(rt.qty, 0))
        FROM shipment_lines sl
        JOIN shipments s ON s.id = sl.shipment_id
        LEFT JOIN reservation_totals rt ON rt.shipment_line_id = sl.id
       WHERE coalesce(rt.qty, 0) > sl.qty
          OR (s.status = 'planned' AND coalesce(rt.qty, 0) <> sl.qty)
      UNION ALL
      SELECT 'CONFIRMED_RESERVATION', r.id::text, 'confirmed V2 fulfillment reservation has no shipment line'
        FROM stock_reservations r
       WHERE r.status = 'confirmed' AND r.fulfillment_order_item_id IS NOT NULL AND r.shipment_line_id IS NULL
      UNION ALL
      SELECT 'ACTIVE_INVOICE_VERSION', w.id::text,
             concat('waybillManifest=', coalesce(w.manifest_version::text, 'null'),
                    ', shipmentManifest=', s.manifest_version)
        FROM waybills w
        JOIN shipments s ON s.id = w.shipment_id
       WHERE w.status NOT IN ('voided', 'failed', 'abandoned') AND w.manifest_version IS DISTINCT FROM s.manifest_version
      UNION ALL
      SELECT 'SESSION_CONSERVATION', bis.id::text,
             concat('handedIn=', bis.handed_in_qty, ', remaining=', coalesce(sr.qty, 0),
                    ', settled=', bis.settled_qty, ', returned=', bis.returned_qty,
                    ', shortage=', bis.shortage_qty)
        FROM batch_inventory_sessions bis
        LEFT JOIN session_remaining sr ON sr.session_id = bis.id
       WHERE bis.handed_in_qty <>
             coalesce(sr.qty, 0) + bis.settled_qty + bis.returned_qty + bis.shortage_qty
      UNION ALL
      SELECT 'DISPATCH_SOURCE_CARDINALITY', als.attempt_id::text,
             concat('line=', als.line_id, ', lineQty=', als.line_qty, ', sourceQty=', als.source_qty)
        FROM attempt_line_sources als
       WHERE als.line_qty <> als.source_qty
      UNION ALL
      SELECT 'DISPATCH_SOURCE_CARDINALITY', das.id::text,
             concat('attempt=', da.id, ', foreignLine=', das.shipment_line_id)
        FROM dispatch_attempt_sources das
        JOIN dispatch_attempts da ON da.id = das.dispatch_attempt_id
        JOIN shipment_lines sl ON sl.id = das.shipment_line_id
       WHERE da.status IN ('dispatched', 'recalled') AND sl.shipment_id IS DISTINCT FROM da.shipment_id
      UNION ALL
      SELECT 'DISPATCH_EVENT_CARDINALITY', das.id::text,
             concat('attempt=', da.id, ', event=', coalesce(das.stock_event_id::text, 'missing'))
        FROM dispatch_attempt_sources das
        JOIN dispatch_attempts da ON da.id = das.dispatch_attempt_id
        JOIN shipments s ON s.id = da.shipment_id
        JOIN shipment_lines sl ON sl.id = das.shipment_line_id
        LEFT JOIN stock_events se ON se.id = das.stock_event_id
       WHERE da.status IN ('dispatched', 'recalled')
         AND (
           se.id IS NULL OR se.journal_id IS DISTINCT FROM da.stock_journal_id
           OR sl.shipment_id IS DISTINCT FROM da.shipment_id
           OR se.sku_id IS DISTINCT FROM sl.sku_id
           OR se.from_warehouse_id IS DISTINCT FROM s.warehouse_id
           OR se.from_location_id IS DISTINCT FROM das.source_location_id
           OR se.from_state IS DISTINCT FROM 'ON_HAND'
           OR se.to_warehouse_id IS NOT NULL OR se.to_state IS NOT NULL
           OR se.transition_type IS DISTINCT FROM 'SHIP'
           OR se.quantity IS DISTINCT FROM das.qty
         )
      UNION ALL
      SELECT 'DISPATCH_EVENT_CARDINALITY', ascnt.attempt_id::text,
             concat('sources=', ascnt.source_count, ', events=', ascnt.event_count,
                    ', linkedEvents=', ascnt.linked_event_count)
        FROM attempt_source_counts ascnt
       WHERE ascnt.source_count <> ascnt.event_count OR ascnt.source_count <> ascnt.linked_event_count
      ORDER BY kind, resource_id
    `;

    const result = await this.dbService.run((trx) => trx.execute(query), tx);
    const rawRows = result as unknown as ReconciliationQueryRow[];
    const violations = rawRows.map((row) => ({
      kind: row.kind,
      resourceId: row.resource_id,
      message: row.message,
    }));
    const counts = EMPTY_COUNTS();
    const resourceIds = EMPTY_IDS();
    for (const violation of violations) {
      counts[violation.kind] += 1;
      resourceIds[violation.kind].push(violation.resourceId);
    }

    return { checkedAt: new Date(), totalViolations: violations.length, counts, resourceIds, violations };
  }

  @Cron('10 3 * * *', { name: 'fulfillment-v2-reconciliation', timeZone: 'Asia/Seoul' })
  async scheduledReconcile(): Promise<void> {
    try {
      const report = await this.reconcile();
      this.metrics.setFulfillmentInvariantViolations(report.counts);
      if (report.totalViolations === 0) {
        this.logger.log('Fulfillment V2 reconciliation clean');
      } else {
        this.logger.error(
          `Fulfillment V2 reconciliation found ${report.totalViolations} violations. ` +
            `counts=${JSON.stringify(report.counts)} resourceIds=${JSON.stringify(report.resourceIds)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Fulfillment V2 reconciliation failed: ${message}`, stack);
    }
  }
}
