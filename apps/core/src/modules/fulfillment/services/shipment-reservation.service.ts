import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  acquireStockAvailabilityLock,
  acquireStockAvailabilityLocks,
} from '../../inventory/shared/locks/stock-availability-lock';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService, FulfillmentOrderItemProgressInput } from './fulfillment-progress.service';
import { shortPickOperationIntentOf, ShortPickOperationIntentProof } from './batch-inventory-session.service';

const ACTIVE_SHIPMENT_STATUSES = ['draft', 'planned', 'recovery_required'] as const;

type LineContext = {
  id: string;
  shipmentId: string;
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  skuId: string;
  qty: number;
  createdAt: Date;
  warehouseId: string;
  shipmentStatus: string;
};

type ConfirmedReservation = typeof wmsTables.stockReservations.$inferSelect;

type ShortPickOperationOwner = {
  memberOperationId: string;
  shipmentId: string;
  type: string;
  status: string;
  intent: ShortPickOperationIntentProof | null;
};

export type PartialReservationResult = {
  shipmentLineId: string;
  requestedQty: number;
  reservedQty: number;
  totalReservedQty: number;
  shortageQty: number;
  mutated: boolean;
  reservationIds: string[];
  reservationVersion: number;
};

export type DispatchReservationLine = {
  shipmentLineId: string;
  quantity: number;
};

export type DispatchReservationConsumption = {
  shipmentId: string;
  attemptId: string;
  consumedQuantity: number;
  affectedReservationIds: string[];
  affectedSkuIds: string[];
};

export type ShortPickReservationInvalidation = {
  shipmentLineId: string;
  shortPickOperationId: string;
  invalidatedQty: number;
  totalReservedQty: number;
  affectedReservationIds: string[];
  reservationVersion: number;
  replayed: boolean;
};

export type RecallReservationRestoration = {
  shipmentId: string;
  dispatchAttemptId: string;
  recallOperationId: string;
  restoredQuantity: number;
  reservationIds: string[];
  affectedSkuIds: string[];
  reservationVersion: number;
  replayed: boolean;
};

export function computePartialReservationQuantity(input: {
  requestedQty: number;
  outstandingQty: number;
  availableQty: number;
}): number {
  return Math.max(0, Math.min(input.requestedQty, input.outstandingQty, input.availableQty));
}

export function earliestReservationDemandAt(fallback: Date, ...candidates: Array<Date | null | undefined>): Date {
  return candidates.reduce<Date>(
    (earliest, candidate) => (candidate && candidate.getTime() < earliest.getTime() ? candidate : earliest),
    fallback,
  );
}

export function normalizeReservationDemandAt(value: Date | string | null | undefined, fallback: Date): Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function planOldestReservationInvalidation(
  reservations: ReadonlyArray<{ id: string; quantity: number }>,
  qty: number,
): Array<{ id: string; invalidatedQty: number; remainingQty: number }> {
  let remaining = qty;
  const plan: Array<{ id: string; invalidatedQty: number; remainingQty: number }> = [];
  for (const reservation of reservations) {
    if (remaining === 0) break;
    const invalidatedQty = Math.min(remaining, reservation.quantity);
    plan.push({ id: reservation.id, invalidatedQty, remainingQty: reservation.quantity - invalidatedQty });
    remaining -= invalidatedQty;
  }
  return plan;
}

type RecallReservationLineEvidence = {
  id: string;
  skuId: string;
  warehouseId: string;
  qty: number;
};

type RecallReservationRowEvidence = {
  id: string;
  targetType: string;
  targetId: string;
  shipmentLineId: string | null;
  skuId: string;
  warehouseId: string;
  quantity: number;
};

export function assertExactRecallReservationEvidence(
  evidenceLabel: string,
  lines: readonly RecallReservationLineEvidence[],
  reservations: readonly RecallReservationRowEvidence[],
): void {
  const linesById = new Map(lines.map((line) => [line.id, line]));
  const quantityByLine = new Map<string, number>();

  for (const reservation of reservations) {
    const line = reservation.shipmentLineId ? linesById.get(reservation.shipmentLineId) : undefined;
    if (
      !line ||
      reservation.targetType !== 'SHIPMENT_LINE' ||
      reservation.targetId !== line.id ||
      reservation.skuId !== line.skuId ||
      reservation.warehouseId !== line.warehouseId
    ) {
      throw new ConflictException(
        `${evidenceLabel} reservation ${reservation.id} ownership does not match its shipment line`,
      );
    }
    quantityByLine.set(line.id, (quantityByLine.get(line.id) ?? 0) + reservation.quantity);
  }

  for (const line of lines) {
    const actual = quantityByLine.get(line.id) ?? 0;
    if (actual !== line.qty) {
      throw new ConflictException(
        `${evidenceLabel} reservation quantity is not exact for shipment line ${line.id}: expected ${line.qty}, found ${actual}`,
      );
    }
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${name} must be a positive safe integer`);
  }
}

async function lockConfirmedShipmentReservations(shipmentLineIds: readonly string[], tx: DbTx): Promise<void> {
  // Canonical row-lock order is physical creation order then UUID. Fairness
  // consumption order is a separate in-memory requestedAt/id ordering.
  const ids = [...new Set(shipmentLineIds)].sort();
  if (ids.length === 0) return;
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await tx.execute(sql`
    SELECT id
      FROM stock_reservations
     WHERE target_type = 'SHIPMENT_LINE'
       AND shipment_line_id IN (${idList})
       AND status = 'confirmed'
     ORDER BY created_at, id
     FOR UPDATE
  `);
}

/**
 * Locks the whole connected fulfillment/shipment graph for any command that
 * will subsequently lock a dispatch attempt. Callers may discover their seed
 * line optimistically, but must re-read and validate its identity after this
 * helper returns.
 */
export async function lockShipmentConnectedComponentGraph(
  tx: DbTx,
  seedFulfillmentOrderItemIds: readonly string[],
): Promise<void> {
  const seedIds = [...new Set(seedFulfillmentOrderItemIds)].sort();
  if (seedIds.length === 0) {
    throw new ConflictException('Reservation component has no fulfillment-order-item seed');
  }
  const seedList = sql.join(
    seedIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const loadConnectedFoiIds = async (): Promise<string[]> => {
    const result = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE connected_fois(id) AS (
        SELECT id FROM fulfillment_order_items WHERE id IN (${seedList})
        UNION
        SELECT neighbor.id
          FROM connected_fois connected
          JOIN fulfillment_order_items anchor ON anchor.id = connected.id
          JOIN LATERAL (
            SELECT sibling.id
              FROM fulfillment_order_items sibling
             WHERE sibling.fulfillment_order_id = anchor.fulfillment_order_id
            UNION
            SELECT shipment_sibling.fulfillment_order_item_id
              FROM shipment_lines member
              JOIN shipment_lines shipment_sibling ON shipment_sibling.shipment_id = member.shipment_id
             WHERE member.fulfillment_order_item_id = anchor.id
          ) neighbor ON true
      )
      SELECT id FROM connected_fois ORDER BY id
    `);
    return (result as unknown as Array<{ id: string }>).map((row) => row.id);
  };

  const fulfillmentOrderItemIds = await loadConnectedFoiIds();
  if (fulfillmentOrderItemIds.length === 0) {
    throw new ConflictException('Reservation component disappeared while acquiring locks; retry the command');
  }
  const loadFoiMembership = (ids: readonly string[]) =>
    tx
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .where(inArray(wmsTables.fulfillmentOrderItems.id, [...ids]));
  const membershipSignature = (
    foiRows: Array<{ id: string; fulfillmentOrderId: string }>,
    lineRows: Array<{ id: string; shipmentId: string; fulfillmentOrderItemId: string }>,
  ): string =>
    JSON.stringify({
      fulfillmentOrderItems: foiRows.map((row) => `${row.id}:${row.fulfillmentOrderId}`).sort(),
      shipmentLines: lineRows.map((row) => `${row.id}:${row.shipmentId}:${row.fulfillmentOrderItemId}`).sort(),
    });
  const initialFoiMembership = await loadFoiMembership(fulfillmentOrderItemIds);
  const initialComponentLines = await tx
    .select({
      id: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
    })
    .from(wmsTables.shipmentLines)
    .where(inArray(wmsTables.shipmentLines.fulfillmentOrderItemId, fulfillmentOrderItemIds));
  const initialSignature = membershipSignature(initialFoiMembership, initialComponentLines);

  for (const id of fulfillmentOrderItemIds) {
    await tx.execute(sql`SELECT id FROM fulfillment_order_items WHERE id = ${id}::uuid FOR UPDATE`);
  }

  const componentLines = await tx
    .select({ id: wmsTables.shipmentLines.id, shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .where(inArray(wmsTables.shipmentLines.fulfillmentOrderItemId, fulfillmentOrderItemIds));
  const shipmentIds = [...new Set(componentLines.map((row) => row.shipmentId))].sort();
  for (const id of shipmentIds) {
    await tx.execute(sql`SELECT id FROM shipments WHERE id = ${id}::uuid FOR UPDATE`);
  }

  const lineIds = [...new Set(componentLines.map((row) => row.id))].sort();
  for (const id of lineIds) {
    await tx.execute(sql`SELECT id FROM shipment_lines WHERE id = ${id}::uuid FOR UPDATE`);
  }
  await lockConfirmedShipmentReservations(lineIds, tx);

  const stableFoiIds = await loadConnectedFoiIds();
  const stableFoiMembership = await loadFoiMembership(stableFoiIds);
  const stableComponentLines = await tx
    .select({
      id: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
    })
    .from(wmsTables.shipmentLines)
    .where(inArray(wmsTables.shipmentLines.fulfillmentOrderItemId, stableFoiIds));
  if (
    stableFoiIds.length !== fulfillmentOrderItemIds.length ||
    stableFoiIds.some((id, index) => id !== fulfillmentOrderItemIds[index]) ||
    membershipSignature(stableFoiMembership, stableComponentLines) !== initialSignature
  ) {
    throw new ConflictException('Reservation component changed while acquiring locks; retry the command');
  }
}

/**
 * V2 reservation owner. Reservation truth is keyed only by shipment line; the
 * legacy FO-target facade is deliberately not consulted by any method here.
 */
@Injectable()
export class ShipmentReservationService {
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unifiedReservation: UnifiedReservationService,
    private readonly progress: FulfillmentProgressService,
    private readonly invariant: FulfillmentInvariantService,
  ) {}

  /**
   * Acquire the shared FOI/shipment/line/reservation graph order used by every
   * V2 reservation mutation before a dispatch locks invoice/work/session rows.
   */
  async lockShipmentGraphForDispatch(shipmentId: string, tx: DbTx): Promise<void> {
    const lineIds = await tx
      .select({ id: wmsTables.shipmentLines.id })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lineIds.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);

    const contexts: LineContext[] = [];
    for (const line of lineIds) contexts.push(await this.loadLineContext(line.id, tx));
    await this.lockConnectedComponents(contexts, tx);
  }

  async reservePartial(shipmentLineId: string, requestedQty: number, tx?: DbTx): Promise<PartialReservationResult> {
    assertPositiveInteger('requestedQty', requestedQty);
    return this.db.run(async (trx) => {
      const initial = await this.loadLineContext(shipmentLineId, trx);
      await this.lockConnectedComponents([initial], trx);

      const line = await this.loadLineContext(shipmentLineId, trx);
      this.assertStableContext(initial, line);
      this.assertDraft(line, 'reserve');
      await acquireStockAvailabilityLock(trx, line.skuId, line.warehouseId);

      const [releasedShortPickDemand] = await trx
        .select({
          requestedAt: sql<
            Date | string | null
          >`min(coalesce(${wmsTables.stockReservations.requestedAt}, ${wmsTables.stockReservations.createdAt}))`,
        })
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
            eq(wmsTables.stockReservations.shipmentLineId, line.id),
            eq(wmsTables.stockReservations.status, 'released'),
            sql`${wmsTables.stockReservations.stateReason} LIKE 'short-pick:%'`,
          ),
        );
      const reservations = await this.loadConfirmedReservations(line.id, trx);
      const demandRequestedAt = normalizeReservationDemandAt(releasedShortPickDemand?.requestedAt, line.createdAt);
      const confirmedQty = reservations.reduce((total, row) => total + row.quantity, 0);
      const outstandingQty = Math.max(0, line.qty - confirmedQty);
      const availableQty = await this.unifiedReservation.getAvailableQuantity(line.skuId, line.warehouseId, trx);
      const quantity = computePartialReservationQuantity({ requestedQty, outstandingQty, availableQty });

      if (quantity === 0) {
        return {
          shipmentLineId,
          requestedQty,
          reservedQty: 0,
          totalReservedQty: confirmedQty,
          shortageQty: outstandingQty,
          mutated: false,
          reservationIds: reservations.map((row) => row.id),
          reservationVersion: await this.loadReservationVersion(line.shipmentId, trx),
        };
      }

      let reservationId: string;
      if (reservations[0]) {
        // Retry grows the existing oldest claim. Row splitting is reserved for
        // partial release/transfer, preserving one fairness timestamp per claim.
        await trx
          .update(wmsTables.stockReservations)
          .set({
            quantity: reservations[0].quantity + quantity,
            requestedAt: earliestReservationDemandAt(
              demandRequestedAt,
              reservations[0].requestedAt ?? reservations[0].createdAt,
            ),
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.stockReservations.id, reservations[0].id));
        reservationId = reservations[0].id;
        await this.unifiedReservation.recalculateSellableForSku(line.skuId, trx);
      } else {
        const reservation = await this.unifiedReservation.reserveStock(
          {
            targetType: 'SHIPMENT_LINE',
            targetId: line.id,
            shipmentLineId: line.id,
            skuId: line.skuId,
            warehouseId: line.warehouseId,
            quantity,
            requestedAt: demandRequestedAt,
            stockLockHeld: true,
            reason: 'Shipment line partial reservation',
          },
          trx,
        );
        reservationId = reservation.id;
      }

      await this.bumpReservationVersions([line.shipmentId], trx);
      await this.recompute(line.shipmentId, trx);

      const totalReservedQty = confirmedQty + quantity;
      return {
        shipmentLineId,
        requestedQty,
        reservedQty: quantity,
        totalReservedQty,
        shortageQty: line.qty - totalReservedQty,
        mutated: true,
        reservationIds: [reservationId],
        reservationVersion: await this.loadReservationVersion(line.shipmentId, trx),
      };
    }, tx);
  }

  async releasePartial(
    shipmentLineId: string,
    qty: number,
    reason: string,
    tx?: DbTx,
  ): Promise<{
    shipmentLineId: string;
    releasedQty: number;
    totalReservedQty: number;
    affectedReservationIds: string[];
    reservationVersion: number;
  }> {
    assertPositiveInteger('qty', qty);
    if (!reason.trim()) throw new BadRequestException('reason is required');

    return this.db.run(async (trx) => {
      const initial = await this.loadLineContext(shipmentLineId, trx);
      await this.lockConnectedComponents([initial], trx);
      const line = await this.loadLineContext(shipmentLineId, trx);
      this.assertStableContext(initial, line);
      this.assertDraft(line, 'release');
      await acquireStockAvailabilityLock(trx, line.skuId, line.warehouseId);

      const reservations = await this.loadConfirmedReservations(line.id, trx);
      const confirmedQty = reservations.reduce((total, row) => total + row.quantity, 0);
      if (qty > confirmedQty) {
        throw new ConflictException(`Cannot release ${qty}; shipment line ${line.id} has ${confirmedQty} confirmed`);
      }

      const now = new Date();
      let remaining = qty;
      const affectedReservationIds: string[] = [];
      for (const reservation of reservations) {
        if (remaining === 0) break;
        const released = Math.min(remaining, reservation.quantity);
        if (released === reservation.quantity) {
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released', stateReason: reason, invalidatedAt: now, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          affectedReservationIds.push(reservation.id);
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: reservation.quantity - released, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          const [split] = await trx
            .insert(wmsTables.stockReservations)
            .values({
              targetType: 'SHIPMENT_LINE',
              targetId: line.id,
              shipmentLineId: line.id,
              skuId: line.skuId,
              warehouseId: line.warehouseId,
              quantity: released,
              status: 'released',
              timeoutAt: reservation.timeoutAt,
              reason: reservation.reason,
              requestedAt: reservation.requestedAt ?? reservation.createdAt,
              stateReason: reason,
              invalidatedAt: now,
            })
            .returning({ id: wmsTables.stockReservations.id });
          affectedReservationIds.push(reservation.id, split.id);
        }
        remaining -= released;
      }

      await this.unifiedReservation.recalculateSellableForSku(line.skuId, trx);
      await this.bumpReservationVersions([line.shipmentId], trx);
      await this.recompute(line.shipmentId, trx);
      return {
        shipmentLineId,
        releasedQty: qty,
        totalReservedQty: confirmedQty - qty,
        affectedReservationIds: [...new Set(affectedReservationIds)],
        reservationVersion: await this.loadReservationVersion(line.shipmentId, trx),
      };
    }, tx);
  }

  async invalidateForShortPick(
    shipmentLineId: string,
    qty: number,
    shortPickOperationId: string,
    tx?: DbTx,
  ): Promise<ShortPickReservationInvalidation> {
    assertPositiveInteger('qty', qty);
    if (!shortPickOperationId.trim()) throw new BadRequestException('shortPickOperationId is required');
    const stateReason = `short-pick:${shortPickOperationId}`;

    return this.db.run(async (trx) => {
      const initial = await this.loadLineContext(shipmentLineId, trx);
      const lockedOperationOwner = await this.loadShortPickOperationOwner(
        shortPickOperationId,
        initial.shipmentId,
        trx,
      );
      this.assertValidShortPickOperationOwner(lockedOperationOwner, shortPickOperationId, initial.shipmentId);

      // Canonical short-pick mutation order is operation/member -> reservation
      // graph -> invoice/work/plan/session/custody.
      await this.lockConnectedComponents([initial], trx);
      const line = await this.loadLineContext(shipmentLineId, trx);
      this.assertStableContext(initial, line);
      if (lockedOperationOwner.shipmentId !== line.shipmentId) {
        throw new ConflictException('Short-pick operation ownership changed while acquiring reservation locks');
      }
      const intendedShortQty = lockedOperationOwner.intent.lines
        .filter((intentLine) => intentLine.shipmentLineId === line.id)
        .reduce((total, intentLine) => total + intentLine.shortQty, 0);
      if (intendedShortQty !== qty) {
        throw new ConflictException(
          `Reservation invalidation quantity ${qty} differs from immutable short-pick intent ${intendedShortQty}`,
        );
      }
      if (!ACTIVE_SHIPMENT_STATUSES.includes(line.shipmentStatus as (typeof ACTIVE_SHIPMENT_STATUSES)[number])) {
        throw new ConflictException(
          `Cannot invalidate short-pick reservation for ${line.shipmentStatus} shipment ${line.shipmentId}`,
        );
      }
      await acquireStockAvailabilityLock(trx, line.skuId, line.warehouseId);

      const replayRows = await trx
        .select({ id: wmsTables.stockReservations.id, quantity: wmsTables.stockReservations.quantity })
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
            eq(wmsTables.stockReservations.shipmentLineId, line.id),
            eq(wmsTables.stockReservations.status, 'released'),
            eq(wmsTables.stockReservations.stateReason, stateReason),
          ),
        )
        .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id));
      if (replayRows.length > 0) {
        const replayedQty = replayRows.reduce((total, row) => total + row.quantity, 0);
        if (replayedQty !== qty) {
          throw new ConflictException(
            `Short-pick operation ${shortPickOperationId} was already used for quantity ${replayedQty}`,
          );
        }
        const current = await this.selectConfirmedReservations(line.id, trx);
        return {
          shipmentLineId,
          shortPickOperationId,
          invalidatedQty: replayedQty,
          totalReservedQty: current.reduce((total, row) => total + row.quantity, 0),
          affectedReservationIds: replayRows.map((row) => row.id),
          reservationVersion: await this.loadReservationVersion(line.shipmentId, trx),
          replayed: true,
        };
      }
      if (lockedOperationOwner.status !== 'pending') {
        throw new ConflictException(
          `A ${lockedOperationOwner.status} short-pick operation permits only exact reservation replay`,
        );
      }

      const reservations = await this.loadConfirmedReservations(line.id, trx);
      const confirmedQty = reservations.reduce((total, row) => total + row.quantity, 0);
      if (qty > confirmedQty) {
        throw new ConflictException(
          `Cannot invalidate short-pick quantity ${qty}; shipment line ${line.id} has ${confirmedQty} confirmed`,
        );
      }

      const now = new Date();
      const invalidatedReservationIds: string[] = [];
      const invalidationPlan = planOldestReservationInvalidation(reservations, qty);
      for (const planned of invalidationPlan) {
        const reservation = reservations.find((candidate) => candidate.id === planned.id)!;
        const invalidated = planned.invalidatedQty;
        if (invalidated === reservation.quantity) {
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released', stateReason, invalidatedAt: now, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          invalidatedReservationIds.push(reservation.id);
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: reservation.quantity - invalidated, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          const [split] = await trx
            .insert(wmsTables.stockReservations)
            .values({
              targetType: 'SHIPMENT_LINE',
              targetId: line.id,
              shipmentLineId: line.id,
              skuId: line.skuId,
              warehouseId: line.warehouseId,
              quantity: invalidated,
              status: 'released',
              timeoutAt: reservation.timeoutAt,
              reason: reservation.reason,
              requestedAt: reservation.requestedAt ?? reservation.createdAt,
              stateReason,
              invalidatedAt: now,
            })
            .returning({ id: wmsTables.stockReservations.id });
          invalidatedReservationIds.push(split.id);
        }
      }

      await this.unifiedReservation.recalculateSellableForSku(line.skuId, trx);
      await this.bumpReservationVersions([line.shipmentId], trx);
      await this.recompute(line.shipmentId, trx);
      return {
        shipmentLineId,
        shortPickOperationId,
        invalidatedQty: qty,
        totalReservedQty: confirmedQty - qty,
        affectedReservationIds: invalidatedReservationIds,
        reservationVersion: await this.loadReservationVersion(line.shipmentId, trx),
        replayed: false,
      };
    }, tx);
  }

  async transfer(
    sourceLineId: string,
    targetLineId: string,
    qty: number,
    tx?: DbTx,
  ): Promise<{
    sourceLineId: string;
    targetLineId: string;
    transferredQty: number;
    affectedReservationIds: string[];
    sourceReservationVersion: number;
    targetReservationVersion: number;
  }> {
    assertPositiveInteger('qty', qty);
    if (sourceLineId === targetLineId) throw new BadRequestException('Source and target shipment lines must differ');

    return this.db.run(async (trx) => {
      const initialSource = await this.loadLineContext(sourceLineId, trx);
      const initialTarget = await this.loadLineContext(targetLineId, trx);
      if (initialSource.skuId !== initialTarget.skuId || initialSource.warehouseId !== initialTarget.warehouseId) {
        throw new ConflictException('Reservation transfer requires the same SKU and warehouse');
      }

      await this.lockConnectedComponents([initialSource, initialTarget], trx);

      const source = await this.loadLineContext(sourceLineId, trx);
      const target = await this.loadLineContext(targetLineId, trx);
      this.assertStableContext(initialSource, source);
      this.assertStableContext(initialTarget, target);
      this.assertDraft(source, 'transfer from');
      this.assertDraft(target, 'transfer to');
      await acquireStockAvailabilityLocks(trx, [
        { skuId: source.skuId, warehouseId: source.warehouseId },
        { skuId: target.skuId, warehouseId: target.warehouseId },
      ]);

      await this.lockConfirmedReservations([source.id, target.id], trx);
      const sourceReservations = await this.selectConfirmedReservations(source.id, trx);
      const targetReservations = await this.selectConfirmedReservations(target.id, trx);
      const sourceConfirmed = sourceReservations.reduce((total, row) => total + row.quantity, 0);
      const targetConfirmed = targetReservations.reduce((total, row) => total + row.quantity, 0);
      if (qty > sourceConfirmed) {
        throw new ConflictException(`Cannot transfer ${qty}; source line has ${sourceConfirmed} confirmed`);
      }
      if (qty > target.qty - targetConfirmed) {
        throw new ConflictException(`Cannot transfer ${qty}; target line has ${target.qty - targetConfirmed} capacity`);
      }

      let remaining = qty;
      const now = new Date();
      const affectedReservationIds: string[] = [];
      for (const reservation of sourceReservations) {
        if (remaining === 0) break;
        const moved = Math.min(remaining, reservation.quantity);
        if (moved === reservation.quantity) {
          await trx
            .update(wmsTables.stockReservations)
            .set({ targetId: target.id, shipmentLineId: target.id, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          affectedReservationIds.push(reservation.id);
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: reservation.quantity - moved, updatedAt: now })
            .where(eq(wmsTables.stockReservations.id, reservation.id));
          const [split] = await trx
            .insert(wmsTables.stockReservations)
            .values({
              targetType: 'SHIPMENT_LINE',
              targetId: target.id,
              shipmentLineId: target.id,
              skuId: target.skuId,
              warehouseId: target.warehouseId,
              quantity: moved,
              status: 'confirmed',
              timeoutAt: reservation.timeoutAt,
              reason: reservation.reason,
              requestedAt: reservation.requestedAt ?? reservation.createdAt,
            })
            .returning({ id: wmsTables.stockReservations.id });
          affectedReservationIds.push(reservation.id, split.id);
        }
        remaining -= moved;
      }

      const shipmentIds = [...new Set([source.shipmentId, target.shipmentId])];
      await this.bumpReservationVersions(shipmentIds, trx);
      for (const shipmentId of shipmentIds.sort()) await this.recompute(shipmentId, trx);
      return {
        sourceLineId,
        targetLineId,
        transferredQty: qty,
        affectedReservationIds: [...new Set(affectedReservationIds)],
        sourceReservationVersion: await this.loadReservationVersion(source.shipmentId, trx),
        targetReservationVersion: await this.loadReservationVersion(target.shipmentId, trx),
      };
    }, tx);
  }

  /**
   * Terminally consumes the exact shipment-line claims used by a dispatch.
   *
   * The dispatch owner must already hold the canonical shipment graph and
   * stock-availability locks. Sellable publication and fulfillment projection
   * are deliberately deferred until `finalizeDispatchConsumption`, after the
   * SHIP ledger events and progress writes have completed in the same tx.
   */
  async consumeForDispatch(
    shipmentId: string,
    attemptId: string,
    expectedLines: readonly DispatchReservationLine[],
    tx: DbTx,
  ): Promise<DispatchReservationConsumption> {
    if (!shipmentId || !attemptId) throw new BadRequestException('shipmentId and attemptId are required');
    if (expectedLines.length === 0) throw new BadRequestException('Dispatch reservation lines are required');

    const quantities = new Map<string, number>();
    for (const line of expectedLines) {
      assertPositiveInteger('dispatch quantity', line.quantity);
      if (quantities.has(line.shipmentLineId)) {
        throw new BadRequestException(`Duplicate dispatch reservation line ${line.shipmentLineId}`);
      }
      quantities.set(line.shipmentLineId, line.quantity);
    }

    const lineIds = [...quantities.keys()].sort();
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        warehouseId: wmsTables.shipments.warehouseId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(inArray(wmsTables.shipmentLines.id, lineIds))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lines.length !== lineIds.length || lines.some((line) => line.shipmentId !== shipmentId)) {
      throw new ConflictException(`Dispatch reservation lines do not exactly belong to shipment ${shipmentId}`);
    }

    await this.lockConfirmedReservations(lineIds, tx);
    const reservations = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
          eq(wmsTables.stockReservations.status, 'confirmed'),
          isNull(wmsTables.stockReservations.invalidatedAt),
        ),
      )
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id));

    const reservationsByLine = new Map<string, ConfirmedReservation[]>();
    for (const reservation of reservations) {
      if (!reservation.shipmentLineId) continue;
      const bucket = reservationsByLine.get(reservation.shipmentLineId) ?? [];
      bucket.push(reservation);
      reservationsByLine.set(reservation.shipmentLineId, bucket);
    }

    for (const line of lines) {
      const expected = quantities.get(line.id)!;
      if (expected !== line.qty) {
        throw new ConflictException(
          `Dispatch must consume the full shipment line ${line.id}: expected ${line.qty}, received ${expected}`,
        );
      }
      const confirmed = (reservationsByLine.get(line.id) ?? []).reduce((total, row) => total + row.quantity, 0);
      if (confirmed !== expected) {
        throw new ConflictException(
          `Shipment line ${line.id} requires exactly ${expected} confirmed reservations; found ${confirmed}`,
        );
      }
      for (const reservation of reservationsByLine.get(line.id) ?? []) {
        if (
          reservation.targetId !== line.id ||
          reservation.skuId !== line.skuId ||
          reservation.warehouseId !== line.warehouseId
        ) {
          throw new ConflictException(
            `Reservation ${reservation.id} ownership does not match shipment line ${line.id}`,
          );
        }
      }
    }

    const now = new Date();
    const reservationIds = reservations.map((row) => row.id);
    if (reservationIds.length > 0) {
      await tx
        .update(wmsTables.stockReservations)
        .set({
          status: 'released',
          stateReason: `shipment-dispatch:${attemptId}`,
          invalidatedAt: now,
          updatedAt: now,
        })
        .where(inArray(wmsTables.stockReservations.id, reservationIds));
    }
    await tx
      .update(wmsTables.shipmentLines)
      .set({ reservedQty: 0, lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1` })
      .where(inArray(wmsTables.shipmentLines.id, lineIds));
    await this.bumpReservationVersions([shipmentId], tx);

    return {
      shipmentId,
      attemptId,
      consumedQuantity: expectedLines.reduce((total, line) => total + line.quantity, 0),
      affectedReservationIds: reservationIds,
      affectedSkuIds: [...new Set(lines.map((line) => line.skuId))].sort(),
    };
  }

  /** Publish one final sellable state per SKU, then refresh progress/invariants. */
  async finalizeDispatchConsumption(shipmentId: string, affectedSkuIds: readonly string[], tx: DbTx): Promise<void> {
    for (const skuId of [...new Set(affectedSkuIds)].sort()) {
      await this.unifiedReservation.recalculateSellableForSku(skuId, tx);
    }
    await this.recompute(shipmentId, tx);
  }

  /**
   * Recreate the exact claims consumed by one dispatch attempt after its stock
   * has economically returned. The consumed rows remain immutable attempt-1
   * evidence; newly inserted rows become the claims for a later redispatch.
   * The caller owns the shipment graph and stock-availability locks.
   */
  async restoreForRecall(
    shipmentId: string,
    dispatchAttemptId: string,
    recallOperationId: string,
    tx: DbTx,
  ): Promise<RecallReservationRestoration> {
    if (!shipmentId || !dispatchAttemptId || !recallOperationId) {
      throw new BadRequestException('shipmentId, dispatchAttemptId and recallOperationId are required');
    }
    const consumedReason = `shipment-dispatch:${dispatchAttemptId}`;
    const restoredReason = `shipment-recall:${recallOperationId}`;
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        warehouseId: wmsTables.shipments.warehouseId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    const lineIds = lines.map((line) => line.id);
    await this.lockConfirmedReservations(lineIds, tx);
    await tx
      .select({ id: wmsTables.stockReservations.id })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.status, 'released'),
          eq(wmsTables.stockReservations.stateReason, consumedReason),
        ),
      )
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
      .for('update');

    const replay = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.status, 'confirmed'),
          eq(wmsTables.stockReservations.stateReason, restoredReason),
        ),
      )
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
      .for('update');
    if (replay.length > 0) {
      assertExactRecallReservationEvidence(`Recall operation ${recallOperationId} replay`, lines, replay);
      return {
        shipmentId,
        dispatchAttemptId,
        recallOperationId,
        restoredQuantity: replay.reduce((sum, row) => sum + row.quantity, 0),
        reservationIds: replay.map((row) => row.id),
        affectedSkuIds: [...new Set(replay.map((row) => row.skuId))].sort(),
        reservationVersion: await this.loadReservationVersion(shipmentId, tx),
        replayed: true,
      };
    }

    const consumed = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.status, 'released'),
          eq(wmsTables.stockReservations.stateReason, consumedReason),
        ),
      )
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id));
    assertExactRecallReservationEvidence(`Dispatch attempt ${dispatchAttemptId}`, lines, consumed);

    const inserted = await tx
      .insert(wmsTables.stockReservations)
      .values(
        consumed.map((row) => ({
          targetType: 'SHIPMENT_LINE',
          targetId: row.shipmentLineId!,
          shipmentLineId: row.shipmentLineId!,
          skuId: row.skuId,
          warehouseId: row.warehouseId,
          quantity: row.quantity,
          status: 'confirmed' as const,
          timeoutAt: row.timeoutAt,
          reason: `Shipment dispatch recall ${recallOperationId}`,
          requestedAt: row.requestedAt ?? row.createdAt,
          stateReason: restoredReason,
        })),
      )
      .returning({ id: wmsTables.stockReservations.id, skuId: wmsTables.stockReservations.skuId });
    await tx
      .update(wmsTables.shipmentLines)
      .set({
        reservedQty: sql`${wmsTables.shipmentLines.qty}`,
        lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1`,
      })
      .where(inArray(wmsTables.shipmentLines.id, lineIds));
    await this.bumpReservationVersions([shipmentId], tx);
    return {
      shipmentId,
      dispatchAttemptId,
      recallOperationId,
      restoredQuantity: consumed.reduce((sum, row) => sum + row.quantity, 0),
      reservationIds: inserted.map((row) => row.id),
      affectedSkuIds: [...new Set(inserted.map((row) => row.skuId))].sort(),
      reservationVersion: await this.loadReservationVersion(shipmentId, tx),
      replayed: false,
    };
  }

  /** Final publication after stock reversal, reservation restoration and FO reopen. */
  async finalizeRecallRestoration(shipmentId: string, affectedSkuIds: readonly string[], tx: DbTx): Promise<void> {
    for (const skuId of [...new Set(affectedSkuIds)].sort()) {
      await this.unifiedReservation.recalculateSellableForSku(skuId, tx);
    }
    await this.recompute(shipmentId, tx);
  }

  /** Refresh V2 read models and run the locked-row invariant before commit. */
  async recompute(shipmentId: string, tx: DbTx): Promise<void> {
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);

    const lineIds = lines.map((line) => line.id);
    const confirmed = await tx
      .select({
        shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        quantity: wmsTables.stockReservations.quantity,
      })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    const reservedByLine = new Map<string, number>();
    for (const row of confirmed) {
      if (!row.shipmentLineId) continue;
      reservedByLine.set(row.shipmentLineId, (reservedByLine.get(row.shipmentLineId) ?? 0) + row.quantity);
    }
    for (const line of lines) {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ reservedQty: reservedByLine.get(line.id) ?? 0 })
        .where(eq(wmsTables.shipmentLines.id, line.id));
    }

    const itemRows = await tx
      .select({
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        inArray(
          wmsTables.fulfillmentOrderItems.id,
          lines.map((line) => line.fulfillmentOrderItemId),
        ),
      );
    const fulfillmentOrderIds = [...new Set(itemRows.map((row) => row.fulfillmentOrderId))].sort();
    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      await this.recomputeFulfillmentOrder(fulfillmentOrderId, tx);
    }
    await tx.update(wmsTables.shipments).set({ lastUpdated: new Date() }).where(eq(wmsTables.shipments.id, shipmentId));
    await this.invariant.assertFulfillmentOrders(fulfillmentOrderIds, tx);
  }

  private async recomputeFulfillmentOrder(fulfillmentOrderId: string, tx: DbTx): Promise<void> {
    const items = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId))
      .orderBy(asc(wmsTables.fulfillmentOrderItems.id));
    const inputs: FulfillmentOrderItemProgressInput[] = [];

    for (const item of items) {
      const activeLines = await tx
        .select({
          id: wmsTables.shipmentLines.id,
          qty: wmsTables.shipmentLines.qty,
          inspectedQty: wmsTables.shipmentLines.inspectedQty,
          shipmentStatus: wmsTables.shipments.status,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
        .where(
          and(
            eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id),
            inArray(wmsTables.shipments.status, [...ACTIVE_SHIPMENT_STATUSES]),
          ),
        );
      const activeLineIds = activeLines.map((line) => line.id);
      const reservations =
        activeLineIds.length === 0
          ? []
          : await tx
              .select({ quantity: wmsTables.stockReservations.quantity })
              .from(wmsTables.stockReservations)
              .where(
                and(
                  inArray(wmsTables.stockReservations.shipmentLineId, activeLineIds),
                  eq(wmsTables.stockReservations.status, 'confirmed'),
                ),
              );
      const confirmedReservedQty = reservations.reduce((total, row) => total + row.quantity, 0);
      const input: FulfillmentOrderItemProgressInput = {
        id: item.id,
        qty: item.qty,
        shippedQty: item.shippedQty,
        canceledQty: item.canceledQty,
        confirmedReservedQty,
        activeLineQty: activeLines.reduce((total, line) => total + line.qty, 0),
        processing: item.pickedQty > 0 || activeLines.some((line) => line.inspectedQty > 0),
        recoveryRequired: activeLines.some((line) => line.shipmentStatus === 'recovery_required'),
      };
      const projected = this.progress.projectItem(input);
      inputs.push(input);
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: confirmedReservedQty, status: projected.status, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
    }

    const projected = this.progress.projectOrder(inputs);
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({
        status: projected.status,
        totalReservedQty: projected.confirmedReservedQty,
        reservationFailureReason: null,
        reservationFailureDetails: null,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  }

  private async loadLineContext(shipmentLineId: string, tx: DbTx): Promise<LineContext> {
    const [row] = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        createdAt: wmsTables.shipmentLines.createdAt,
        warehouseId: wmsTables.shipments.warehouseId,
        shipmentStatus: wmsTables.shipments.status,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(eq(wmsTables.shipmentLines.id, shipmentLineId))
      .limit(1);
    if (!row) throw new NotFoundException(`Shipment line ${shipmentLineId} not found`);
    return row;
  }

  private async loadConfirmedReservations(shipmentLineId: string, tx: DbTx): Promise<ConfirmedReservation[]> {
    await this.lockConfirmedReservations([shipmentLineId], tx);
    return this.selectConfirmedReservations(shipmentLineId, tx);
  }

  private async loadShortPickOperationOwner(
    operationId: string,
    shipmentId: string,
    tx: DbTx,
  ): Promise<ShortPickOperationOwner | undefined> {
    const [operation] = await tx
      .select({
        type: wmsTables.shipmentOperations.type,
        status: wmsTables.shipmentOperations.status,
        snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1)
      .for('update');
    if (!operation) return undefined;
    const [member] = await tx
      .select({
        memberOperationId: wmsTables.shipmentOperationMembers.operationId,
        shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
      })
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1)
      .for('update');
    return member ? { ...operation, ...member, intent: shortPickOperationIntentOf(operation.snapshot) } : undefined;
  }

  private assertValidShortPickOperationOwner(
    owner: ShortPickOperationOwner | undefined,
    operationId: string,
    shipmentId: string,
  ): asserts owner is ShortPickOperationOwner & { intent: ShortPickOperationIntentProof } {
    if (
      !owner ||
      owner.memberOperationId !== operationId ||
      owner.shipmentId !== shipmentId ||
      owner.type !== 'short_pick' ||
      !['pending', 'recovery_required', 'completed'].includes(owner.status) ||
      !owner.intent ||
      owner.intent.operationId !== operationId ||
      owner.intent.shipmentId !== shipmentId
    ) {
      throw new ConflictException(
        `Reservation invalidation requires an exact short-pick operation intent owning shipment ${shipmentId}`,
      );
    }
  }

  private async lockConfirmedReservations(shipmentLineIds: readonly string[], tx: DbTx): Promise<void> {
    await lockConfirmedShipmentReservations(shipmentLineIds, tx);
  }

  private async selectConfirmedReservations(shipmentLineId: string, tx: DbTx): Promise<ConfirmedReservation[]> {
    return tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          eq(wmsTables.stockReservations.shipmentLineId, shipmentLineId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      )
      .orderBy(
        asc(sql`COALESCE(${wmsTables.stockReservations.requestedAt}, ${wmsTables.stockReservations.createdAt})`),
        asc(wmsTables.stockReservations.id),
      );
  }

  private async lockConnectedComponents(contexts: readonly LineContext[], tx: DbTx): Promise<void> {
    await lockShipmentConnectedComponentGraph(
      tx,
      contexts.map((row) => row.fulfillmentOrderItemId),
    );
  }

  private assertStableContext(before: LineContext, after: LineContext): void {
    if (
      before.shipmentId !== after.shipmentId ||
      before.fulfillmentOrderItemId !== after.fulfillmentOrderItemId ||
      before.skuId !== after.skuId ||
      before.warehouseId !== after.warehouseId
    ) {
      throw new ConflictException('Shipment line changed while acquiring reservation locks; retry the command');
    }
  }

  private assertDraft(line: LineContext, operation: string): void {
    if (line.shipmentStatus !== 'draft') {
      throw new ConflictException(
        `Cannot ${operation} reservation for ${line.shipmentStatus} shipment ${line.shipmentId}`,
      );
    }
  }

  private async bumpReservationVersions(shipmentIds: readonly string[], tx: DbTx): Promise<void> {
    for (const shipmentId of [...new Set(shipmentIds)].sort()) {
      await tx
        .update(wmsTables.shipments)
        .set({
          reservationVersion: sql`${wmsTables.shipments.reservationVersion} + 1`,
          lastUpdated: new Date(),
        })
        .where(eq(wmsTables.shipments.id, shipmentId));
    }
  }

  private async loadReservationVersion(shipmentId: string, tx: DbTx): Promise<number> {
    const [shipment] = await tx
      .select({ reservationVersion: wmsTables.shipments.reservationVersion })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    return shipment.reservationVersion;
  }
}
