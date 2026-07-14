import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { AuthorizationService } from '@app/authorization';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  CancelShipmentOutstandingDto,
  PlanShipmentDto,
  ReviseShipmentRecipientDto,
  ShipmentPlanningActor,
  ShipmentDetailResponseDto,
  SplitShipmentDto,
} from '../dto/shipment-planning.dto';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const ACTIVE_INVOICE_STATUSES = ['issued', 'used', 'issuing', 'voiding', 'recovery_required'] as const;
const ACTIVE_WORK_ITEM_STATUSES = ['queued', 'picking', 'ready_to_pack', 'packing', 'short_pick_recovery'] as const;
const TRUSTED_CHANNELS = new Set(['medusa', 'naver', 'coupang']);

type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect & {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  fulfillmentMode: string | null;
};

type ShipmentAggregate = {
  shipment: ShipmentRow;
  lines: ShipmentLineRow[];
  fulfillmentOrderIds: string[];
};

type ShipmentManifestSnapshot = {
  shipmentId: string;
  status: string;
  warehouseId: string;
  shippingProfileId: string | null;
  recipientSnapshot: unknown;
  manifestVersion: number;
  reservationVersion: number;
  lines: Array<{
    id: string;
    fulfillmentOrderItemId: string;
    skuId: string;
    qty: number;
    reservedQty: number;
    inspectedQty: number;
    lineVersion: number;
  }>;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${name} must be a positive safe integer`);
  }
}

export function confirmedReservationReleaseForCancellation(
  lineQty: number,
  confirmedQty: number,
  cancelQty: number,
): number {
  return Math.max(0, cancelQty - (lineQty - confirmedQty));
}

@Injectable()
export class ShipmentPlanningService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly reservations: ShipmentReservationService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  async split(
    shipmentId: string,
    dto: SplitShipmentDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.split');
    this.assertReason(dto.reason);
    const moves = [...dto.moves].sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId));
    this.assertNoDuplicateIds(
      moves.map((move) => move.shipmentLineId),
      'split line',
    );

    return this.commands.execute(
      {
        commandType: 'shipment.split',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto, moves },
      },
      async (tx, _commandRequestId, requestHash) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertShipmentVersion(aggregate.shipment, dto.expectedManifestVersion);
        if (aggregate.shipment.status !== 'draft') {
          throw this.conflict('SHIPMENT_NOT_DRAFT', `Shipment ${shipmentId} must be Draft to split`);
        }
        await this.assertNoCustodyOrActiveWork(aggregate, tx);
        await this.assertNoActiveInvoice(shipmentId, tx);

        const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
        const selected = moves.map((move) => {
          const line = lineById.get(move.shipmentLineId);
          if (!line) throw new BadRequestException(`Shipment line ${move.shipmentLineId} is not in ${shipmentId}`);
          if (line.lineVersion !== move.expectedLineVersion) {
            throw this.conflict('SHIPMENT_LINE_STALE_VERSION', `Shipment line ${line.id} has changed`);
          }
          if (move.qty > line.qty)
            throw new BadRequestException(`Cannot move ${move.qty}; line ${line.id} has ${line.qty}`);
          return { move, line };
        });
        const totalSourceQty = aggregate.lines.reduce((total, line) => total + line.qty, 0);
        const totalMoveQty = selected.reduce((total, entry) => total + entry.move.qty, 0);
        if (totalMoveQty >= totalSourceQty) {
          throw new BadRequestException('A split must leave positive quantity in the source shipment');
        }

        const confirmedByLine = await this.confirmedReservationQtyByLine(
          selected.map((entry) => entry.line.id),
          tx,
        );
        const reservationTargets = new Map<string, number>();
        for (const { move, line } of selected) {
          const confirmed = confirmedByLine.get(line.id) ?? 0;
          const unreserved = line.qty - confirmed;
          const minimum = Math.max(0, move.qty - unreserved);
          const maximum = Math.min(move.qty, confirmed);
          const requested = move.targetReservedQty ?? minimum;
          if (requested < minimum || requested > maximum) {
            throw new BadRequestException(
              `targetReservedQty for line ${line.id} must be between ${minimum} and ${maximum}`,
            );
          }
          reservationTargets.set(line.id, requested);
        }

        const before = this.snapshot(aggregate);
        const operation = await this.createOperation(
          tx,
          'split',
          actor,
          dto.reason,
          dto.csCaseId,
          dto.note,
          idempotencyKey,
          requestHash,
          before,
        );
        const [target] = await tx
          .insert(wmsTables.shipments)
          .values({
            warehouseId: aggregate.shipment.warehouseId,
            status: 'draft',
            shippingProfileId: aggregate.shipment.shippingProfileId,
            recipientSnapshot: aggregate.shipment.recipientSnapshot,
            manifestVersion: 1,
            reservationVersion: 1,
            openedBy: actor.id,
            openedAt: new Date(),
          })
          .returning();

        let wholeLineReservationMove = false;
        for (const { move, line } of selected) {
          const targetReservedQty = reservationTargets.get(line.id) ?? 0;
          if (move.qty === line.qty) {
            await tx
              .update(wmsTables.shipmentLines)
              .set({ shipmentId: target.id, lineVersion: line.lineVersion + 1 })
              .where(eq(wmsTables.shipmentLines.id, line.id));
            wholeLineReservationMove ||= targetReservedQty > 0;
            continue;
          }

          await tx
            .update(wmsTables.shipmentLines)
            .set({ qty: line.qty - move.qty, lineVersion: line.lineVersion + 1 })
            .where(eq(wmsTables.shipmentLines.id, line.id));
          const [targetLine] = await tx
            .insert(wmsTables.shipmentLines)
            .values({
              shipmentId: target.id,
              fulfillmentOrderItemId: line.fulfillmentOrderItemId,
              skuId: line.skuId,
              qty: move.qty,
              createdFromLineId: line.id,
            })
            .returning();
          if (targetReservedQty > 0) {
            await this.reservations.transfer(line.id, targetLine.id, targetReservedQty, tx);
          }
        }

        if (wholeLineReservationMove) {
          await tx
            .update(wmsTables.shipments)
            .set({ reservationVersion: sql`${wmsTables.shipments.reservationVersion} + 1` })
            .where(inArray(wmsTables.shipments.id, [shipmentId, target.id]));
        }
        await tx
          .update(wmsTables.shipments)
          .set({ manifestVersion: aggregate.shipment.manifestVersion + 1, lastUpdated: new Date() })
          .where(eq(wmsTables.shipments.id, shipmentId));

        await this.reservations.recompute(shipmentId, tx);
        await this.reservations.recompute(target.id, tx);
        const sourceAfter = await this.loadAggregate(shipmentId, tx);
        const targetAfter = await this.loadAggregate(target.id, tx);
        const sourceSnapshot = this.snapshot(sourceAfter);
        const targetSnapshot = this.snapshot(targetAfter);
        await this.completeOperation(tx, operation.id, [
          { shipmentId, role: 'source', before, after: sourceSnapshot },
          { shipmentId: target.id, role: 'target', before: null, after: targetSnapshot },
        ]);
        await this.auditCommand(tx, actor, 'shipment.split', operation.id, dto.reason, {
          sourceShipmentId: shipmentId,
          targetShipmentId: target.id,
          before,
          after: { source: sourceSnapshot, target: targetSnapshot },
        });

        const response = { operationId: operation.id, source: sourceSnapshot, target: targetSnapshot };
        return { response, resourceType: 'shipment', resourceId: target.id, operationId: operation.id };
      },
      tx,
    );
  }

  async reviseRecipient(
    shipmentId: string,
    dto: ReviseShipmentRecipientDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.revise_recipient');
    this.assertReason(dto.reason);
    return this.commands.execute(
      {
        commandType: 'shipment.recipient_revision',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (tx, _commandRequestId, requestHash) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertShipmentVersion(aggregate.shipment, dto.expectedManifestVersion);
        if (aggregate.shipment.status !== 'draft') {
          throw this.conflict('SHIPMENT_REOPEN_REQUIRED', 'Recipient can only be revised on a Draft shipment');
        }
        await this.assertNoCustodyOrActiveWork(aggregate, tx);
        await this.assertNoActiveInvoice(shipmentId, tx);

        if (this.sameJson(aggregate.shipment.recipientSnapshot, dto.recipientSnapshot)) {
          throw new BadRequestException('Recipient snapshot is unchanged');
        }
        const orderRecipients = await this.loadOrderRecipientSnapshots(aggregate, tx);
        const overridesOrder = orderRecipients.some((recipient) => !this.sameJson(recipient, dto.recipientSnapshot));
        if (overridesOrder) await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT);

        const before = this.snapshot(aggregate);
        const operation = await this.createOperation(
          tx,
          'recipient_revision',
          actor,
          dto.reason,
          dto.csCaseId,
          dto.note,
          idempotencyKey,
          requestHash,
          before,
        );
        await tx
          .update(wmsTables.shipments)
          .set({
            recipientSnapshot: dto.recipientSnapshot,
            manifestVersion: aggregate.shipment.manifestVersion + 1,
            lastUpdated: new Date(),
          })
          .where(eq(wmsTables.shipments.id, shipmentId));
        await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
        const after = this.snapshot(await this.loadAggregate(shipmentId, tx));
        await this.completeOperation(tx, operation.id, [{ shipmentId, role: 'target', before, after }]);
        await this.auditCommand(tx, actor, 'shipment.revise_recipient', operation.id, dto.reason, {
          shipmentId,
          overridesOrder,
          before,
          after,
        });

        const response = { operationId: operation.id, shipment: after };
        return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }

  async plan(
    shipmentId: string,
    dto: PlanShipmentDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.plan');
    return this.commands.execute(
      {
        commandType: 'shipment.plan',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (tx, _commandRequestId, requestHash) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertShipmentVersion(aggregate.shipment, dto.expectedManifestVersion, dto.expectedReservationVersion);
        if (aggregate.shipment.status !== 'draft') {
          throw this.conflict('SHIPMENT_NOT_DRAFT', `Shipment ${shipmentId} must be Draft to plan`);
        }
        await this.assertNoCustodyOrActiveWork(aggregate, tx);
        await this.assertNoActiveInvoice(shipmentId, tx);
        await this.assertNoActivePickingPlan(shipmentId, tx);
        this.assertRecipientComplete(aggregate.shipment.recipientSnapshot);
        await this.assertPlanProfile(aggregate, dto.shippingProfileId, tx);
        await this.assertFullyReserved(aggregate, tx);
        await this.assertTrustedExternalLineIdentity(aggregate, tx);

        const before = this.snapshot(aggregate);
        const operation = await this.createOperation(
          tx,
          'plan',
          actor,
          'Shipment planned',
          undefined,
          undefined,
          idempotencyKey,
          requestHash,
          before,
        );
        const profileChanged = aggregate.shipment.shippingProfileId !== dto.shippingProfileId;
        await tx
          .update(wmsTables.shipments)
          .set({
            status: 'planned',
            plannedAt: new Date(),
            shippingProfileId: dto.shippingProfileId,
            manifestVersion: profileChanged
              ? aggregate.shipment.manifestVersion + 1
              : aggregate.shipment.manifestVersion,
            lastUpdated: new Date(),
          })
          .where(eq(wmsTables.shipments.id, shipmentId));
        await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
        const after = this.snapshot(await this.loadAggregate(shipmentId, tx));
        await this.completeOperation(tx, operation.id, [{ shipmentId, role: 'target', before, after }]);
        await this.auditCommand(tx, actor, 'shipment.plan', operation.id, 'Shipment planned', {
          shipmentId,
          before,
          after,
        });
        const response = { operationId: operation.id, shipment: after };
        return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }

  async cancelOutstanding(
    shipmentId: string,
    dto: CancelShipmentOutstandingDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.cancel_outstanding');
    this.assertReason(dto.reason);
    const requestedLines = [...dto.lines].sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId));
    this.assertNoDuplicateIds(
      requestedLines.map((line) => line.shipmentLineId),
      'cancellation line',
    );

    type CancelResponse = {
      operationId: string;
      operationStatus: 'pending' | 'completed';
      shipmentId: string;
      manifestVersion: number;
      shipment?: ShipmentManifestSnapshot;
    };
    return this.commands.execute<CancelResponse>(
      {
        commandType: 'shipment.cancel_outstanding',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto, lines: requestedLines },
      },
      async (tx, _commandRequestId, requestHash) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertShipmentVersion(aggregate.shipment, dto.expectedManifestVersion);
        if (['shipped', 'in_transit', 'delivered'].includes(aggregate.shipment.status)) {
          throw this.conflict(
            'SHIPMENT_ALREADY_DISPATCHED',
            'Dispatched shipment lines are not outstanding; use recall or return',
          );
        }
        if (['canceled', 'superseded'].includes(aggregate.shipment.status)) {
          throw this.conflict('SHIPMENT_NOT_ACTIVE', `Shipment ${shipmentId} has no active outstanding demand`);
        }
        if (aggregate.shipment.status === 'recovery_required') {
          throw this.conflict('SHIPMENT_RECOVERY_IN_PROGRESS', `Shipment ${shipmentId} is already in recovery`);
        }
        const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
        const selected = requestedLines.map((request) => {
          const line = lineById.get(request.shipmentLineId);
          if (!line) throw new BadRequestException(`Shipment line ${request.shipmentLineId} is not in ${shipmentId}`);
          if (line.lineVersion !== request.expectedLineVersion) {
            throw this.conflict('SHIPMENT_LINE_STALE_VERSION', `Shipment line ${line.id} has changed`);
          }
          if (request.qty > line.qty) {
            throw new BadRequestException(`Cannot cancel ${request.qty}; line ${line.id} has ${line.qty}`);
          }
          return { request, line };
        });
        const before = this.snapshot(aggregate);
        const operation = await this.createOperation(
          tx,
          'cancel',
          actor,
          dto.reason,
          dto.csCaseId,
          dto.note,
          idempotencyKey,
          requestHash,
          before,
        );

        if (await this.requiresDurableReplan(aggregate, tx)) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
          await tx
            .update(wmsTables.shipments)
            .set({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING', lastUpdated: new Date() })
            .where(eq(wmsTables.shipments.id, shipmentId));
          await this.reservations.recompute(shipmentId, tx);
          await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
          const pendingIntent = {
            kind: 'cancel_outstanding',
            shipmentId,
            expectedManifestVersion: dto.expectedManifestVersion,
            lines: requestedLines,
            reason: dto.reason,
            csCaseId: dto.csCaseId ?? null,
            note: dto.note ?? null,
          };
          await tx
            .update(wmsTables.shipmentOperations)
            .set({ afterManifestSnapshot: { pendingIntent } })
            .where(eq(wmsTables.shipmentOperations.id, operation.id));
          await tx.insert(wmsTables.shipmentOperationMembers).values({
            operationId: operation.id,
            shipmentId,
            role: 'source',
            beforeManifestVersion: before.manifestVersion,
            beforeManifestSnapshot: before,
            afterManifestSnapshot: { pendingIntent },
          });
          await this.auditCommand(tx, actor, 'shipment.cancel_outstanding.pending_replan', operation.id, dto.reason, {
            shipmentId,
            requestedLines,
            before,
          });
          const response = {
            operationId: operation.id,
            operationStatus: 'pending' as const,
            shipmentId,
            manifestVersion: before.manifestVersion,
          };
          return { response, resourceType: 'shipment_operation', resourceId: operation.id, operationId: operation.id };
        }

        if (aggregate.shipment.status !== 'draft') {
          throw this.conflict('SHIPMENT_NOT_DRAFT', 'Only Draft outstanding can be canceled immediately');
        }
        await this.applyDraftCancellation(aggregate, selected, operation.id, dto, actor, tx);
        const after = this.snapshot(await this.loadAggregate(shipmentId, tx));
        const response = {
          operationId: operation.id,
          operationStatus: 'completed' as const,
          shipmentId,
          manifestVersion: after.manifestVersion,
          shipment: after,
        };
        return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }

  async getShipmentDetail(shipmentId: string, tx?: DbTx): Promise<ShipmentDetailResponseDto> {
    return this.dbService.run(async (trx) => {
      const aggregate = await this.loadAggregate(shipmentId, trx);
      const lineIds = aggregate.lines.map((line) => line.id);
      const [reservations, invoices, workItems, attempts, origins] = await Promise.all([
        lineIds.length
          ? trx
              .select()
              .from(wmsTables.stockReservations)
              .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds))
              .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
          : [],
        trx
          .select()
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.invoices.createdAt)),
        trx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.outboundBatchWorkItems.createdAt)),
        trx
          .select()
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.dispatchAttempts.attemptNo)),
        this.loadSalesOrderLineOrigins(aggregate.lines, trx),
      ]);
      const originByLineId = new Map(origins.map((origin) => [origin.salesOrderLineId, origin]));
      const reservationByLine = new Map<string, typeof reservations>();
      for (const reservation of reservations) {
        if (!reservation.shipmentLineId) continue;
        reservationByLine.set(reservation.shipmentLineId, [
          ...(reservationByLine.get(reservation.shipmentLineId) ?? []),
          reservation,
        ]);
      }
      return {
        ...aggregate.shipment,
        lines: aggregate.lines.map((line) => ({
          ...line,
          origin: line.salesOrderLineId ? (originByLineId.get(line.salesOrderLineId) ?? null) : null,
          reservations: reservationByLine.get(line.id) ?? [],
        })),
        invoices,
        workItems,
        dispatchAttempts: attempts,
      };
    }, tx);
  }

  private async applyDraftCancellation(
    aggregate: ShipmentAggregate,
    selected: Array<{ request: CancelShipmentOutstandingDto['lines'][number]; line: ShipmentLineRow }>,
    operationId: string,
    dto: CancelShipmentOutstandingDto,
    actor: ShipmentPlanningActor,
    tx: DbTx,
  ): Promise<void> {
    const confirmed = await this.confirmedReservationQtyByLine(
      selected.map((entry) => entry.line.id),
      tx,
    );
    for (const { request, line } of selected) {
      const confirmedQty = confirmed.get(line.id) ?? 0;
      const releaseQty = confirmedReservationReleaseForCancellation(line.qty, confirmedQty, request.qty);
      if (releaseQty > 0) await this.reservations.releasePartial(line.id, releaseQty, dto.reason, tx);
    }

    const totalShipmentQty = aggregate.lines.reduce((total, line) => total + line.qty, 0);
    const totalCanceledQty = selected.reduce((total, entry) => total + entry.request.qty, 0);
    const cancelWholeShipment = totalShipmentQty === totalCanceledQty;
    let tombstone: ShipmentRow | undefined;
    if (!cancelWholeShipment && selected.some(({ request, line }) => request.qty === line.qty)) {
      [tombstone] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId: aggregate.shipment.warehouseId,
          status: 'canceled',
          shippingProfileId: aggregate.shipment.shippingProfileId,
          recipientSnapshot: aggregate.shipment.recipientSnapshot,
          manifestVersion: 1,
          reservationVersion: 1,
          openedBy: actor.id,
          openedAt: new Date(),
        })
        .returning();
    }

    const canceledByFoi = new Map<string, number>();
    for (const { request, line } of selected) {
      canceledByFoi.set(
        line.fulfillmentOrderItemId,
        (canceledByFoi.get(line.fulfillmentOrderItemId) ?? 0) + request.qty,
      );
      if (cancelWholeShipment) continue;
      if (request.qty === line.qty) {
        await tx
          .update(wmsTables.shipmentLines)
          .set({ shipmentId: tombstone!.id, lineVersion: line.lineVersion + 1 })
          .where(eq(wmsTables.shipmentLines.id, line.id));
      } else {
        await tx
          .update(wmsTables.shipmentLines)
          .set({ qty: line.qty - request.qty, lineVersion: line.lineVersion + 1 })
          .where(eq(wmsTables.shipmentLines.id, line.id));
      }
    }
    for (const [fulfillmentOrderItemId, canceledQty] of canceledByFoi) {
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({
          canceledQty: sql`${wmsTables.fulfillmentOrderItems.canceledQty} + ${canceledQty}`,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrderItems.id, fulfillmentOrderItemId));
    }
    await tx
      .update(wmsTables.shipments)
      .set({
        status: cancelWholeShipment ? 'canceled' : 'draft',
        manifestVersion: aggregate.shipment.manifestVersion + 1,
        lastUpdated: new Date(),
      })
      .where(eq(wmsTables.shipments.id, aggregate.shipment.id));

    await this.reservations.recompute(aggregate.shipment.id, tx);
    if (tombstone) await this.reservations.recompute(tombstone.id, tx);
    const sourceAfter = this.snapshot(await this.loadAggregate(aggregate.shipment.id, tx));
    const members: Array<{
      shipmentId: string;
      role: 'source' | 'target';
      before: ShipmentManifestSnapshot | null;
      after: ShipmentManifestSnapshot;
    }> = [{ shipmentId: aggregate.shipment.id, role: 'source', before: this.snapshot(aggregate), after: sourceAfter }];
    if (tombstone) {
      members.push({
        shipmentId: tombstone.id,
        role: 'target',
        before: null,
        after: this.snapshot(await this.loadAggregate(tombstone.id, tx)),
      });
    }
    await this.completeOperation(tx, operationId, members);
    await this.auditCommand(tx, actor, 'shipment.cancel_outstanding', operationId, dto.reason, {
      shipmentId: aggregate.shipment.id,
      canceledLines: selected.map(({ request }) => request),
      before: this.snapshot(aggregate),
      after: members.map((member) => member.after),
    });
  }

  private async lockAggregate(shipmentId: string, tx: DbTx): Promise<ShipmentAggregate> {
    const optimistic = await this.loadAggregate(shipmentId, tx);
    await this.invariant.assertFulfillmentOrders(optimistic.fulfillmentOrderIds, tx);
    const locked = await this.loadAggregate(shipmentId, tx);
    if (
      optimistic.lines.map((line) => `${line.id}:${line.shipmentId}`).join(',') !==
      locked.lines.map((line) => `${line.id}:${line.shipmentId}`).join(',')
    ) {
      throw this.conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', 'Shipment component changed while acquiring locks');
    }
    return locked;
  }

  private async loadAggregate(shipmentId: string, tx: DbTx): Promise<ShipmentAggregate> {
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        reservedQty: wmsTables.shipmentLines.reservedQty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
        lineVersion: wmsTables.shipmentLines.lineVersion,
        createdFromLineId: wmsTables.shipmentLines.createdFromLineId,
        forced: wmsTables.shipmentLines.forced,
        createdAt: wmsTables.shipmentLines.createdAt,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
        fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    return { shipment, lines, fulfillmentOrderIds: uniqueSorted(lines.map((line) => line.fulfillmentOrderId)) };
  }

  private snapshot(aggregate: ShipmentAggregate): ShipmentManifestSnapshot {
    return {
      shipmentId: aggregate.shipment.id,
      status: aggregate.shipment.status,
      warehouseId: aggregate.shipment.warehouseId,
      shippingProfileId: aggregate.shipment.shippingProfileId,
      recipientSnapshot: aggregate.shipment.recipientSnapshot,
      manifestVersion: aggregate.shipment.manifestVersion,
      reservationVersion: aggregate.shipment.reservationVersion,
      lines: aggregate.lines.map((line) => ({
        id: line.id,
        fulfillmentOrderItemId: line.fulfillmentOrderItemId,
        skuId: line.skuId,
        qty: line.qty,
        reservedQty: line.reservedQty,
        inspectedQty: line.inspectedQty,
        lineVersion: line.lineVersion,
      })),
    };
  }

  private async createOperation(
    tx: DbTx,
    type: (typeof wmsTables.shipmentOperations.type.enumValues)[number],
    actor: ShipmentPlanningActor,
    reason: string,
    csCaseId: string | undefined,
    note: string | undefined,
    idempotencyKey: string,
    requestHash: string,
    before: ShipmentManifestSnapshot,
  ) {
    const [operation] = await tx
      .insert(wmsTables.shipmentOperations)
      .values({
        type,
        status: 'pending',
        operatorId: actor.id,
        reason,
        csCaseId: csCaseId ?? null,
        note: note ?? null,
        idempotencyKey,
        requestHash,
        beforeManifestSnapshot: before,
      })
      .returning();
    return operation;
  }

  private async completeOperation(
    tx: DbTx,
    operationId: string,
    members: Array<{
      shipmentId: string;
      role: 'source' | 'target';
      before: ShipmentManifestSnapshot | null;
      after: ShipmentManifestSnapshot;
    }>,
  ): Promise<void> {
    await tx.insert(wmsTables.shipmentOperationMembers).values(
      members.map((member) => ({
        operationId,
        shipmentId: member.shipmentId,
        role: member.role,
        beforeManifestVersion: member.before?.manifestVersion ?? null,
        afterManifestVersion: member.after.manifestVersion,
        beforeManifestSnapshot: member.before,
        afterManifestSnapshot: member.after,
      })),
    );
    await tx
      .update(wmsTables.shipmentOperations)
      .set({
        status: 'completed',
        afterManifestSnapshot: members.map((member) => member.after),
        completedAt: new Date(),
      })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
  }

  private async auditCommand(
    tx: DbTx,
    actor: ShipmentPlanningActor,
    action: string,
    operationId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.logUserActionRequired(
      action,
      'fulfillment',
      `${action} operation ${operationId}`,
      { userId: actor.id },
      { operationId, reason, ...metadata },
      tx,
    );
  }

  private async confirmedReservationQtyByLine(lineIds: string[], tx: DbTx): Promise<Map<string, number>> {
    if (lineIds.length === 0) return new Map();
    const rows = await tx
      .select({ shipmentLineId: wmsTables.stockReservations.shipmentLineId, qty: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    const result = new Map<string, number>();
    for (const row of rows) {
      if (row.shipmentLineId) result.set(row.shipmentLineId, (result.get(row.shipmentLineId) ?? 0) + row.qty);
    }
    return result;
  }

  private async assertNoActiveInvoice(shipmentId: string, tx: DbTx): Promise<void> {
    const [invoice] = await tx
      .select({ id: wmsTables.invoices.id, status: wmsTables.invoices.status })
      .from(wmsTables.invoices)
      .where(
        and(
          eq(wmsTables.invoices.shipmentId, shipmentId),
          inArray(wmsTables.invoices.status, [...ACTIVE_INVOICE_STATUSES]),
        ),
      )
      .limit(1);
    if (invoice) throw this.conflict('SHIPMENT_ACTIVE_INVOICE', `Void active invoice ${invoice.id} before editing`);
  }

  private async assertNoCustodyOrActiveWork(aggregate: ShipmentAggregate, tx: DbTx): Promise<void> {
    if (aggregate.lines.some((line) => line.inspectedQty > 0)) {
      throw this.conflict('SHIPMENT_CUSTODY_EXISTS', 'Explicit unpick is required before editing inspected quantity');
    }
    const [workItem] = await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1);
    if (workItem) throw this.conflict('SHIPMENT_ACTIVE_WORK_ITEM', `Exclude work item ${workItem.id} before editing`);

    const [balance] = await tx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          inArray(
            wmsTables.batchInventorySessionBalances.shipmentLineId,
            aggregate.lines.map((line) => line.id),
          ),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      )
      .limit(1);
    if (balance) throw this.conflict('SHIPMENT_CUSTODY_EXISTS', 'Explicit unpick is required before editing custody');
  }

  private async assertNoActivePickingPlan(shipmentId: string, tx: DbTx): Promise<void> {
    const [plan] = await tx
      .select({ id: wmsTables.pickingPlans.id })
      .from(wmsTables.pickingPlanMembers)
      .innerJoin(wmsTables.pickingPlans, eq(wmsTables.pickingPlans.id, wmsTables.pickingPlanMembers.planId))
      .where(
        and(
          eq(wmsTables.pickingPlanMembers.shipmentId, shipmentId),
          inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
        ),
      )
      .limit(1);
    if (plan) throw this.conflict('SHIPMENT_STALE_PICKING_PLAN', `Picking plan ${plan.id} must be invalidated`);
  }

  private async assertPlanProfile(aggregate: ShipmentAggregate, requestedProfileId: string, tx: DbTx): Promise<void> {
    if (aggregate.lines.some((line) => line.fulfillmentMode === 'drop_ship')) {
      throw this.conflict('SHIPMENT_DROP_SHIP_NOT_SUPPORTED', 'Drop-ship demand cannot enter V2 planning');
    }
    const skuRows = await tx
      .select({
        id: wmsTables.skus.id,
        stockType: wmsTables.skus.stockType,
        profileId: wmsTables.skus.deliveryProfileId,
      })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, uniqueSorted(aggregate.lines.map((line) => line.skuId))));
    if (skuRows.some((sku) => sku.stockType === 'drop_shipped')) {
      throw this.conflict('SHIPMENT_DROP_SHIP_NOT_SUPPORTED', 'Drop-shipped SKU cannot enter V2 planning');
    }
    const profiles = uniqueSorted(skuRows.flatMap((sku) => (sku.profileId ? [sku.profileId] : [])));
    if (skuRows.some((sku) => !sku.profileId) || profiles.length !== 1 || profiles[0] !== requestedProfileId) {
      throw this.conflict(
        'SHIPMENT_PROFILE_INCOMPATIBLE',
        'All shipment lines must have one matching shipping profile',
      );
    }
    const [profile] = await tx
      .select()
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, requestedProfileId))
      .limit(1);
    if (!profile) throw new NotFoundException(`Shipping profile ${requestedProfileId} not found`);
    const modes = uniqueSorted(aggregate.lines.map((line) => line.fulfillmentMode ?? 'in_house'));
    const supportedFulfillmentModes = profile.supportedFulfillmentModes;
    if (!supportedFulfillmentModes || modes.some((mode) => !supportedFulfillmentModes.includes(mode as never))) {
      throw this.conflict('SHIPMENT_PROFILE_INCOMPATIBLE', 'Shipping profile does not support the fulfillment mode');
    }
    const requiredSnapshots = [profile.senderSnapshot, profile.originAddressSnapshot, profile.returnAddressSnapshot];
    if (
      requiredSnapshots.some(
        (snapshot) =>
          !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Object.keys(snapshot).length,
      ) ||
      !profile.carrierAccountRef?.trim()
    ) {
      throw this.conflict(
        'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
        'Shipping profile requires sender, origin, return and carrier account execution configuration',
      );
    }
  }

  private async assertFullyReserved(aggregate: ShipmentAggregate, tx: DbTx): Promise<void> {
    const confirmed = await this.confirmedReservationQtyByLine(
      aggregate.lines.map((line) => line.id),
      tx,
    );
    const incomplete = aggregate.lines.filter((line) => (confirmed.get(line.id) ?? 0) !== line.qty);
    if (incomplete.length) {
      throw this.conflict(
        'SHIPMENT_NOT_FULLY_RESERVED',
        `Under-reserved lines: ${incomplete.map((line) => line.id).join(',')}`,
      );
    }
  }

  private async assertTrustedExternalLineIdentity(aggregate: ShipmentAggregate, tx: DbTx): Promise<void> {
    const origins = await this.loadSalesOrderLineOrigins(aggregate.lines, tx);
    const invalid = origins.filter(
      (origin) =>
        TRUSTED_CHANNELS.has(origin.salesChannel) &&
        (!origin.channelOrderItemId?.trim() ||
          (origin.channelProductId?.trim() && origin.channelOrderItemId.trim() === origin.channelProductId.trim())),
    );
    if (invalid.length) {
      throw this.conflict(
        'SHIPMENT_CHANNEL_LINE_IDENTITY_UNTRUSTED',
        `Untrusted external line identity: ${invalid.map((line) => line.salesOrderLineId).join(',')}`,
      );
    }
  }

  private async loadSalesOrderLineOrigins(
    lines: ShipmentLineRow[],
    tx: DbTx,
  ): Promise<
    Array<{
      salesOrderLineId: string;
      salesOrderId: string;
      salesChannel: string;
      channelOrderId: string;
      channelOrderItemId: string | null;
      channelProductId: string | null;
    }>
  > {
    const ids = uniqueSorted(lines.flatMap((line) => (line.salesOrderLineId ? [line.salesOrderLineId] : [])));
    if (!ids.length) return [];
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    const rows = await tx.execute(sql`
      SELECT sol.id::text AS "salesOrderLineId",
             so.id::text AS "salesOrderId",
             so.sales_channel::text AS "salesChannel",
             so.channel_order_id AS "channelOrderId",
             sol.channel_order_item_id AS "channelOrderItemId",
             sol.channel_product_id AS "channelProductId"
        FROM sales_order_lines sol
        JOIN sales_orders so ON so.id = sol.sales_order_id
       WHERE sol.id::text IN (${idList})
       ORDER BY sol.id
    `);
    return rows as unknown as Array<{
      salesOrderLineId: string;
      salesOrderId: string;
      salesChannel: string;
      channelOrderId: string;
      channelOrderItemId: string | null;
      channelProductId: string | null;
    }>;
  }

  private async loadOrderRecipientSnapshots(aggregate: ShipmentAggregate, tx: DbTx): Promise<unknown[]> {
    const ids = uniqueSorted(aggregate.lines.flatMap((line) => (line.salesOrderId ? [line.salesOrderId] : [])));
    if (!ids.length) return [];
    const rows = await tx
      .select({ shippingAddress: wmsTables.salesOrders.shippingAddress })
      .from(wmsTables.salesOrders)
      .where(inArray(wmsTables.salesOrders.id, ids));
    return rows.map((row) => row.shippingAddress);
  }

  private async requiresDurableReplan(aggregate: ShipmentAggregate, tx: DbTx): Promise<boolean> {
    if (aggregate.shipment.status !== 'draft') return true;
    if (aggregate.lines.some((line) => line.inspectedQty > 0)) return true;
    const [invoice, workItem, consolidation, pickingPlan, sessionBalance] = await Promise.all([
      tx
        .select({ id: wmsTables.invoices.id })
        .from(wmsTables.invoices)
        .where(
          and(
            eq(wmsTables.invoices.shipmentId, aggregate.shipment.id),
            inArray(wmsTables.invoices.status, [...ACTIVE_INVOICE_STATUSES]),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
            inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.shipmentOperations.id })
        .from(wmsTables.shipmentOperationMembers)
        .innerJoin(
          wmsTables.shipmentOperations,
          eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
        )
        .where(
          and(
            eq(wmsTables.shipmentOperationMembers.shipmentId, aggregate.shipment.id),
            eq(wmsTables.shipmentOperationMembers.role, 'target'),
            eq(wmsTables.shipmentOperations.type, 'consolidate'),
            eq(wmsTables.shipmentOperations.status, 'completed'),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.pickingPlans.id })
        .from(wmsTables.pickingPlanMembers)
        .innerJoin(wmsTables.pickingPlans, eq(wmsTables.pickingPlans.id, wmsTables.pickingPlanMembers.planId))
        .where(
          and(
            eq(wmsTables.pickingPlanMembers.shipmentId, aggregate.shipment.id),
            inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.batchInventorySessionBalances.id })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            inArray(
              wmsTables.batchInventorySessionBalances.shipmentLineId,
              aggregate.lines.map((line) => line.id),
            ),
            gt(wmsTables.batchInventorySessionBalances.qty, 0),
            ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          ),
        )
        .limit(1),
    ]);
    return Boolean(invoice[0] || workItem[0] || consolidation[0] || pickingPlan[0] || sessionBalance[0]);
  }

  private assertRecipientComplete(value: unknown): void {
    const recipient = (value ?? {}) as Record<string, unknown>;
    const missing = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'].filter(
      (key) => typeof recipient[key] !== 'string' || !recipient[key].trim(),
    );
    if (missing.length) {
      throw this.conflict('SHIPMENT_RECIPIENT_INCOMPLETE', `Missing recipient fields: ${missing.join(',')}`);
    }
  }

  private assertShipmentVersion(shipment: ShipmentRow, manifestVersion: number, reservationVersion?: number): void {
    assertPositiveSafeInteger('expectedManifestVersion', manifestVersion);
    if (shipment.manifestVersion !== manifestVersion) {
      throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', `Shipment ${shipment.id} manifest has changed`);
    }
    if (reservationVersion !== undefined && shipment.reservationVersion !== reservationVersion) {
      throw this.conflict('SHIPMENT_STALE_RESERVATION_VERSION', `Shipment ${shipment.id} reservations have changed`);
    }
  }

  private assertNoDuplicateIds(ids: string[], label: string): void {
    if (new Set(ids).size !== ids.length) throw new BadRequestException(`Duplicate ${label} ID`);
  }

  private assertReason(reason: string): void {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('reason must be a non-blank string');
    }
  }

  private async requireScope(actor: ShipmentPlanningActor, scope: string): Promise<void> {
    if (actor.roles.includes('master')) return;
    const scopes = await this.authorization.getScopesByRoles(actor.roles);
    if (!scopes.has(scope)) throw new ForbiddenException(`Missing required scope: ${scope}`);
  }

  private sameJson(left: unknown, right: unknown): boolean {
    const normalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalize);
      if (!value || typeof value !== 'object') return typeof value === 'string' ? value.trim() : value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    };
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
