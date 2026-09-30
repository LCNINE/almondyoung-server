import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

const ACTIVE_SHIPMENT_STATUSES = new Set(['draft', 'planned', 'recovery_required']);
// 활성 waybill = 종료 3상태(voided/failed/abandoned) 아닌 모든 상태(waybills 테이블 uq_waybills_shipment_active 와 동치).
// 구 "활성 invoice(status ∈ allowlist)" 의 의미를 waybill 기준(terminal 제외)으로 보존 치환.
const WAYBILL_TERMINAL_STATUS_SET = new Set<string>(WAYBILL_TERMINAL_STATUSES);
const SETTLED_ATTEMPT_STATUSES = new Set(['dispatched', 'recalled']);
// I3 의 두 갈래: 줄에 귀속된 보관은 그 줄·로케이션 배정과, 공유 보관은 SKU·로케이션의 남은 배정과 견준다.
const LINE_ATTRIBUTED_CUSTODY = new Set([
  'WORKER',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
  'RETURN_PENDING',
  'SETTLED',
]);
const SHARED_CUSTODY = new Set(['AT_SOURCE', 'BULK_CART']);

export const FULFILLMENT_INVARIANT_KINDS = [
  'FOI_QUANTITY',
  'ACTIVE_LINE_QUANTITY',
  'LINE_QUANTITY',
  'CONFIRMED_RESERVATION',
  'ACTIVE_INVOICE_VERSION',
  'SESSION_CONSERVATION',
  'DISPATCH_SOURCE_CARDINALITY',
  'DISPATCH_EVENT_CARDINALITY',
  'ALLOCATION_BEFORE_START',
  'ALLOCATION_BELOW_TARGET',
  'CUSTODY_EXCEEDS_ALLOCATION',
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
  shipments: Array<{
    id: string;
    warehouseId: string;
    status: string;
    manifestVersion: number;
    recoveryCode?: string | null;
  }>;
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
  waybills: Array<{
    id: string;
    shipmentId: string | null;
    manifestVersion: number | null;
    status: string;
  }>;
  sessions: Array<{
    id: string;
    batchId: string;
    handedInQty: number;
    handedBackQty: number;
    settledQty: number;
    returnedQty: number;
    shortageQty: number;
  }>;
  sessionBalances: Array<{
    id: string;
    sessionId: string;
    custodyType: string;
    qty: number;
    skuId: string;
    sourceLocationId: string | null;
    shipmentLineId: string | null;
  }>;
  batches: Array<{ id: string; startedAt: Date | null }>;
  workItems: Array<{ id: string; batchId: string; shipmentId: string; status: string }>;
  allocations: Array<{
    id: string;
    workItemId: string;
    batchId: string;
    shipmentLineId: string;
    skuId: string;
    sourceLocationId: string;
    qty: number;
  }>;
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
          ACTIVE_SHIPMENT_STATUSES.has(shipmentById.get(line.shipmentId)?.status ?? '') &&
          !(
            shipmentById.get(line.shipmentId)?.status === 'recovery_required' &&
            shipmentById.get(line.shipmentId)?.recoveryCode === 'DISPATCH_RECALL_PENDING'
          ),
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

  for (const waybill of snapshot.waybills) {
    if (!waybill.shipmentId || WAYBILL_TERMINAL_STATUS_SET.has(waybill.status)) continue;
    const shipment = shipmentById.get(waybill.shipmentId);
    if (!shipment || waybill.manifestVersion !== shipment.manifestVersion) {
      violations.push({
        kind: 'ACTIVE_INVOICE_VERSION',
        resourceId: waybill.id,
        message: `invoiceManifest=${waybill.manifestVersion ?? 'null'}, shipmentManifest=${shipment?.manifestVersion ?? 'missing'}`,
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
    const accountedQty =
      remainingQty + session.settledQty + session.returnedQty + session.shortageQty + session.handedBackQty;
    if (session.handedInQty !== accountedQty) {
      violations.push({
        kind: 'SESSION_CONSERVATION',
        resourceId: session.id,
        message: `handedIn=${session.handedInQty}, remaining=${remainingQty}, settled=${session.settledQty}, returned=${session.returnedQty}, shortage=${session.shortageQty}, handedBack=${session.handedBackQty}`,
      });
    }
  }

  // 스펙 §5 — I1(시작 전 배정 0)·I2(시작된 배치의 활성 작업 항목은 배정 ≥ 목표)·I3(보관 ≤ 배정).
  // I4 는 넣지 않는다: 데이터 상태가 아니라 «그릴 수 있는가»의 규칙이고 송장 조립(assertLabelAllocated)이 강제한다.
  const batchById = new Map(snapshot.batches.map((batch) => [batch.id, batch]));
  for (const item of snapshot.workItems) {
    const itemAllocations = snapshot.allocations.filter((allocation) => allocation.workItemId === item.id);
    if (!batchById.get(item.batchId)?.startedAt) {
      const allocatedQty = sum(itemAllocations, (allocation) => allocation.qty);
      if (allocatedQty > 0) {
        violations.push({
          kind: 'ALLOCATION_BEFORE_START',
          resourceId: item.id,
          message: `batch=${item.batchId}, allocated=${allocatedQty}`,
        });
      }
      continue;
    }
    if (item.status === 'completed' || item.status === 'excluded') continue;
    for (const line of snapshot.shipmentLines.filter((candidate) => candidate.shipmentId === item.shipmentId)) {
      const allocatedQty = sum(
        itemAllocations.filter((allocation) => allocation.shipmentLineId === line.id),
        (allocation) => allocation.qty,
      );
      if (allocatedQty < line.qty) {
        violations.push({
          kind: 'ALLOCATION_BELOW_TARGET',
          resourceId: item.id,
          message: `line=${line.id}, lineQty=${line.qty}, allocated=${allocatedQty}`,
        });
      }
    }
  }
  for (const session of snapshot.sessions) {
    const batchAllocations = snapshot.allocations.filter((allocation) => allocation.batchId === session.batchId);
    const balances = snapshot.sessionBalances.filter((balance) => balance.sessionId === session.id && balance.qty > 0);
    const attributedByLine = new Map<string, number>();
    const attributedBySku = new Map<string, number>();
    const sharedBySku = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      const skuKey = `${balance.skuId}|${balance.sourceLocationId}`;
      if (balance.shipmentLineId && LINE_ATTRIBUTED_CUSTODY.has(balance.custodyType)) {
        const lineKey = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributedByLine.set(lineKey, (attributedByLine.get(lineKey) ?? 0) + balance.qty);
        attributedBySku.set(skuKey, (attributedBySku.get(skuKey) ?? 0) + balance.qty);
      } else if (SHARED_CUSTODY.has(balance.custodyType)) {
        sharedBySku.set(skuKey, (sharedBySku.get(skuKey) ?? 0) + balance.qty);
      }
    }
    for (const [lineKey, custodyQty] of attributedByLine) {
      const allocatedQty = sum(
        batchAllocations.filter(
          (allocation) => `${allocation.shipmentLineId}|${allocation.sourceLocationId}` === lineKey,
        ),
        (allocation) => allocation.qty,
      );
      if (custodyQty > allocatedQty) {
        violations.push({
          kind: 'CUSTODY_EXCEEDS_ALLOCATION',
          resourceId: session.id,
          message: `line|location=${lineKey}, custody=${custodyQty}, allocated=${allocatedQty}`,
        });
      }
    }
    for (const [skuKey, sharedQty] of sharedBySku) {
      const allocatedQty = sum(
        batchAllocations.filter((allocation) => `${allocation.skuId}|${allocation.sourceLocationId}` === skuKey),
        (allocation) => allocation.qty,
      );
      const roomQty = allocatedQty - (attributedBySku.get(skuKey) ?? 0);
      if (sharedQty > roomQty) {
        violations.push({
          kind: 'CUSTODY_EXCEEDS_ALLOCATION',
          resourceId: session.id,
          message: `sku|location=${skuKey}, shared=${sharedQty}, unattributedAllocation=${roomQty}`,
        });
      }
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
  async assertFulfillmentOrders(
    fulfillmentOrderIds: readonly string[],
    tx: DbTx,
    options: { ignoredWaybillIds?: readonly string[] } = {},
  ): Promise<void> {
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
            recoveryCode: wmsTables.shipments.recoveryCode,
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

    const waybills = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.waybills.id,
            shipmentId: wmsTables.waybills.shipmentId,
            manifestVersion: wmsTables.waybills.manifestVersion,
            status: wmsTables.waybills.status,
          })
          .from(wmsTables.waybills)
          .where(inArray(wmsTables.waybills.shipmentId, shipmentIds))
          .orderBy(asc(wmsTables.waybills.id))
          .for('update')
      : [];
    const workItems = shipmentIds.length
      ? await tx
          .select({
            id: wmsTables.outboundBatchWorkItems.id,
            batchId: wmsTables.outboundBatchWorkItems.batchId,
            shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
            status: wmsTables.outboundBatchWorkItems.status,
          })
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
            batchId: wmsTables.batchInventorySessions.batchId,
            handedInQty: wmsTables.batchInventorySessions.handedInQty,
            handedBackQty: wmsTables.batchInventorySessions.handedBackQty,
            settledQty: wmsTables.batchInventorySessions.settledQty,
            returnedQty: wmsTables.batchInventorySessions.returnedQty,
            shortageQty: wmsTables.batchInventorySessions.shortageQty,
          })
          .from(wmsTables.batchInventorySessions)
          .where(inArray(wmsTables.batchInventorySessions.batchId, batchIds))
          .orderBy(asc(wmsTables.batchInventorySessions.id))
          .for('update')
      : [];
    // 잠그지 않는다 — 배정은 작업 항목·세션 잠금 아래에서만 바뀌고 started_at 은 한 번만 쓰인다.
    const batches = batchIds.length
      ? await tx
          .select({ id: wmsTables.outboundBatches.id, startedAt: wmsTables.outboundBatches.startedAt })
          .from(wmsTables.outboundBatches)
          .where(inArray(wmsTables.outboundBatches.id, batchIds))
      : [];
    const allocations = batchIds.length
      ? await tx
          .select({
            id: wmsTables.pickingSourceAllocations.id,
            // holds because the inner join below filters to rows with a work item.
            workItemId: sql<string>`${wmsTables.pickingSourceAllocations.workItemId}`,
            batchId: wmsTables.outboundBatchWorkItems.batchId,
            shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
            skuId: wmsTables.shipmentLines.skuId,
            sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
            qty: wmsTables.pickingSourceAllocations.qty,
          })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.outboundBatchWorkItems,
            eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
          )
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .where(inArray(wmsTables.outboundBatchWorkItems.batchId, batchIds))
      : [];
    const sessionIds = sessions.map((session) => session.id);
    const sessionBalances = sessionIds.length
      ? await tx
          .select({
            id: wmsTables.batchInventorySessionBalances.id,
            sessionId: wmsTables.batchInventorySessionBalances.sessionId,
            custodyType: wmsTables.batchInventorySessionBalances.custodyType,
            qty: wmsTables.batchInventorySessionBalances.qty,
            skuId: wmsTables.batchInventorySessionBalances.skuId,
            sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
            shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
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

    const ignoredWaybillIds = new Set(options.ignoredWaybillIds ?? []);
    const violations = collectFulfillmentInvariantViolations({
      fulfillmentOrderItems,
      shipments,
      shipmentLines,
      reservations,
      waybills: waybills.filter((waybill) => !ignoredWaybillIds.has(waybill.id)),
      sessions,
      sessionBalances,
      batches,
      workItems,
      allocations,
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
