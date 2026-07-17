import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { ConsolidationActor, ConsolidationSourceDto, CreateConsolidationDto } from '../dto/consolidation.dto';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const TERMINAL_OR_UNSAFE_SOURCE_STATUSES = new Set([
  'open',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'canceled',
  'superseded',
]);
const CONSOLIDATION_RECOVERY_CODE = 'CONSOLIDATION_PENDING';

type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect & {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  fulfillmentMode: string | null;
  skuStockType: string;
  skuProfileId: string | null;
  salesChannel: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderRecipientSnapshot: unknown;
};

type ShipmentAggregate = {
  shipment: ShipmentRow;
  lines: ShipmentLineRow[];
  fulfillmentOrderIds: string[];
};

export type ConsolidationManifestSnapshot = {
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
    createdFromLineId: string | null;
    createdAt: string;
  }>;
};

export type ConsolidationResponse = {
  operationId: string;
  operationStatus: 'pending' | 'completed';
  sourceShipmentIds: string[];
  targetShipmentId: string | null;
  blockers?: Array<{ shipmentId: string; codes: string[] }>;
  sources?: ConsolidationManifestSnapshot[];
  target?: ConsolidationManifestSnapshot;
  lineLineage?: Array<{
    targetLineId: string;
    fulfillmentOrderItemId: string;
    sourceLineIds: string[];
  }>;
};

type ConsolidationCommandResult = {
  response: ConsolidationResponse;
  resourceType: string;
  resourceId: string;
  operationId: string;
};

type PendingIntent = {
  kind: 'consolidate';
  sources: ConsolidationSourceDto[];
  recipientSnapshot: Record<string, unknown>;
  reason: string;
  csCaseId: string | null;
  note: string | null;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR') : '';
}

function normalizedPhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function canonicalConsolidationRecipient(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {
    recipientName: normalizedText(input.recipientName),
    phone: normalizedPhone(input.phone),
    postalCode: normalizedText(input.postalCode),
    roadAddress: normalizedText(input.roadAddress),
    detailAddress: normalizedText(input.detailAddress),
  };
  if (typeof input.deliveryNote === 'string' && input.deliveryNote.trim()) {
    result.deliveryNote = input.deliveryNote.trim().replace(/\s+/g, ' ');
  }
  if (Object.entries(result).some(([key, entry]) => key !== 'deliveryNote' && !entry)) return null;
  return result;
}

export function consolidationCompatibilityKey(input: {
  warehouseId: string;
  shippingProfileId: string;
  customerKey: string;
  recipientSnapshot: unknown;
}): string | null {
  const recipient = canonicalConsolidationRecipient(input.recipientSnapshot);
  if (!recipient || !input.customerKey) return null;
  return createHash('sha256')
    .update(
      JSON.stringify({
        warehouseId: input.warehouseId,
        shippingProfileId: input.shippingProfileId,
        customerKey: input.customerKey,
        recipient,
      }),
    )
    .digest('hex');
}

@Injectable()
export class ConsolidationService {
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

  async findCandidates(warehouseId: string, sourceShipmentId?: string, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const shipmentRows = await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(and(eq(wmsTables.shipments.warehouseId, warehouseId), eq(wmsTables.shipments.status, 'draft')))
        .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id));

      const candidates: Array<{
        aggregate: ShipmentAggregate;
        compatibilityKey: string;
        customerKey: string;
      }> = [];
      for (const row of shipmentRows) {
        let aggregate: ShipmentAggregate | null;
        try {
          aggregate = await this.loadAggregate(row.id, trx);
        } catch (error) {
          if (error instanceof NotFoundException) {
            aggregate = null;
          } else {
            throw error;
          }
        }
        if (!aggregate || !aggregate.shipment.shippingProfileId) continue;
        if (!(await this.isCompatibleInHouseAggregate(aggregate, trx))) continue;
        if ((await this.loadBlockers(aggregate, trx)).length > 0) continue;
        const customerKey = this.customerKey(aggregate);
        if (!customerKey) continue;
        const compatibilityKey = consolidationCompatibilityKey({
          warehouseId,
          shippingProfileId: aggregate.shipment.shippingProfileId,
          customerKey,
          recipientSnapshot: aggregate.shipment.recipientSnapshot,
        });
        if (!compatibilityKey) continue;
        candidates.push({ aggregate, compatibilityKey, customerKey });
      }

      const grouped = new Map<string, typeof candidates>();
      for (const candidate of candidates) {
        grouped.set(candidate.compatibilityKey, [...(grouped.get(candidate.compatibilityKey) ?? []), candidate]);
      }

      return [...grouped.entries()]
        .map(([compatibilityKey, members]) => ({
          compatibilityKey,
          warehouseId,
          shippingProfileId: members[0].aggregate.shipment.shippingProfileId as string,
          recipientSnapshot: members[0].aggregate.shipment.recipientSnapshot,
          shipments: members
            .map(({ aggregate }) => ({
              shipmentId: aggregate.shipment.id,
              manifestVersion: aggregate.shipment.manifestVersion,
              reservationVersion: aggregate.shipment.reservationVersion,
              salesOrderIds: uniqueSorted(
                aggregate.lines.flatMap((line) => (line.salesOrderId ? [line.salesOrderId] : [])),
              ),
              salesChannels: uniqueSorted(
                aggregate.lines.flatMap((line) => (line.salesChannel ? [line.salesChannel] : [])),
              ),
              lineCount: aggregate.lines.length,
              totalQty: aggregate.lines.reduce((total, line) => total + line.qty, 0),
            }))
            .sort((left, right) => left.shipmentId.localeCompare(right.shipmentId)),
        }))
        .filter(
          (group) =>
            group.shipments.length > 1 &&
            (!sourceShipmentId || group.shipments.some((shipment) => shipment.shipmentId === sourceShipmentId)),
        )
        .sort((left, right) => left.compatibilityKey.localeCompare(right.compatibilityKey));
    }, tx);
  }

  async consolidate(
    dto: CreateConsolidationDto,
    idempotencyKey: string,
    actor: ConsolidationActor,
    tx?: DbTx,
  ): Promise<ConsolidationResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.consolidate');
    this.assertReason(dto.reason);
    await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE);
    const sources = [...dto.sources].sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));
    if (sources.length < 2) throw new BadRequestException('At least two source shipments are required');
    if (new Set(sources.map((source) => source.shipmentId)).size !== sources.length) {
      throw new BadRequestException('Duplicate source shipment ID');
    }
    const hasSourceRecipient = Boolean(dto.recipientSourceShipmentId);
    const hasNewRecipient = Boolean(dto.recipientSnapshot);
    if (hasSourceRecipient === hasNewRecipient) {
      throw new BadRequestException('Choose exactly one recipient source or recipient snapshot');
    }
    if (
      dto.recipientSourceShipmentId &&
      !sources.some((source) => source.shipmentId === dto.recipientSourceShipmentId)
    ) {
      throw new BadRequestException('recipientSourceShipmentId must be one of the source shipments');
    }

    return this.commands.execute<ConsolidationResponse>(
      {
        commandType: 'shipment.consolidate',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, ...dto, sources },
      },
      async (trx, _commandRequestId, requestHash) => {
        const aggregates = await this.lockAggregates(
          sources.map((source) => source.shipmentId),
          trx,
        );
        this.assertExpectedVersions(aggregates, sources);
        await this.assertInitialSourceStatusesSafe(aggregates, trx);
        await this.assertCompatibleSources(aggregates, trx);
        const recipientSnapshot = this.resolveRecipient(dto, aggregates);
        const overridesRecipient = aggregates.some(
          (aggregate) =>
            !this.sameRecipient(aggregate.shipment.recipientSnapshot, recipientSnapshot) ||
            aggregate.lines.some((line) => !this.sameRecipient(line.orderRecipientSnapshot, recipientSnapshot)),
        );
        if (overridesRecipient) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT);
        }

        const before = aggregates.map((aggregate) => this.snapshot(aggregate));
        const [operation] = await trx
          .insert(wmsTables.shipmentOperations)
          .values({
            type: 'consolidate',
            status: 'pending',
            operatorId: actor.id,
            reason: dto.reason,
            csCaseId: dto.csCaseId ?? null,
            note: dto.note ?? null,
            idempotencyKey,
            requestHash,
            beforeManifestSnapshot: before,
          })
          .returning();

        const blockerRows = await this.collectBlockers(aggregates, trx);
        if (aggregates.some((aggregate) => aggregate.shipment.status !== 'draft')) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
        }
        if (blockerRows.length > 0) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
          return this.deferConsolidation(
            operation,
            aggregates,
            sources,
            recipientSnapshot,
            dto,
            blockerRows,
            actor,
            trx,
          );
        }

        return this.activateConsolidation(operation, aggregates, recipientSnapshot, actor, trx);
      },
      tx,
    );
  }

  /** Task 12-14 call this after invoice void, batch exclusion and unpick have committed. */
  async resumePending(operationId: string, tx?: DbTx): Promise<ConsolidationResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.consolidate.resume');
    return this.dbService.run(async (trx) => {
      const [optimisticOperation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      if (!optimisticOperation || optimisticOperation.type !== 'consolidate') {
        throw new NotFoundException(`Consolidation operation ${operationId} not found`);
      }
      if (optimisticOperation.status === 'completed') {
        return this.completedResponse(operationId, trx);
      }

      const pending = this.pendingIntent(optimisticOperation.afterManifestSnapshot);
      let aggregates: ShipmentAggregate[];
      try {
        aggregates = await this.lockAggregates(
          pending.sources.map((source) => source.shipmentId),
          trx,
        );
      } catch (error) {
        const [latest] = await trx
          .select({ status: wmsTables.shipmentOperations.status })
          .from(wmsTables.shipmentOperations)
          .where(eq(wmsTables.shipmentOperations.id, operationId))
          .limit(1);
        if (latest?.status === 'completed') return this.completedResponse(operationId, trx);
        throw error;
      }
      const [operation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1)
        .for('update');
      if (!operation || operation.type !== 'consolidate') {
        throw new NotFoundException(`Consolidation operation ${operationId} not found`);
      }
      if (operation.status === 'completed') {
        return this.completedResponse(operationId, trx);
      }
      const lockedPending = this.pendingIntent(operation.afterManifestSnapshot);
      if (JSON.stringify(lockedPending) !== JSON.stringify(pending)) {
        throw this.conflict('CONSOLIDATION_OPERATION_CHANGED_RETRY', 'Consolidation intent changed; retry resume');
      }
      this.assertExpectedVersions(aggregates, pending.sources);
      for (const aggregate of aggregates) {
        if (
          aggregate.shipment.status !== 'recovery_required' ||
          aggregate.shipment.recoveryCode !== CONSOLIDATION_RECOVERY_CODE
        ) {
          throw this.conflict(
            'CONSOLIDATION_SOURCE_STATE_CHANGED',
            `Shipment ${aggregate.shipment.id} is not waiting for consolidation`,
          );
        }
      }
      await this.assertCompatibleSources(aggregates, trx);
      const blockerRows = await this.collectBlockers(aggregates, trx);
      if (blockerRows.length > 0) {
        return {
          operationId,
          operationStatus: 'pending',
          sourceShipmentIds: pending.sources.map((source) => source.shipmentId),
          targetShipmentId: null,
          blockers: blockerRows,
        };
      }

      const actor = { id: operation.operatorId, roles: [] };
      const activated = await this.activateConsolidation(operation, aggregates, pending.recipientSnapshot, actor, trx);
      const response = activated.response;
      await trx
        .update(wmsTables.fulfillmentCommandRequests)
        .set({
          resourceType: 'shipment',
          resourceId: response.targetShipmentId,
          responseSnapshot: response,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentCommandRequests.operationId, operationId));
      return response;
    }, tx);
  }

  private async deferConsolidation(
    operation: typeof wmsTables.shipmentOperations.$inferSelect,
    aggregates: ShipmentAggregate[],
    sources: ConsolidationSourceDto[],
    recipientSnapshot: Record<string, unknown>,
    dto: CreateConsolidationDto,
    blockers: Array<{ shipmentId: string; codes: string[] }>,
    actor: ConsolidationActor,
    tx: DbTx,
  ): Promise<{
    response: ConsolidationResponse;
    resourceType: string;
    resourceId: string;
    operationId: string;
  }> {
    const now = new Date();
    const sourceIds = sources.map((source) => source.shipmentId);
    const statusBlockers = aggregates
      .filter((aggregate) => aggregate.shipment.status !== 'draft')
      .map((aggregate) => ({ shipmentId: aggregate.shipment.id, codes: ['SHIPMENT_REOPEN_REQUIRED'] }));
    const allBlockers = this.mergeBlockers([...blockers, ...statusBlockers]);
    await tx
      .update(wmsTables.shipments)
      .set({ status: 'recovery_required', recoveryCode: CONSOLIDATION_RECOVERY_CODE, lastUpdated: now })
      .where(inArray(wmsTables.shipments.id, sourceIds));
    const waitingWorkItems = await tx
      .select({
        id: wmsTables.outboundBatchWorkItems.id,
        waitingOperationId: wmsTables.outboundBatchWorkItems.waitingOperationId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, sourceIds),
          ne(wmsTables.outboundBatchWorkItems.status, 'excluded'),
        ),
      );
    const conflictingWait = waitingWorkItems.find(
      (item) => item.waitingOperationId && item.waitingOperationId !== operation.id,
    );
    if (conflictingWait) {
      throw this.conflict(
        'CONSOLIDATION_WORK_ITEM_ALREADY_WAITING',
        `Work item ${conflictingWait.id} already waits for operation ${conflictingWait.waitingOperationId}`,
      );
    }
    await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({ waitingOperationId: operation.id, updatedAt: now })
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, sourceIds),
          ne(wmsTables.outboundBatchWorkItems.status, 'excluded'),
        ),
      );

    const pendingIntent: PendingIntent = {
      kind: 'consolidate',
      sources,
      recipientSnapshot,
      reason: dto.reason,
      csCaseId: dto.csCaseId ?? null,
      note: dto.note ?? null,
    };
    for (const shipmentId of [...sourceIds].sort()) {
      await this.reservations.recompute(shipmentId, tx);
    }
    const after = await Promise.all(sourceIds.map((shipmentId) => this.loadAggregate(shipmentId, tx)));
    await tx.insert(wmsTables.shipmentOperationMembers).values(
      aggregates.map((aggregate, index) => ({
        operationId: operation.id,
        shipmentId: aggregate.shipment.id,
        role: 'source' as const,
        beforeManifestVersion: aggregate.shipment.manifestVersion,
        afterManifestVersion: after[index].shipment.manifestVersion,
        beforeManifestSnapshot: this.snapshot(aggregate),
        afterManifestSnapshot: this.snapshot(after[index]),
      })),
    );
    await tx
      .update(wmsTables.shipmentOperations)
      .set({ afterManifestSnapshot: { pendingIntent, blockers: allBlockers } })
      .where(eq(wmsTables.shipmentOperations.id, operation.id));
    await this.invariant.assertFulfillmentOrders(
      uniqueSorted(aggregates.flatMap((aggregate) => aggregate.fulfillmentOrderIds)),
      tx,
    );
    await this.auditCommand(tx, actor, 'shipment.consolidate.pending_recovery', operation.id, dto.reason, {
      sourceShipmentIds: sourceIds,
      blockers: allBlockers,
      before: aggregates.map((aggregate) => this.snapshot(aggregate)),
      after: after.map((aggregate) => this.snapshot(aggregate)),
    });

    const response: ConsolidationResponse = {
      operationId: operation.id,
      operationStatus: 'pending',
      sourceShipmentIds: sourceIds,
      targetShipmentId: null,
      blockers: allBlockers,
    };
    return {
      response,
      resourceType: 'shipment_operation',
      resourceId: operation.id,
      operationId: operation.id,
    };
  }

  private async activateConsolidation(
    operation: typeof wmsTables.shipmentOperations.$inferSelect,
    aggregates: ShipmentAggregate[],
    recipientSnapshot: Record<string, unknown>,
    actor: ConsolidationActor,
    tx: DbTx,
  ): Promise<ConsolidationCommandResult> {
    const sourceIds = aggregates.map((aggregate) => aggregate.shipment.id).sort();
    const beforeByShipment = new Map<string, ConsolidationManifestSnapshot>();
    const existingMembers = await tx
      .select()
      .from(wmsTables.shipmentOperationMembers)
      .where(eq(wmsTables.shipmentOperationMembers.operationId, operation.id));
    for (const member of existingMembers) {
      if (member.role === 'source' && member.beforeManifestSnapshot) {
        beforeByShipment.set(member.shipmentId, member.beforeManifestSnapshot as ConsolidationManifestSnapshot);
      }
    }
    for (const aggregate of aggregates) {
      if (!beforeByShipment.has(aggregate.shipment.id)) {
        beforeByShipment.set(aggregate.shipment.id, this.snapshot(aggregate));
      }
    }

    const warehouseId = aggregates[0].shipment.warehouseId;
    const shippingProfileId = aggregates[0].shipment.shippingProfileId;
    const [target] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId,
        status: 'draft',
        shippingProfileId,
        recipientSnapshot,
        manifestVersion: 1,
        reservationVersion: 1,
        openedBy: actor.id,
        openedAt: new Date(),
      })
      .returning();

    const allLines = aggregates.flatMap((aggregate) => aggregate.lines);
    const sourceLineIds = allLines.map((line) => line.id);
    const confirmedReservations = await tx
      .select({
        shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        quantity: wmsTables.stockReservations.quantity,
      })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(wmsTables.stockReservations.shipmentLineId, sourceLineIds),
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      )
      .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id));
    const confirmedByLine = new Map<string, number>();
    for (const reservation of confirmedReservations) {
      if (!reservation.shipmentLineId) continue;
      confirmedByLine.set(
        reservation.shipmentLineId,
        (confirmedByLine.get(reservation.shipmentLineId) ?? 0) + reservation.quantity,
      );
    }

    const groupedLines = new Map<string, ShipmentLineRow[]>();
    for (const line of allLines) {
      groupedLines.set(line.fulfillmentOrderItemId, [...(groupedLines.get(line.fulfillmentOrderItemId) ?? []), line]);
    }
    const lineLineage: NonNullable<ConsolidationResponse['lineLineage']> = [];
    for (const [fulfillmentOrderItemId, lines] of [...groupedLines.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const skuIds = uniqueSorted(lines.map((line) => line.skuId));
      if (skuIds.length !== 1) {
        throw this.conflict(
          'CONSOLIDATION_FOI_SKU_MISMATCH',
          `FOI ${fulfillmentOrderItemId} is represented by multiple SKUs`,
        );
      }
      const sourceIdsForLine = lines.map((line) => line.id).sort();
      const [targetLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: target.id,
          fulfillmentOrderItemId,
          skuId: skuIds[0],
          qty: lines.reduce((total, line) => total + line.qty, 0),
          reservedQty: lines.reduce((total, line) => total + (confirmedByLine.get(line.id) ?? 0), 0),
          createdFromLineId: lines.length === 1 ? lines[0].id : null,
          createdAt: new Date(Math.min(...lines.map((line) => line.createdAt.getTime()))),
        })
        .returning();
      await tx
        .update(wmsTables.stockReservations)
        .set({ targetId: targetLine.id, shipmentLineId: targetLine.id, updatedAt: new Date() })
        .where(
          and(
            inArray(wmsTables.stockReservations.shipmentLineId, sourceIdsForLine),
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      lineLineage.push({ targetLineId: targetLine.id, fulfillmentOrderItemId, sourceLineIds: sourceIdsForLine });
    }

    const now = new Date();
    await tx
      .update(wmsTables.shipmentLines)
      .set({ reservedQty: 0 })
      .where(inArray(wmsTables.shipmentLines.id, sourceLineIds));
    await tx
      .update(wmsTables.shipments)
      .set({
        status: 'superseded',
        supersededAt: now,
        recoveryCode: null,
        manifestVersion: sql`${wmsTables.shipments.manifestVersion} + 1`,
        reservationVersion: sql`${wmsTables.shipments.reservationVersion} + 1`,
        lastUpdated: now,
      })
      .where(inArray(wmsTables.shipments.id, sourceIds));
    await tx
      .update(wmsTables.shipments)
      .set({ reservationVersion: sql`${wmsTables.shipments.reservationVersion} + 1`, lastUpdated: now })
      .where(eq(wmsTables.shipments.id, target.id));

    await this.reservations.recompute(target.id, tx);
    const sourceAfter = await Promise.all(sourceIds.map((shipmentId) => this.loadAggregate(shipmentId, tx)));
    const targetAfter = await this.loadAggregate(target.id, tx);
    const sourceSnapshots = sourceAfter.map((aggregate) => this.snapshot(aggregate));
    const targetSnapshot = this.snapshot(targetAfter);
    for (const source of sourceSnapshots) {
      await tx
        .insert(wmsTables.shipmentOperationMembers)
        .values({
          operationId: operation.id,
          shipmentId: source.shipmentId,
          role: 'source',
          beforeManifestVersion: beforeByShipment.get(source.shipmentId)?.manifestVersion ?? null,
          afterManifestVersion: source.manifestVersion,
          beforeManifestSnapshot: beforeByShipment.get(source.shipmentId) ?? null,
          afterManifestSnapshot: source,
        })
        .onConflictDoUpdate({
          target: [
            wmsTables.shipmentOperationMembers.operationId,
            wmsTables.shipmentOperationMembers.shipmentId,
            wmsTables.shipmentOperationMembers.role,
          ],
          set: {
            afterManifestVersion: source.manifestVersion,
            afterManifestSnapshot: source,
          },
        });
    }
    await tx.insert(wmsTables.shipmentOperationMembers).values({
      operationId: operation.id,
      shipmentId: target.id,
      role: 'target',
      afterManifestVersion: targetSnapshot.manifestVersion,
      afterManifestSnapshot: targetSnapshot,
    });
    await tx
      .update(wmsTables.shipmentOperations)
      .set({
        status: 'completed',
        afterManifestSnapshot: { sources: sourceSnapshots, target: targetSnapshot, lineLineage },
        completedAt: now,
        lastError: null,
      })
      .where(eq(wmsTables.shipmentOperations.id, operation.id));

    const response: ConsolidationResponse = {
      operationId: operation.id,
      operationStatus: 'completed',
      sourceShipmentIds: sourceIds,
      targetShipmentId: target.id,
      sources: sourceSnapshots,
      target: targetSnapshot,
      lineLineage,
    };
    await this.auditCommand(tx, actor, 'shipment.consolidate', operation.id, operation.reason, {
      sourceShipmentIds: sourceIds,
      targetShipmentId: target.id,
      before: [...beforeByShipment.values()],
      after: { sources: sourceSnapshots, target: targetSnapshot },
      lineLineage,
    });
    return { response, resourceType: 'shipment', resourceId: target.id, operationId: operation.id };
  }

  private async lockAggregates(shipmentIds: string[], tx: DbTx): Promise<ShipmentAggregate[]> {
    const ids = uniqueSorted(shipmentIds);
    const optimistic = await Promise.all(ids.map((shipmentId) => this.loadAggregate(shipmentId, tx)));
    await this.invariant.assertFulfillmentOrders(
      uniqueSorted(optimistic.flatMap((aggregate) => aggregate.fulfillmentOrderIds)),
      tx,
    );
    const locked = await Promise.all(ids.map((shipmentId) => this.loadAggregate(shipmentId, tx)));
    const signature = (aggregates: ShipmentAggregate[]) =>
      aggregates
        .flatMap((aggregate) =>
          aggregate.lines.map(
            (line) => `${aggregate.shipment.id}:${line.id}:${line.fulfillmentOrderItemId}:${line.shipmentId}`,
          ),
        )
        .sort()
        .join(',');
    if (signature(optimistic) !== signature(locked)) {
      throw this.conflict('CONSOLIDATION_COMPONENT_CHANGED_RETRY', 'Shipment membership changed while acquiring locks');
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
        skuStockType: wmsTables.skus.stockType,
        skuProfileId: wmsTables.skus.deliveryProfileId,
        salesChannel: wmsTables.salesOrders.salesChannel,
        customerId: wmsTables.salesOrders.customerId,
        customerName: wmsTables.salesOrders.customerName,
        customerPhone: wmsTables.salesOrders.customerPhone,
        orderRecipientSnapshot: wmsTables.salesOrders.shippingAddress,
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
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    return {
      shipment,
      lines,
      fulfillmentOrderIds: uniqueSorted(lines.map((line) => line.fulfillmentOrderId)),
    };
  }

  private snapshot(aggregate: ShipmentAggregate): ConsolidationManifestSnapshot {
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
        createdFromLineId: line.createdFromLineId,
        createdAt: line.createdAt.toISOString(),
      })),
    };
  }

  private assertExpectedVersions(aggregates: ShipmentAggregate[], sources: ConsolidationSourceDto[]): void {
    const expectedById = new Map(sources.map((source) => [source.shipmentId, source]));
    for (const aggregate of aggregates) {
      const expected = expectedById.get(aggregate.shipment.id);
      if (!expected) throw new BadRequestException(`Unexpected source shipment ${aggregate.shipment.id}`);
      if (aggregate.shipment.manifestVersion !== expected.expectedManifestVersion) {
        throw this.conflict(
          'SHIPMENT_STALE_MANIFEST_VERSION',
          `Shipment ${aggregate.shipment.id} manifest has changed`,
        );
      }
      if (aggregate.shipment.reservationVersion !== expected.expectedReservationVersion) {
        throw this.conflict(
          'SHIPMENT_STALE_RESERVATION_VERSION',
          `Shipment ${aggregate.shipment.id} reservations have changed`,
        );
      }
    }
  }

  private async assertInitialSourceStatusesSafe(aggregates: ShipmentAggregate[], tx: DbTx): Promise<void> {
    for (const aggregate of aggregates) {
      if (TERMINAL_OR_UNSAFE_SOURCE_STATUSES.has(aggregate.shipment.status)) {
        throw this.conflict(
          'CONSOLIDATION_SOURCE_NOT_MUTABLE',
          `Shipment ${aggregate.shipment.id} cannot be consolidated from ${aggregate.shipment.status}`,
        );
      }
      if (aggregate.shipment.status === 'recovery_required') {
        const [pending] = await tx
          .select({ operationId: wmsTables.shipmentOperations.id })
          .from(wmsTables.shipmentOperationMembers)
          .innerJoin(
            wmsTables.shipmentOperations,
            eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
          )
          .where(
            and(
              eq(wmsTables.shipmentOperationMembers.shipmentId, aggregate.shipment.id),
              eq(wmsTables.shipmentOperationMembers.role, 'source'),
              eq(wmsTables.shipmentOperations.type, 'consolidate'),
              eq(wmsTables.shipmentOperations.status, 'pending'),
            ),
          )
          .orderBy(asc(wmsTables.shipmentOperations.createdAt))
          .limit(1);
        if (aggregate.shipment.recoveryCode === CONSOLIDATION_RECOVERY_CODE && pending) {
          throw new ConflictException({
            code: 'CONSOLIDATION_ALREADY_PENDING',
            message: `Shipment ${aggregate.shipment.id} already belongs to a pending consolidation`,
            operationId: pending.operationId,
          });
        }
        throw this.conflict(
          'CONSOLIDATION_SOURCE_RECOVERY_CONFLICT',
          `Shipment ${aggregate.shipment.id} is in unrelated recovery`,
        );
      }
    }
  }

  private async assertCompatibleSources(aggregates: ShipmentAggregate[], tx: DbTx): Promise<void> {
    const warehouses = uniqueSorted(aggregates.map((aggregate) => aggregate.shipment.warehouseId));
    if (warehouses.length !== 1) {
      throw this.conflict('CONSOLIDATION_WAREHOUSE_MISMATCH', 'Source shipments must use the same warehouse');
    }
    const profiles = uniqueSorted(
      aggregates.flatMap((aggregate) =>
        aggregate.shipment.shippingProfileId ? [aggregate.shipment.shippingProfileId] : [],
      ),
    );
    if (profiles.length !== 1 || aggregates.some((aggregate) => aggregate.shipment.shippingProfileId !== profiles[0])) {
      throw this.conflict(
        'CONSOLIDATION_PROFILE_MISMATCH',
        'Source shipments must have the same non-null shipping profile',
      );
    }
    if (aggregates.some((aggregate) => !this.aggregateIsInHouse(aggregate))) {
      throw this.conflict(
        'CONSOLIDATION_DROP_SHIP_NOT_SUPPORTED',
        'Only in-house, non-drop-ship source shipments can be consolidated',
      );
    }
    if (!(await this.profileSupportsInHouse(profiles[0], tx))) {
      throw this.conflict(
        'CONSOLIDATION_PROFILE_INCOMPATIBLE',
        'Shipping profile does not support in-house fulfillment',
      );
    }
  }

  private async isCompatibleInHouseAggregate(aggregate: ShipmentAggregate, tx: DbTx): Promise<boolean> {
    const profileId = aggregate.shipment.shippingProfileId;
    return Boolean(
      profileId && this.aggregateIsInHouse(aggregate) && (await this.profileSupportsInHouse(profileId, tx)),
    );
  }

  private aggregateIsInHouse(aggregate: ShipmentAggregate): boolean {
    return aggregate.lines.every(
      (line) =>
        line.salesOrderId !== null &&
        line.fulfillmentMode === 'in_house' &&
        line.skuStockType !== 'drop_shipped' &&
        line.skuProfileId !== null &&
        line.skuProfileId === aggregate.shipment.shippingProfileId,
    );
  }

  private async profileSupportsInHouse(profileId: string, tx: DbTx): Promise<boolean> {
    const [profile] = await tx
      .select({ modes: wmsTables.deliveryProfiles.supportedFulfillmentModes })
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, profileId))
      .limit(1);
    return Boolean(profile?.modes?.includes('in_house'));
  }

  private resolveRecipient(dto: CreateConsolidationDto, aggregates: ShipmentAggregate[]): Record<string, unknown> {
    const selected = dto.recipientSnapshot
      ? dto.recipientSnapshot
      : aggregates.find((aggregate) => aggregate.shipment.id === dto.recipientSourceShipmentId)?.shipment
          .recipientSnapshot;
    const canonical = canonicalConsolidationRecipient(selected);
    if (!canonical) throw new BadRequestException('A complete recipient snapshot is required');
    return selected as Record<string, unknown>;
  }

  private customerKey(aggregate: ShipmentAggregate): string | null {
    const orders = new Map<
      string,
      { customerId: string | null; customerName: string | null; customerPhone: string | null }
    >();
    for (const line of aggregate.lines) {
      if (!line.salesOrderId) return null;
      orders.set(line.salesOrderId, {
        customerId: line.customerId,
        customerName: line.customerName,
        customerPhone: line.customerPhone,
      });
    }
    const rows = [...orders.values()];
    const customerIds = uniqueSorted(rows.flatMap((row) => (row.customerId ? [row.customerId] : [])));
    if (customerIds.length > 0) {
      return customerIds.length === 1 && rows.every((row) => row.customerId === customerIds[0])
        ? `id:${customerIds[0]}`
        : null;
    }
    const identities = uniqueSorted(
      rows.map((row) => `${normalizedText(row.customerName)}:${normalizedPhone(row.customerPhone)}`),
    );
    return identities.length === 1 && !identities[0].startsWith(':') && !identities[0].endsWith(':')
      ? `contact:${identities[0]}`
      : null;
  }

  private async collectBlockers(
    aggregates: ShipmentAggregate[],
    tx: DbTx,
  ): Promise<Array<{ shipmentId: string; codes: string[] }>> {
    const result: Array<{ shipmentId: string; codes: string[] }> = [];
    for (const aggregate of aggregates) {
      const codes = await this.loadBlockers(aggregate, tx);
      if (codes.length) result.push({ shipmentId: aggregate.shipment.id, codes });
    }
    return result;
  }

  private async loadBlockers(aggregate: ShipmentAggregate, tx: DbTx): Promise<string[]> {
    const lineIds = aggregate.lines.map((line) => line.id);
    const [waybill, workItem, custody, pickingPlan, attempt] = await Promise.all([
      tx
        .select({ id: wmsTables.waybills.id })
        .from(wmsTables.waybills)
        .where(
          and(
            eq(wmsTables.waybills.shipmentId, aggregate.shipment.id),
            notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
            ne(wmsTables.outboundBatchWorkItems.status, 'excluded'),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.batchInventorySessionBalances.id })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            inArray(wmsTables.batchInventorySessionBalances.shipmentLineId, lineIds),
            gt(wmsTables.batchInventorySessionBalances.qty, 0),
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
            isNull(wmsTables.pickingPlanMembers.retiredAt),
            inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.dispatchAttempts.id })
        .from(wmsTables.dispatchAttempts)
        .where(
          and(
            eq(wmsTables.dispatchAttempts.shipmentId, aggregate.shipment.id),
            ne(wmsTables.dispatchAttempts.status, 'recalled'),
          ),
        )
        .limit(1),
    ]);
    const codes: string[] = [];
    // 'ACTIVE_INVOICE' 문자열은 운영/클라이언트 의미 보존을 위해 유지(데이터소스만 waybill 로 전환).
    if (waybill[0]) codes.push('ACTIVE_INVOICE');
    if (workItem[0]) codes.push('ACTIVE_WORK_ITEM');
    if (custody[0] || aggregate.lines.some((line) => line.inspectedQty > 0)) codes.push('CUSTODY_REQUIRES_UNPICK');
    if (pickingPlan[0]) codes.push('ACTIVE_PICKING_PLAN');
    if (attempt[0]) codes.push('DISPATCH_ATTEMPT_EXISTS');
    return codes;
  }

  private mergeBlockers(rows: Array<{ shipmentId: string; codes: string[] }>) {
    const grouped = new Map<string, Set<string>>();
    for (const row of rows) {
      const codes = grouped.get(row.shipmentId) ?? new Set<string>();
      row.codes.forEach((code) => codes.add(code));
      grouped.set(row.shipmentId, codes);
    }
    return [...grouped.entries()]
      .map(([shipmentId, codes]) => ({ shipmentId, codes: [...codes].sort() }))
      .sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));
  }

  private pendingIntent(value: unknown): PendingIntent {
    const record = value as { pendingIntent?: PendingIntent } | null;
    if (!record?.pendingIntent || record.pendingIntent.kind !== 'consolidate') {
      throw this.conflict('CONSOLIDATION_PENDING_INTENT_MISSING', 'Pending consolidation intent is missing');
    }
    return record.pendingIntent;
  }

  private async completedResponse(operationId: string, tx: DbTx): Promise<ConsolidationResponse> {
    const [command] = await tx
      .select({ response: wmsTables.fulfillmentCommandRequests.responseSnapshot })
      .from(wmsTables.fulfillmentCommandRequests)
      .where(eq(wmsTables.fulfillmentCommandRequests.operationId, operationId))
      .limit(1);
    if (!command?.response) {
      throw this.conflict('CONSOLIDATION_COMMAND_RESULT_MISSING', 'Completed consolidation result is missing');
    }
    return command.response as ConsolidationResponse;
  }

  private async auditCommand(
    tx: DbTx,
    actor: ConsolidationActor,
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

  private sameRecipient(left: unknown, right: unknown): boolean {
    const leftCanonical = canonicalConsolidationRecipient(left);
    const rightCanonical = canonicalConsolidationRecipient(right);
    return Boolean(leftCanonical && rightCanonical && JSON.stringify(leftCanonical) === JSON.stringify(rightCanonical));
  }

  private assertReason(reason: string): void {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('reason must be a non-blank string');
    }
  }

  private async requireScope(actor: ConsolidationActor, scope: string): Promise<void> {
    if (actor.roles.includes('master')) return;
    const scopes = await this.authorization.getScopesByRoles(actor.roles);
    if (!scopes.has(scope)) throw new ForbiddenException(`Missing required scope: ${scope}`);
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
