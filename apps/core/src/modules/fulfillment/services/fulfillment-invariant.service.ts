import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, inArray, or, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

const ACTIVE_SHIPMENT_STATUSES = new Set(['draft', 'planned', 'recovery_required']);
const ACTIVE_INVOICE_STATUSES = new Set(['issued', 'used', 'issuing', 'voiding', 'recovery_required']);
const SETTLED_ATTEMPT_STATUSES = new Set(['dispatched', 'recalled']);

export const FULFILLMENT_INVARIANT_KINDS = [
  'FOI_QUANTITY',
  'ACTIVE_LINE_QUANTITY',
  'LINE_QUANTITY',
  'CONFIRMED_RESERVATION',
  'ACTIVE_INVOICE_VERSION',
  'SESSION_CONSERVATION',
  'DISPATCH_SOURCE_CARDINALITY',
  'DISPATCH_EVENT_CARDINALITY',
] as const;

export type FulfillmentInvariantViolationKind = (typeof FULFILLMENT_INVARIANT_KINDS)[number];

export interface FulfillmentInvariantViolation {
  kind: FulfillmentInvariantViolationKind;
  resourceId: string;
  message: string;
}

export interface FulfillmentInvariantSnapshot {
  fulfillmentOrderItems: Array<{
    id: string;
    fulfillmentOrderId: string;
    qty: number;
    shippedQty: number;
    canceledQty: number;
  }>;
  shipments: Array<{ id: string; warehouseId: string; status: string; manifestVersion: number }>;
  shipmentLines: Array<{
    id: string;
    shipmentId: string;
    fulfillmentOrderItemId: string;
    skuId: string;
    qty: number;
    inspectedQty: number;
  }>;
  reservations: Array<{
    id: string;
    fulfillmentOrderItemId: string | null;
    shipmentLineId: string | null;
    status: string;
    quantity: number;
  }>;
  invoices: Array<{
    id: string;
    shipmentId: string | null;
    manifestVersion: number | null;
    status: string;
  }>;
  sessions: Array<{
    id: string;
    handedInQty: number;
    settledQty: number;
    returnedQty: number;
    shortageQty: number;
  }>;
  sessionBalances: Array<{ id: string; sessionId: string; custodyType: string; qty: number }>;
  dispatchAttempts: Array<{
    id: string;
    shipmentId: string;
    status: string;
    stockJournalId: string | null;
  }>;
  dispatchSources: Array<{
    id: string;
    dispatchAttemptId: string;
    shipmentLineId: string;
    sourceLocationId: string;
    qty: number;
    stockEventId: string | null;
  }>;
  stockEvents: Array<{
    id: string;
    journalId: string | null;
    skuId: string;
    fromWarehouseId: string | null;
    fromLocationId: string | null;
    fromState: string | null;
    toWarehouseId: string | null;
    toState: string | null;
    transitionType: string;
    quantity: number;
  }>;
}

function sum<T>(rows: readonly T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}

/** Pure counterpart shared by transaction checks and focused unit tests. */
export function collectFulfillmentInvariantViolations(
  snapshot: FulfillmentInvariantSnapshot,
): FulfillmentInvariantViolation[] {
  const violations: FulfillmentInvariantViolation[] = [];
  const shipmentById = new Map(snapshot.shipments.map((shipment) => [shipment.id, shipment]));
  const lineById = new Map(snapshot.shipmentLines.map((line) => [line.id, line]));
  const eventById = new Map(snapshot.stockEvents.map((event) => [event.id, event]));

  for (const item of snapshot.fulfillmentOrderItems) {
    const settledQty = item.shippedQty + item.canceledQty;
    if (item.qty <= 0 || item.shippedQty < 0 || item.canceledQty < 0 || settledQty > item.qty) {
      violations.push({
        kind: 'FOI_QUANTITY',
        resourceId: item.id,
        message: `qty=${item.qty}, shipped=${item.shippedQty}, canceled=${item.canceledQty}`,
      });
      continue;
    }

    const activeLineQty = sum(
      snapshot.shipmentLines.filter(
        (line) =>
          line.fulfillmentOrderItemId === item.id &&
          ACTIVE_SHIPMENT_STATUSES.has(shipmentById.get(line.shipmentId)?.status ?? ''),
      ),
      (line) => line.qty,
    );
    if (item.qty !== settledQty + activeLineQty) {
      violations.push({
        kind: 'ACTIVE_LINE_QUANTITY',
        resourceId: item.id,
        message: `qty=${item.qty}, settled=${settledQty}, activeLines=${activeLineQty}`,
      });
    }
  }

  for (const line of snapshot.shipmentLines) {
    if (line.qty <= 0 || line.inspectedQty < 0 || line.inspectedQty > line.qty) {
      violations.push({
        kind: 'LINE_QUANTITY',
        resourceId: line.id,
        message: `qty=${line.qty}, inspected=${line.inspectedQty}`,
      });
    }
    const confirmedQty = sum(
      snapshot.reservations.filter(
        (reservation) => reservation.shipmentLineId === line.id && reservation.status === 'confirmed',
      ),
      (reservation) => reservation.quantity,
    );
    const shipmentStatus = shipmentById.get(line.shipmentId)?.status;
    if (confirmedQty > line.qty || (shipmentStatus === 'planned' && confirmedQty !== line.qty)) {
      violations.push({
        kind: 'CONFIRMED_RESERVATION',
        resourceId: line.id,
        message: `shipmentStatus=${shipmentStatus ?? 'missing'}, lineQty=${line.qty}, confirmed=${confirmedQty}`,
      });
    }
  }

  for (const reservation of snapshot.reservations) {
    if (
      reservation.status === 'confirmed' &&
      reservation.fulfillmentOrderItemId !== null &&
      reservation.shipmentLineId === null
    ) {
      violations.push({
        kind: 'CONFIRMED_RESERVATION',
        resourceId: reservation.id,
        message: 'confirmed V2 fulfillment reservation has no shipment line',
      });
    }
  }

  for (const invoice of snapshot.invoices) {
    if (!invoice.shipmentId || !ACTIVE_INVOICE_STATUSES.has(invoice.status)) continue;
    const shipment = shipmentById.get(invoice.shipmentId);
    if (!shipment || invoice.manifestVersion !== shipment.manifestVersion) {
      violations.push({
        kind: 'ACTIVE_INVOICE_VERSION',
        resourceId: invoice.id,
        message: `invoiceManifest=${invoice.manifestVersion ?? 'null'}, shipmentManifest=${shipment?.manifestVersion ?? 'missing'}`,
      });
    }
  }

  for (const session of snapshot.sessions) {
    const remainingQty = sum(
      snapshot.sessionBalances.filter(
        (balance) => balance.sessionId === session.id && balance.custodyType !== 'SETTLED',
      ),
      (balance) => balance.qty,
    );
    const accountedQty = remainingQty + session.settledQty + session.returnedQty + session.shortageQty;
    if (session.handedInQty !== accountedQty) {
      violations.push({
        kind: 'SESSION_CONSERVATION',
        resourceId: session.id,
        message: `handedIn=${session.handedInQty}, remaining=${remainingQty}, settled=${session.settledQty}, returned=${session.returnedQty}, shortage=${session.shortageQty}`,
      });
    }
  }

  for (const attempt of snapshot.dispatchAttempts) {
    if (!SETTLED_ATTEMPT_STATUSES.has(attempt.status)) continue;
    const shipmentLines = snapshot.shipmentLines.filter((line) => line.shipmentId === attempt.shipmentId);
    const sources = snapshot.dispatchSources.filter((source) => source.dispatchAttemptId === attempt.id);

    for (const line of shipmentLines) {
      const sourceQty = sum(
        sources.filter((source) => source.shipmentLineId === line.id),
        (source) => source.qty,
      );
      if (sourceQty !== line.qty) {
        violations.push({
          kind: 'DISPATCH_SOURCE_CARDINALITY',
          resourceId: attempt.id,
          message: `line=${line.id}, lineQty=${line.qty}, sourceQty=${sourceQty}`,
        });
      }
    }

    for (const source of sources) {
      const line = lineById.get(source.shipmentLineId);
      const shipment = shipmentById.get(attempt.shipmentId);
      const event = source.stockEventId ? eventById.get(source.stockEventId) : undefined;
      if (!line || line.shipmentId !== attempt.shipmentId) {
        violations.push({
          kind: 'DISPATCH_SOURCE_CARDINALITY',
          resourceId: source.id,
          message: `attempt=${attempt.id}, foreignLine=${source.shipmentLineId}`,
        });
      }
      if (
        !line ||
        line.shipmentId !== attempt.shipmentId ||
        !shipment ||
        !event ||
        event.journalId !== attempt.stockJournalId ||
        event.skuId !== line.skuId ||
        event.fromWarehouseId !== shipment.warehouseId ||
        event.fromLocationId !== source.sourceLocationId ||
        event.fromState !== 'ON_HAND' ||
        event.toWarehouseId !== null ||
        event.toState !== null ||
        event.transitionType !== 'SHIP' ||
        event.quantity !== source.qty
      ) {
        violations.push({
          kind: 'DISPATCH_EVENT_CARDINALITY',
          resourceId: source.id,
          message: `attempt=${attempt.id}, event=${source.stockEventId ?? 'missing'}`,
        });
      }
    }

    const linkedEventIds = new Set(sources.flatMap((source) => (source.stockEventId ? [source.stockEventId] : [])));
    const journalEvents = snapshot.stockEvents.filter((event) => event.journalId === attempt.stockJournalId);
    if (journalEvents.length !== sources.length || journalEvents.some((event) => !linkedEventIds.has(event.id))) {
      violations.push({
        kind: 'DISPATCH_EVENT_CARDINALITY',
        resourceId: attempt.id,
        message: `sources=${sources.length}, journalEvents=${journalEvents.length}`,
      });
    }
  }

  return violations;
}

@Injectable()
export class FulfillmentInvariantService {
  /**
   * Must run inside the mutation transaction. A recursive pre-read finds the entire
   * FOI↔shipment connected component, then durable rows are locked in the canonical order.
   */
  async assertFulfillmentOrders(fulfillmentOrderIds: readonly string[], tx: DbTx): Promise<void> {
    const ids = [...new Set(fulfillmentOrderIds)].sort();
    if (ids.length === 0) throw new NotFoundException('No fulfillment orders supplied for invariant check');

    const seedIds = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const loadConnectedFoiIds = async (): Promise<string[]> => {
      const closureResult = await tx.execute<{ id: string }>(sql`
        WITH RECURSIVE connected_fois(id) AS (
          SELECT id FROM fulfillment_order_items WHERE fulfillment_order_id IN (${seedIds})
          UNION
          SELECT neighbor.id
            FROM connected_fois connected
            JOIN fulfillment_order_items anchor ON anchor.id = connected.id
            JOIN LATERAL (
              SELECT foi_sibling.id
                FROM fulfillment_order_items foi_sibling
               WHERE foi_sibling.fulfillment_order_id = anchor.fulfillment_order_id
              UNION
              SELECT line_sibling.fulfillment_order_item_id
                FROM shipment_lines member
                JOIN shipment_lines line_sibling ON line_sibling.shipment_id = member.shipment_id
               WHERE member.fulfillment_order_item_id = anchor.id
            ) neighbor ON true
        )
        SELECT id FROM connected_fois ORDER BY id
      `);
      return (closureResult as unknown as Array<{ id: string }>).map((row) => row.id);
    };
    const connectedFoiIds = await loadConnectedFoiIds();
    if (connectedFoiIds.length === 0) {
      throw new NotFoundException(`Fulfillment orders have no items: ${ids.join(',')}`);
    }
    const componentChanged = (): never => {
      throw new ConflictException({
        code: 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
        fulfillmentOrderIds: ids,
      });
    };
    const loadLineMembership = () =>
      tx
        .select({
          id: wmsTables.shipmentLines.id,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.fulfillmentOrderItemId, connectedFoiIds))
        .orderBy(asc(wmsTables.shipmentLines.id));
    const membershipSignature = (
      rows: Array<{ id: string; shipmentId: string; fulfillmentOrderItemId: string }>,
    ): string =>
      rows
        .map((row) => `${row.id}:${row.shipmentId}:${row.fulfillmentOrderItemId}`)
        .sort()
        .join(',');

    // Canonical lock order: FOI -> shipment -> line -> reservation -> work item/session.
    const fulfillmentOrderItems = await tx
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        qty: wmsTables.fulfillmentOrderItems.qty,
        shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .where(inArray(wmsTables.fulfillmentOrderItems.id, connectedFoiIds))
      .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
      .for('update');

    // A line may have connected another FO between the optimistic closure read and
    // the FOI locks. Never continue with a partially locked connected component.
    const lockedClosureIds = await loadConnectedFoiIds();
    if (lockedClosureIds.join(',') !== connectedFoiIds.join(',')) {
      componentChanged();
    }
    const initialLineMembership = await loadLineMembership();
    const shipmentIds = [...new Set(initialLineMembership.map((row) => row.shipmentId))].sort();

    const shipments = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.shipments.id,
            warehouseId: wmsTables.shipments.warehouseId,
            status: wmsTables.shipments.status,
            manifestVersion: wmsTables.shipments.manifestVersion,
          })
          .from(wmsTables.shipments)
          .where(inArray(wmsTables.shipments.id, shipmentIds))
          .orderBy(asc(wmsTables.shipments.id))
          .for('update')
      : [];
    const shipmentLines = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.shipmentLines.id,
            shipmentId: wmsTables.shipmentLines.shipmentId,
            fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
            skuId: wmsTables.shipmentLines.skuId,
            qty: wmsTables.shipmentLines.qty,
            inspectedQty: wmsTables.shipmentLines.inspectedQty,
          })
          .from(wmsTables.shipmentLines)
          .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
          .orderBy(asc(wmsTables.shipmentLines.id))
          .for('update')
      : [];

    // Membership can change without updating an FOI (for example shipment_id A->B).
    // Lock the discovered line set, then compare FOI/shipment/line membership again.
    // Shipment locks block new members of an existing shipment; FOI locks block new
    // lines for the connected demand. Any change observed in the window is retried.
    const finalClosureIds = await loadConnectedFoiIds();
    const finalLineMembership = await loadLineMembership();
    const lockedFoiIds = fulfillmentOrderItems.map((item) => item.id).sort();
    const lockedShipmentIds = shipments.map((shipment) => shipment.id).sort();
    const lockedLineMembership = shipmentLines.map((line) => ({
      id: line.id,
      shipmentId: line.shipmentId,
      fulfillmentOrderItemId: line.fulfillmentOrderItemId,
    }));
    if (
      lockedFoiIds.join(',') !== connectedFoiIds.join(',') ||
      lockedShipmentIds.join(',') !== shipmentIds.join(',') ||
      finalClosureIds.join(',') !== connectedFoiIds.join(',') ||
      membershipSignature(initialLineMembership) !== membershipSignature(lockedLineMembership) ||
      membershipSignature(finalLineMembership) !== membershipSignature(lockedLineMembership)
    ) {
      componentChanged();
    }
    const shipmentLineIds = shipmentLines.map((line) => line.id);
    const reservationWhere = shipmentLineIds.length
      ? or(
          inArray(wmsTables.stockReservations.fulfillmentOrderItemId, connectedFoiIds),
          inArray(wmsTables.stockReservations.shipmentLineId, shipmentLineIds),
        )
      : inArray(wmsTables.stockReservations.fulfillmentOrderItemId, connectedFoiIds);
    const reservations = await tx
      .select({
        id: wmsTables.stockReservations.id,
        fulfillmentOrderItemId: wmsTables.stockReservations.fulfillmentOrderItemId,
        shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        status: wmsTables.stockReservations.status,
        quantity: wmsTables.stockReservations.quantity,
      })
      .from(wmsTables.stockReservations)
      .where(reservationWhere)
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
      .for('update');

    const invoices = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.invoices.id,
            shipmentId: wmsTables.invoices.shipmentId,
            manifestVersion: wmsTables.invoices.manifestVersion,
            status: wmsTables.invoices.status,
          })
          .from(wmsTables.invoices)
          .where(inArray(wmsTables.invoices.shipmentId, shipmentIds))
          .orderBy(asc(wmsTables.invoices.id))
          .for('update')
      : [];
    const workItems = shipmentIds.length
      ? await tx
          .select({ id: wmsTables.outboundBatchWorkItems.id, batchId: wmsTables.outboundBatchWorkItems.batchId })
          .from(wmsTables.outboundBatchWorkItems)
          .where(inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds))
          .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
          .for('update')
      : [];
    const batchIds = [...new Set(workItems.map((item) => item.batchId))].sort();
    const sessions = batchIds.length
      ? await tx
          .select({
            id: wmsTables.batchInventorySessions.id,
            handedInQty: wmsTables.batchInventorySessions.handedInQty,
            settledQty: wmsTables.batchInventorySessions.settledQty,
            returnedQty: wmsTables.batchInventorySessions.returnedQty,
            shortageQty: wmsTables.batchInventorySessions.shortageQty,
          })
          .from(wmsTables.batchInventorySessions)
          .where(inArray(wmsTables.batchInventorySessions.batchId, batchIds))
          .orderBy(asc(wmsTables.batchInventorySessions.id))
          .for('update')
      : [];
    const sessionIds = sessions.map((session) => session.id);
    const sessionBalances = sessionIds.length
      ? await tx
          .select({
            id: wmsTables.batchInventorySessionBalances.id,
            sessionId: wmsTables.batchInventorySessionBalances.sessionId,
            custodyType: wmsTables.batchInventorySessionBalances.custodyType,
            qty: wmsTables.batchInventorySessionBalances.qty,
          })
          .from(wmsTables.batchInventorySessionBalances)
          .where(inArray(wmsTables.batchInventorySessionBalances.sessionId, sessionIds))
          .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
          .for('update')
      : [];
    const dispatchAttempts = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.dispatchAttempts.id,
            shipmentId: wmsTables.dispatchAttempts.shipmentId,
            status: wmsTables.dispatchAttempts.status,
            stockJournalId: wmsTables.dispatchAttempts.stockJournalId,
          })
          .from(wmsTables.dispatchAttempts)
          .where(inArray(wmsTables.dispatchAttempts.shipmentId, shipmentIds))
          .orderBy(asc(wmsTables.dispatchAttempts.id))
          .for('update')
      : [];
    const attemptIds = dispatchAttempts.map((attempt) => attempt.id);
    const dispatchSources = attemptIds.length
      ? await tx
          .select({
            id: wmsTables.dispatchAttemptSources.id,
            dispatchAttemptId: wmsTables.dispatchAttemptSources.dispatchAttemptId,
            shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
            sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
            qty: wmsTables.dispatchAttemptSources.qty,
            stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
          })
          .from(wmsTables.dispatchAttemptSources)
          .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds))
          .orderBy(asc(wmsTables.dispatchAttemptSources.id))
          .for('update')
      : [];
    const journalIds = dispatchAttempts.flatMap((attempt) => (attempt.stockJournalId ? [attempt.stockJournalId] : []));
    const stockEvents = journalIds.length
      ? await tx
          .select({
            id: wmsTables.stockEvents.id,
            journalId: wmsTables.stockEvents.journalId,
            skuId: wmsTables.stockEvents.skuId,
            fromWarehouseId: wmsTables.stockEvents.fromWarehouseId,
            fromLocationId: wmsTables.stockEvents.fromLocationId,
            fromState: wmsTables.stockEvents.fromState,
            toWarehouseId: wmsTables.stockEvents.toWarehouseId,
            toState: wmsTables.stockEvents.toState,
            transitionType: wmsTables.stockEvents.transitionType,
            quantity: wmsTables.stockEvents.quantity,
          })
          .from(wmsTables.stockEvents)
          .where(inArray(wmsTables.stockEvents.journalId, journalIds))
          .orderBy(asc(wmsTables.stockEvents.id))
          .for('update')
      : [];

    const violations = collectFulfillmentInvariantViolations({
      fulfillmentOrderItems,
      shipments,
      shipmentLines,
      reservations,
      invoices,
      sessions,
      sessionBalances,
      dispatchAttempts,
      dispatchSources,
      stockEvents,
    });
    if (violations.length > 0) {
      throw new ConflictException({
        code: 'FULFILLMENT_INVARIANT_VIOLATION',
        violations,
      });
    }
  }
}
