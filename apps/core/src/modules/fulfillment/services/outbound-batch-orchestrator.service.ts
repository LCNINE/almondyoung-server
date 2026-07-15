import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  ClaimBatchWorkItemDto,
  CreateOutboundBatchV2Dto,
  EligibleShipmentResponseDto,
  ExcludeShipmentFromBatchDto,
  HandoffBatchWorkItemDto,
  OutboundBatchActor,
  OutboundBatchCommandResponseDto,
  OutboundBatchV2DetailDto,
  OutboundBatchWorkItemResponseDto,
} from '../dto/outbound-batch-v2.dto';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { InvoiceOrchestrator, canonicalShipmentRecipientHash } from './invoice-orchestrator.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ConsolidationService } from './consolidation.service';

const ACTIVE_WORK_ITEM_STATUSES = ['queued', 'picking', 'ready_to_pack', 'packing', 'short_pick_recovery'] as const;
const TERMINAL_FOR_BATCH_STATUSES = ['completed', 'excluded'] as const;
const LEASE_MS = 15 * 60_000;

type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
type ShipmentRow = typeof wmsTables.shipments.$inferSelect;

type EligibilityAggregate = {
  shipment: ShipmentRow;
  fulfillmentOrderIds: string[];
  lines: Array<{
    id: string;
    fulfillmentOrderId: string;
    skuId: string;
    qty: number;
    reservedQty: number;
    inspectedQty: number;
    fulfillmentMode: string | null;
    stockType: string;
  }>;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

@Injectable()
export class OutboundBatchOrchestrator {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly invoices: InvoiceOrchestrator,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createBatch(
    dto: CreateOutboundBatchV2Dto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<{ operationId: string; batchId: string }> {
    this.workflowGate.assertV2MutationAllowed('outbound_batch.create');
    if (dto.pickingMethod !== 'individual') {
      throw this.conflict(
        'OUTBOUND_BATCH_STRATEGY_NOT_AVAILABLE',
        'Only individual picking is available until a durable picking strategy is configured',
      );
    }
    return this.commands.execute(
      {
        commandType: 'outbound_batch.create',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, ...dto },
      },
      async (trx, commandRequestId) => {
        const [warehouse] = await trx
          .select({ id: wmsTables.warehouses.id })
          .from(wmsTables.warehouses)
          .where(eq(wmsTables.warehouses.id, dto.warehouseId))
          .limit(1);
        if (!warehouse) throw new NotFoundException(`Warehouse ${dto.warehouseId} not found`);

        const suffix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
        const [batch] = await trx
          .insert(wmsTables.outboundBatches)
          .values({
            batchNumber: `OB-${suffix}`,
            warehouseId: dto.warehouseId,
            pickingMethod: dto.pickingMethod,
            name: dto.name?.trim() || `Batch ${suffix}`,
            scheduledPickingAt: dto.scheduledPickingAt,
            status: 'created',
            totalItems: 0,
            totalQty: 0,
          })
          .returning();
        await this.auditCommand(trx, actor, 'outbound_batch.create', batch.id, {
          commandRequestId,
          warehouseId: batch.warehouseId,
          pickingMethod: batch.pickingMethod,
        });
        const response = { operationId: commandRequestId, batchId: batch.id };
        return { response, resourceType: 'outbound_batch', resourceId: batch.id };
      },
      tx,
    );
  }

  async addShipment(
    batchId: string,
    shipmentId: string,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<OutboundBatchCommandResponseDto> {
    this.workflowGate.assertV2MutationAllowed('outbound_batch.shipment.add');
    return this.commands.execute(
      {
        commandType: 'outbound_batch.shipment.add',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, batchId, shipmentId },
      },
      async (trx, commandRequestId) => {
        const aggregate = await this.lockEligibilityAggregate(shipmentId, trx);
        // The invariant lock already owns any existing work-item row for this shipment.
        // Reject a duplicate before taking the batch lock so a concurrent add cannot form
        // shipment-work-item -> batch vs batch -> active-work-item lock inversion.
        await this.assertNoActiveWorkItem(shipmentId, trx);
        // Canonical component locks precede batch/work-item locks in every membership command.
        const batch = await this.lockOpenBatch(batchId, trx);
        const eligible = await this.assertEligible(batch, aggregate, trx);

        let workItem: WorkItemRow;
        try {
          [workItem] = await trx
            .insert(wmsTables.outboundBatchWorkItems)
            .values({ batchId, shipmentId, status: 'queued' })
            .returning();
        } catch (error) {
          if (this.isActiveWorkItemUniqueViolation(error)) {
            throw this.conflict(
              'SHIPMENT_ACTIVE_WORK_ITEM',
              `Shipment ${shipmentId} already belongs to an active batch work item`,
            );
          }
          throw error;
        }
        await this.auditCommand(trx, actor, 'outbound_batch.shipment.add', workItem.id, {
          commandRequestId,
          batchId,
          shipmentId,
          invoiceId: eligible.invoiceId,
          manifestVersion: aggregate.shipment.manifestVersion,
          reservationVersion: aggregate.shipment.reservationVersion,
        });
        const response = { operationId: commandRequestId, workItem: this.workItemResponse(workItem) };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: workItem.id };
      },
      tx,
    );
  }

  async excludeShipment(
    batchId: string,
    shipmentId: string,
    dto: ExcludeShipmentFromBatchDto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
  ): Promise<OutboundBatchCommandResponseDto> {
    this.workflowGate.assertV2MutationAllowed('outbound_batch.shipment.exclude');
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');
    const response = await this.commands.execute(
      {
        commandType: 'outbound_batch.shipment.exclude',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, batchId, shipmentId, reason: dto.reason.trim() },
      },
      async (trx, commandRequestId) => {
        const aggregate = await this.lockEligibilityAggregate(shipmentId, trx);
        const [batch] = await trx
          .select({ id: wmsTables.outboundBatches.id })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, batchId))
          .limit(1);
        if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
        const [workItem] = await trx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
              eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
              inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
            ),
          )
          .limit(1)
          .for('update');
        if (!workItem)
          throw new NotFoundException(`Active work item for shipment ${shipmentId} not found in ${batchId}`);

        if (workItem.waitingOperationId) {
          await this.assertWaitingOperationOwnership(workItem.waitingOperationId, shipmentId, trx);
        }
        await this.assertExcludable(aggregate, trx);
        const now = await this.databaseNow(trx);
        const [excluded] = await trx
          .update(wmsTables.outboundBatchWorkItems)
          .set({
            status: 'excluded',
            exclusionReason: dto.reason.trim(),
            pickerReleasedAt: workItem.status === 'picking' ? now : workItem.pickerReleasedAt,
            packerReleasedAt: workItem.status === 'packing' ? now : workItem.packerReleasedAt,
            leaseExpiresAt: null,
            leaseVersion: workItem.leaseVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.id, workItem.id),
              eq(wmsTables.outboundBatchWorkItems.leaseVersion, workItem.leaseVersion),
              inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
            ),
          )
          .returning();
        if (!excluded) throw this.staleLease(workItem.id);

        await this.auditCommand(trx, actor, 'outbound_batch.shipment.exclude', excluded.id, {
          commandRequestId,
          batchId,
          shipmentId,
          reason: dto.reason.trim(),
          waitingOperationId: excluded.waitingOperationId,
        });
        const response = { operationId: commandRequestId, workItem: this.workItemResponse(excluded) };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: excluded.id };
      },
    );
    // The exclusion command is durable before a dependent cancellation/consolidation is resumed.
    // Replaying the command retries this exact resume without repeating the membership mutation.
    if (response.workItem.waitingOperationId) {
      await this.resumeWaitingOperationIfReady(response.workItem.waitingOperationId, shipmentId);
    }
    return response;
  }

  claimPicker(
    workItemId: string,
    dto: ClaimBatchWorkItemDto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<OutboundBatchCommandResponseDto> {
    return this.claim('picker', workItemId, dto, idempotencyKey, actor, tx);
  }

  claimPacker(
    workItemId: string,
    dto: ClaimBatchWorkItemDto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<OutboundBatchCommandResponseDto> {
    return this.claim('packer', workItemId, dto, idempotencyKey, actor, tx);
  }

  async handoff(
    workItemId: string,
    dto: HandoffBatchWorkItemDto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<OutboundBatchCommandResponseDto> {
    this.workflowGate.assertV2MutationAllowed('outbound_batch.work_item.handoff');
    if (!actor.roles.some((role) => role === 'logistics_manager' || role === 'master')) {
      throw new ForbiddenException('Only logistics_manager or master may name a handoff target');
    }
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');
    return this.commands.execute(
      {
        commandType: `outbound_batch.work_item.${dto.claimType}.handoff`,
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, workItemId, ...dto, reason: dto.reason.trim() },
      },
      async (trx, commandRequestId) => {
        await trx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${dto.claimType}:${dto.targetWorkerId}`}, 0))`,
        );
        const item = await this.loadWorkItem(workItemId, trx);
        this.assertLeaseVersion(item, dto.expectedLeaseVersion);
        const expectedStatus = dto.claimType === 'picker' ? 'picking' : 'packing';
        const owner = dto.claimType === 'picker' ? item.pickerId : item.packerId;
        if (item.status !== expectedStatus || !owner) {
          throw this.conflict(
            'WORK_ITEM_CLAIM_NOT_ACTIVE',
            `Work item ${workItemId} has no active ${dto.claimType} claim to hand off`,
          );
        }
        const now = await this.databaseNow(trx);
        await this.assertActorHasNoOtherActiveClaim(dto.claimType, dto.targetWorkerId, workItemId, trx);
        const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
        const updates =
          dto.claimType === 'picker'
            ? {
                pickerId: dto.targetWorkerId,
                pickerClaimedAt: now,
                pickerReleasedAt: null,
              }
            : {
                packerId: dto.targetWorkerId,
                packerClaimedAt: now,
                packerReleasedAt: null,
              };
        const [handedOff] = await trx
          .update(wmsTables.outboundBatchWorkItems)
          .set({
            ...updates,
            handedOffAt: now,
            leaseExpiresAt,
            leaseVersion: item.leaseVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.id, item.id),
              eq(wmsTables.outboundBatchWorkItems.status, expectedStatus),
              eq(wmsTables.outboundBatchWorkItems.leaseVersion, dto.expectedLeaseVersion),
              dto.claimType === 'picker'
                ? eq(wmsTables.outboundBatchWorkItems.pickerId, owner)
                : eq(wmsTables.outboundBatchWorkItems.packerId, owner),
            ),
          )
          .returning();
        if (!handedOff) throw this.staleLease(workItemId);

        await this.auditCommand(trx, actor, 'outbound_batch.work_item.handoff', handedOff.id, {
          commandRequestId,
          claimType: dto.claimType,
          fromWorkerId: owner,
          targetWorkerId: dto.targetWorkerId,
          reason: dto.reason.trim(),
          leaseVersion: handedOff.leaseVersion,
        });
        const response = { operationId: commandRequestId, workItem: this.workItemResponse(handedOff) };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: handedOff.id };
      },
      tx,
    );
  }

  async getEligibleShipments(batchId: string, tx?: DbTx): Promise<EligibleShipmentResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const candidates = await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(
          and(
            eq(wmsTables.shipments.warehouseId, batch.warehouseId),
            eq(wmsTables.shipments.status, 'planned'),
            sql`NOT EXISTS (
              SELECT 1 FROM outbound_batch_work_items wi
               WHERE wi.shipment_id = ${wmsTables.shipments.id}
                 AND wi.status NOT IN ('completed', 'excluded')
            )`,
          ),
        )
        .orderBy(asc(wmsTables.shipments.createdAt));

      const result: EligibleShipmentResponseDto[] = [];
      for (const candidate of candidates) {
        try {
          const aggregate = await this.loadEligibilityAggregate(candidate.id, trx);
          const eligible = await this.assertEligible(batch, aggregate, trx, false);
          result.push({
            shipmentId: aggregate.shipment.id,
            warehouseId: aggregate.shipment.warehouseId,
            shippingProfileId: aggregate.shipment.shippingProfileId!,
            manifestVersion: aggregate.shipment.manifestVersion,
            reservationVersion: aggregate.shipment.reservationVersion,
            recipientHash: canonicalShipmentRecipientHash(aggregate.shipment.recipientSnapshot),
            totalItems: aggregate.lines.length,
            totalQty: aggregate.lines.reduce((total, line) => total + line.qty, 0),
            invoiceId: eligible.invoiceId,
            trackingNo: eligible.trackingNo,
          });
        } catch (error) {
          if (
            error instanceof BadRequestException ||
            error instanceof ConflictException ||
            error instanceof NotFoundException
          ) {
            continue;
          }
          throw error;
        }
      }
      return result;
    }, tx);
  }

  async getWorkItems(batchId: string, tx?: DbTx): Promise<OutboundBatchWorkItemResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ id: wmsTables.outboundBatches.id })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const rows = await trx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
        .orderBy(asc(wmsTables.outboundBatchWorkItems.createdAt), asc(wmsTables.outboundBatchWorkItems.id));
      return rows.map((row) => this.workItemResponse(row));
    }, tx);
  }

  async getBatch(batchId: string, tx?: DbTx): Promise<OutboundBatchV2DetailDto> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const rows = await trx
        .select({ item: wmsTables.outboundBatchWorkItems, lineQty: wmsTables.shipmentLines.qty })
        .from(wmsTables.outboundBatchWorkItems)
        .leftJoin(
          wmsTables.shipmentLines,
          eq(wmsTables.shipmentLines.shipmentId, wmsTables.outboundBatchWorkItems.shipmentId),
        )
        .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
        .orderBy(asc(wmsTables.outboundBatchWorkItems.createdAt), asc(wmsTables.outboundBatchWorkItems.id));
      const items = new Map<string, WorkItemRow>();
      let totalItems = 0;
      let totalQty = 0;
      for (const row of rows) {
        items.set(row.item.id, row.item);
        if (!['completed', 'excluded'].includes(row.item.status) && row.lineQty != null) {
          totalItems += 1;
          totalQty += row.lineQty;
        }
      }
      const workItems = [...items.values()];
      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        name: batch.name ?? '',
        warehouseId: batch.warehouseId,
        pickingMethod: batch.pickingMethod,
        status: this.derivedBatchStatus(batch, workItems),
        totalItems,
        totalQty,
        scheduledPickingAt: batch.scheduledPickingAt ?? undefined,
        startedAt: batch.startedAt ?? undefined,
        completedAt: batch.completedAt ?? undefined,
        workItems: workItems.map((row) => this.workItemResponse(row)),
      };
    }, tx);
  }

  private async claim(
    claimType: 'picker' | 'packer',
    workItemId: string,
    dto: ClaimBatchWorkItemDto,
    idempotencyKey: string,
    actor: OutboundBatchActor,
    tx?: DbTx,
  ): Promise<OutboundBatchCommandResponseDto> {
    this.workflowGate.assertV2MutationAllowed(`outbound_batch.work_item.${claimType}.claim`);
    return this.commands.execute(
      {
        commandType: `outbound_batch.work_item.${claimType}.claim`,
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, workItemId, expectedLeaseVersion: dto.expectedLeaseVersion },
      },
      async (trx, commandRequestId) => {
        // Prevent one actor from racing claims on separate work items in separate transactions.
        await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${claimType}:${actor.id}`}, 0))`);
        const item = await this.loadWorkItem(workItemId, trx);
        this.assertLeaseVersion(item, dto.expectedLeaseVersion);
        await this.assertActorHasNoOtherActiveClaim(claimType, actor.id, workItemId, trx);
        const now = await this.databaseNow(trx);
        this.assertClaimable(claimType, item, actor.id, now);

        const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
        const expectedStatus: Array<WorkItemRow['status']> =
          claimType === 'picker' ? ['queued', 'picking'] : ['ready_to_pack', 'packing'];
        const updates =
          claimType === 'picker'
            ? {
                status: 'picking' as const,
                pickerId: actor.id,
                pickerClaimedAt: now,
                pickerReleasedAt: null,
                packerId: null,
                packerClaimedAt: null,
                packerReleasedAt: null,
              }
            : {
                status: 'packing' as const,
                pickerReleasedAt: item.pickerReleasedAt ?? now,
                packerId: actor.id,
                packerClaimedAt: now,
                packerReleasedAt: null,
              };
        const ownerPredicate =
          claimType === 'picker'
            ? sql`(${wmsTables.outboundBatchWorkItems.status} = 'queued'
                  OR ${wmsTables.outboundBatchWorkItems.pickerId} = ${actor.id}::uuid
                  OR ${wmsTables.outboundBatchWorkItems.leaseExpiresAt} <= CURRENT_TIMESTAMP)`
            : sql`(${wmsTables.outboundBatchWorkItems.status} = 'ready_to_pack'
                  OR ${wmsTables.outboundBatchWorkItems.packerId} = ${actor.id}::uuid
                  OR ${wmsTables.outboundBatchWorkItems.leaseExpiresAt} <= CURRENT_TIMESTAMP)`;
        const [claimed] = await trx
          .update(wmsTables.outboundBatchWorkItems)
          .set({
            ...updates,
            leaseExpiresAt,
            leaseVersion: item.leaseVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.id, item.id),
              eq(wmsTables.outboundBatchWorkItems.leaseVersion, dto.expectedLeaseVersion),
              inArray(wmsTables.outboundBatchWorkItems.status, expectedStatus),
              ownerPredicate,
            ),
          )
          .returning();
        if (!claimed) throw this.staleLease(workItemId);

        await this.auditCommand(trx, actor, `outbound_batch.work_item.${claimType}.claim`, claimed.id, {
          commandRequestId,
          workerId: actor.id,
          previousWorkerId: claimType === 'picker' ? item.pickerId : item.packerId,
          previousLeaseExpiresAt: item.leaseExpiresAt,
          reclaimed:
            Boolean(claimType === 'picker' ? item.pickerId : item.packerId) &&
            (claimType === 'picker' ? item.pickerId : item.packerId) !== actor.id,
          leaseVersion: claimed.leaseVersion,
          leaseExpiresAt,
        });
        const response = { operationId: commandRequestId, workItem: this.workItemResponse(claimed) };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: claimed.id };
      },
      tx,
    );
  }

  private async lockOpenBatch(batchId: string, tx: DbTx): Promise<BatchRow> {
    const [batch] = await tx
      .select()
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1)
      .for('update');
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    // Lock only active rows before deriving status. Terminal historical rows are immutable;
    // locking them can deadlock two concurrent re-adds that each already hold a different
    // excluded shipment component lock. A concurrent active-to-terminal transition is waited
    // on here, then the plain re-read below observes its committed terminal state.
    await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
      .for('update');
    const workItems = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
      .orderBy(asc(wmsTables.outboundBatchWorkItems.id));
    const status = this.derivedBatchStatus(batch, workItems);
    if (status === 'completed' || status === 'canceled') {
      throw this.conflict('OUTBOUND_BATCH_CLOSED', `Batch ${batchId} is ${status}`);
    }
    return batch;
  }

  private async assertNoActiveWorkItem(shipmentId: string, tx: DbTx): Promise<void> {
    const [activeWorkItem] = await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1);
    if (activeWorkItem) {
      throw this.conflict(
        'SHIPMENT_ACTIVE_WORK_ITEM',
        `Shipment ${shipmentId} already belongs to active work item ${activeWorkItem.id}`,
      );
    }
  }

  private async lockEligibilityAggregate(shipmentId: string, tx: DbTx): Promise<EligibilityAggregate> {
    const optimistic = await this.loadEligibilityAggregate(shipmentId, tx);
    await this.invariant.assertFulfillmentOrders(optimistic.fulfillmentOrderIds, tx);
    const locked = await this.loadEligibilityAggregate(shipmentId, tx);
    const signature = (aggregate: EligibilityAggregate) =>
      aggregate.lines.map((line) => `${line.id}:${line.fulfillmentOrderId}`).join(',');
    if (signature(optimistic) !== signature(locked)) {
      throw this.conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', 'Shipment component changed while acquiring locks');
    }
    return locked;
  }

  private async loadEligibilityAggregate(shipmentId: string, tx: DbTx): Promise<EligibilityAggregate> {
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        reservedQty: wmsTables.shipmentLines.reservedQty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
        fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
        stockType: wmsTables.skus.stockType,
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
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (!lines.length) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    return { shipment, lines, fulfillmentOrderIds: uniqueSorted(lines.map((line) => line.fulfillmentOrderId)) };
  }

  private async assertEligible(
    batch: BatchRow,
    aggregate: EligibilityAggregate,
    tx: DbTx,
    lockExecutionInputs = true,
  ): Promise<{ invoiceId: string; trackingNo: string }> {
    const shipment = aggregate.shipment;
    if (shipment.status !== 'planned') {
      throw this.conflict('SHIPMENT_NOT_PLANNED', `Shipment ${shipment.id} must be Planned before batching`);
    }
    if (shipment.warehouseId !== batch.warehouseId) {
      throw this.conflict('SHIPMENT_WRONG_WAREHOUSE', `Shipment ${shipment.id} belongs to another warehouse`);
    }
    if (!shipment.shippingProfileId) {
      throw this.conflict('SHIPMENT_PROFILE_REQUIRED', `Shipment ${shipment.id} has no shipping profile`);
    }
    this.assertRecipientComplete(shipment.recipientSnapshot);
    if (
      aggregate.lines.some(
        (line) =>
          line.fulfillmentMode === 'drop_ship' || line.stockType === 'drop_shipped' || line.reservedQty !== line.qty,
      )
    ) {
      throw this.conflict(
        'SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL',
        `Shipment ${shipment.id} must contain only fully reserved physical lines`,
      );
    }

    const profileQuery = tx
      .select()
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, shipment.shippingProfileId))
      .limit(1);
    const [profile] = await (lockExecutionInputs ? profileQuery.for('update') : profileQuery);
    if (!profile) throw new NotFoundException(`Shipping profile ${shipment.shippingProfileId} not found`);
    const modes = uniqueSorted(aggregate.lines.map((line) => line.fulfillmentMode ?? 'in_house'));
    if (
      !profile.supportedFulfillmentModes ||
      modes.some((mode) => !profile.supportedFulfillmentModes!.includes(mode as never))
    ) {
      throw this.conflict('SHIPMENT_PROFILE_INCOMPATIBLE', 'Shipping profile does not support fulfillment mode');
    }
    this.assertProfileComplete(profile);
    const skuIds = uniqueSorted(aggregate.lines.map((line) => line.skuId));
    const skuQuery = tx
      .select({
        id: wmsTables.skus.id,
        stockType: wmsTables.skus.stockType,
        deliveryProfileId: wmsTables.skus.deliveryProfileId,
      })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, skuIds))
      .orderBy(asc(wmsTables.skus.id));
    const skuRows = await (lockExecutionInputs ? skuQuery.for('update') : skuQuery);
    if (
      skuRows.length !== skuIds.length ||
      skuRows.some((sku) => sku.stockType === 'drop_shipped' || sku.deliveryProfileId !== shipment.shippingProfileId)
    ) {
      throw this.conflict(
        'SHIPMENT_PROFILE_INCOMPATIBLE',
        'Every physical SKU must still use the shipment shipping profile',
      );
    }

    const reservationRows = await tx
      .select({
        shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        skuId: wmsTables.stockReservations.skuId,
        warehouseId: wmsTables.stockReservations.warehouseId,
        quantity: wmsTables.stockReservations.quantity,
      })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(
            wmsTables.stockReservations.shipmentLineId,
            aggregate.lines.map((line) => line.id),
          ),
          eq(wmsTables.stockReservations.status, 'confirmed'),
          isNull(wmsTables.stockReservations.invalidatedAt),
        ),
      );
    const confirmedByLine = new Map<string, number>();
    const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
    for (const row of reservationRows) {
      if (row.shipmentLineId) {
        const line = lineById.get(row.shipmentLineId);
        if (!line || row.skuId !== line.skuId || row.warehouseId !== shipment.warehouseId) {
          throw this.conflict(
            'SHIPMENT_RESERVATION_IDENTITY_MISMATCH',
            `Reservation identity does not match shipment line ${row.shipmentLineId}`,
          );
        }
        confirmedByLine.set(row.shipmentLineId, (confirmedByLine.get(row.shipmentLineId) ?? 0) + row.quantity);
      }
    }
    if (aggregate.lines.some((line) => confirmedByLine.get(line.id) !== line.qty)) {
      throw this.conflict(
        'SHIPMENT_NOT_FULLY_RESERVED',
        `Shipment ${shipment.id} does not have confirmed reservations for its full manifest`,
      );
    }

    const [activeWork, attempt] = await Promise.all([
      tx
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.shipmentId, shipment.id),
            inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
          ),
        )
        .limit(1),
      tx
        .select({ id: wmsTables.dispatchAttempts.id })
        .from(wmsTables.dispatchAttempts)
        .where(
          and(
            eq(wmsTables.dispatchAttempts.shipmentId, shipment.id),
            ne(wmsTables.dispatchAttempts.status, 'recalled'),
          ),
        )
        .limit(1),
    ]);
    if (activeWork[0]) {
      throw this.conflict('SHIPMENT_ACTIVE_WORK_ITEM', `Shipment ${shipment.id} already has an active work item`);
    }
    if (attempt[0]) {
      throw this.conflict('SHIPMENT_DISPATCH_EXISTS', `Shipment ${shipment.id} already has a dispatch attempt`);
    }

    // assertFulfillmentOrders locked invoice rows before this validation, closing the add-vs-void TOCTOU window.
    const invoice = await this.invoices.assertDispatchableInvoice(shipment.id, tx);
    return { invoiceId: invoice.id, trackingNo: invoice.trackingNo };
  }

  private async assertExcludable(aggregate: EligibilityAggregate, tx: DbTx): Promise<void> {
    const [attempt, custody, plan, toteAssignment] = await Promise.all([
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
        .select({ id: wmsTables.shipmentToteAssignments.id })
        .from(wmsTables.shipmentToteAssignments)
        .where(
          and(
            eq(wmsTables.shipmentToteAssignments.shipmentId, aggregate.shipment.id),
            isNull(wmsTables.shipmentToteAssignments.releasedAt),
          ),
        )
        .limit(1),
    ]);
    if (attempt[0] || ['shipped', 'in_transit', 'delivered'].includes(aggregate.shipment.status)) {
      throw this.conflict('WORK_ITEM_DISPATCH_EXISTS', 'A dispatched shipment cannot be excluded from a batch');
    }
    if (custody[0] || aggregate.lines.some((line) => line.inspectedQty > 0)) {
      throw this.conflict(
        'WORK_ITEM_UNPICK_REQUIRED',
        'Shipment custody must be returned by the batch inventory session before exclusion',
      );
    }
    if (toteAssignment[0]) {
      throw this.conflict(
        'WORK_ITEM_TOTE_RELEASE_REQUIRED',
        'Active physical tote assignments must be released before exclusion',
      );
    }
    if (plan[0]) {
      throw this.conflict('WORK_ITEM_PICKING_PLAN_ACTIVE', 'Invalidate the active picking plan before exclusion');
    }
  }

  private async resumeWaitingOperationIfReady(operationId: string, shipmentId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const [operation] = await trx
        .select({ type: wmsTables.shipmentOperations.type, status: wmsTables.shipmentOperations.status })
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      if (!operation) {
        throw this.conflict('WORK_ITEM_WAITING_OPERATION_MISSING', `Waiting operation ${operationId} does not exist`);
      }
      if (operation.status === 'completed') return;
      if (operation.status !== 'pending') {
        throw this.conflict(
          'WORK_ITEM_WAITING_OPERATION_INVALID',
          `Waiting operation ${operationId} is ${operation.status}`,
        );
      }
      if (operation.type === 'cancel') {
        const [invoice, plan, custody] = await Promise.all([
          trx
            .select({ id: wmsTables.invoices.id })
            .from(wmsTables.invoices)
            .where(
              and(eq(wmsTables.invoices.shipmentId, shipmentId), notInArray(wmsTables.invoices.status, ['voided'])),
            )
            .limit(1),
          trx
            .select({ id: wmsTables.pickingPlans.id })
            .from(wmsTables.pickingPlanMembers)
            .innerJoin(wmsTables.pickingPlans, eq(wmsTables.pickingPlans.id, wmsTables.pickingPlanMembers.planId))
            .where(
              and(
                eq(wmsTables.pickingPlanMembers.shipmentId, shipmentId),
                isNull(wmsTables.pickingPlanMembers.retiredAt),
                inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
              ),
            )
            .limit(1),
          trx
            .select({ id: wmsTables.batchInventorySessionBalances.id })
            .from(wmsTables.batchInventorySessionBalances)
            .innerJoin(
              wmsTables.shipmentLines,
              eq(wmsTables.shipmentLines.id, wmsTables.batchInventorySessionBalances.shipmentLineId),
            )
            .where(
              and(
                eq(wmsTables.shipmentLines.shipmentId, shipmentId),
                gt(wmsTables.batchInventorySessionBalances.qty, 0),
                ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
              ),
            )
            .limit(1),
        ]);
        if (invoice[0] || plan[0] || custody[0]) return;
        await this.moduleRef
          .get(ShipmentPlanningService, { strict: false })
          .resumePendingCancellation(operationId, trx);
        return;
      }
      if (operation.type === 'consolidate') {
        await this.moduleRef.get(ConsolidationService, { strict: false }).resumePending(operationId, trx);
        return;
      }
      throw this.conflict(
        'WORK_ITEM_WAITING_OPERATION_UNSUPPORTED',
        `No exact work-item resume handler is registered for ${operation.type}`,
      );
    }, tx);
  }

  private async assertWaitingOperationOwnership(operationId: string, shipmentId: string, tx: DbTx): Promise<void> {
    const [row] = await tx
      .select({
        type: wmsTables.shipmentOperations.type,
        status: wmsTables.shipmentOperations.status,
        shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
      })
      .from(wmsTables.shipmentOperations)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperations.id, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
        ),
      )
      .limit(1);
    if (!row || !['cancel', 'consolidate'].includes(row.type) || !['pending', 'completed'].includes(row.status)) {
      throw this.conflict(
        'WORK_ITEM_WAITING_OPERATION_CONFLICT',
        `Work item cannot wait for foreign or unsupported operation ${operationId}`,
      );
    }
  }

  private async loadWorkItem(workItemId: string, tx: DbTx): Promise<WorkItemRow> {
    const [item] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
      .limit(1);
    if (!item) throw new NotFoundException(`Outbound batch work item ${workItemId} not found`);
    return item;
  }

  private assertClaimable(claimType: 'picker' | 'packer', item: WorkItemRow, actorId: string, dbNow: Date): void {
    const initialStatus = claimType === 'picker' ? 'queued' : 'ready_to_pack';
    const activeStatus = claimType === 'picker' ? 'picking' : 'packing';
    const owner = claimType === 'picker' ? item.pickerId : item.packerId;
    if (item.status === initialStatus) return;
    if (item.status === activeStatus && owner === actorId) return;
    if (
      item.status === activeStatus &&
      owner !== actorId &&
      item.leaseExpiresAt &&
      item.leaseExpiresAt.getTime() <= dbNow.getTime()
    ) {
      return;
    }
    if (item.status === activeStatus && owner !== actorId) {
      throw this.conflict(
        'WORK_ITEM_HANDOFF_REQUIRED',
        `Work item ${item.id} is assigned to another ${claimType}; lease expiry alone cannot transfer custody`,
      );
    }
    throw this.conflict('WORK_ITEM_NOT_CLAIMABLE', `Work item ${item.id} is ${item.status}`);
  }

  private async assertActorHasNoOtherActiveClaim(
    claimType: 'picker' | 'packer',
    actorId: string,
    workItemId: string,
    tx: DbTx,
  ): Promise<void> {
    const [other] = await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          ne(wmsTables.outboundBatchWorkItems.id, workItemId),
          eq(wmsTables.outboundBatchWorkItems.status, claimType === 'picker' ? 'picking' : 'packing'),
          claimType === 'picker'
            ? eq(wmsTables.outboundBatchWorkItems.pickerId, actorId)
            : eq(wmsTables.outboundBatchWorkItems.packerId, actorId),
          or(
            isNull(wmsTables.outboundBatchWorkItems.leaseExpiresAt),
            sql`${wmsTables.outboundBatchWorkItems.leaseExpiresAt} > CURRENT_TIMESTAMP`,
          ),
        ),
      )
      .limit(1);
    if (other) {
      throw this.conflict(
        'WORKER_ACTIVE_CLAIM_EXISTS',
        `Worker ${actorId} already owns active ${claimType} work item ${other.id}`,
      );
    }
  }

  private workItemResponse(item: WorkItemRow): OutboundBatchWorkItemResponseDto {
    return {
      ...item,
      pickerClaim: this.claimState(
        item.status === 'picking',
        item.pickerId,
        item.pickerClaimedAt,
        item.pickerReleasedAt,
        item.leaseExpiresAt,
      ),
      packerClaim: this.claimState(
        item.status === 'packing',
        item.packerId,
        item.packerClaimedAt,
        item.packerReleasedAt,
        item.leaseExpiresAt,
      ),
    };
  }

  private claimState(
    roleActive: boolean,
    workerId: string | null,
    claimedAt: Date | null,
    releasedAt: Date | null,
    leaseExpiresAt: Date | null,
  ) {
    const state = !workerId
      ? ('unclaimed' as const)
      : !roleActive || releasedAt
        ? ('released' as const)
        : !leaseExpiresAt || leaseExpiresAt.getTime() <= Date.now()
          ? ('expired' as const)
          : ('active' as const);
    return { state, workerId, claimedAt, releasedAt, leaseExpiresAt: roleActive ? leaseExpiresAt : null };
  }

  private derivedBatchStatus(batch: BatchRow, items: WorkItemRow[]): 'created' | 'picking' | 'completed' | 'canceled' {
    if (batch.status === 'completed' || batch.status === 'canceled') return batch.status;
    const included = items.filter((item) => item.status !== 'excluded');
    if (!included.length) return 'created';
    if (included.every((item) => TERMINAL_FOR_BATCH_STATUSES.includes(item.status as never))) return 'completed';
    if (included.some((item) => item.status !== 'queued')) return 'picking';
    return 'created';
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

  private assertProfileComplete(profile: typeof wmsTables.deliveryProfiles.$inferSelect): void {
    const snapshots = [profile.senderSnapshot, profile.originAddressSnapshot, profile.returnAddressSnapshot];
    const sender = (profile.senderSnapshot ?? {}) as Record<string, unknown>;
    const senderName = sender.name ?? sender.senderName;
    const senderPhone = sender.phone ?? sender.senderPhone;
    if (
      snapshots.some(
        (snapshot) =>
          !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0,
      ) ||
      typeof senderName !== 'string' ||
      !senderName.trim() ||
      typeof senderPhone !== 'string' ||
      !senderPhone.trim() ||
      !profile.carrierAccountRef?.trim()
    ) {
      throw this.conflict(
        'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
        'Shipping profile execution snapshots and carrier account are required',
      );
    }
  }

  private assertLeaseVersion(item: WorkItemRow, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 0 || item.leaseVersion !== expected) {
      throw this.staleLease(item.id);
    }
  }

  private async databaseNow(tx: DbTx): Promise<Date> {
    const rows = await tx.execute<{ now: Date }>(sql`SELECT CURRENT_TIMESTAMP AS now`);
    const now = (rows as unknown as Array<{ now: Date }>)[0]?.now;
    if (!now) throw new Error('Database clock unavailable');
    return now instanceof Date ? now : new Date(now);
  }

  private async auditCommand(
    tx: DbTx,
    actor: OutboundBatchActor,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.logUserActionRequired(
      action,
      'fulfillment',
      `${action} applied to ${resourceId}`,
      { userId: actor.id },
      { resourceId, ...metadata },
      tx,
    );
  }

  private isActiveWorkItemUniqueViolation(error: unknown): boolean {
    const row = error as { code?: string; constraint_name?: string; constraint?: string };
    return (
      row?.code === '23505' &&
      (row.constraint_name === 'uq_outbound_work_item_active_shipment' ||
        row.constraint === 'uq_outbound_work_item_active_shipment')
    );
  }

  private staleLease(workItemId: string): ConflictException {
    return this.conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${workItemId} claim version changed`);
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
