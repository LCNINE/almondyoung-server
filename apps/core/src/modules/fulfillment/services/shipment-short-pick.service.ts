import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ReportShipmentShortPickDto,
  SHIPMENT_SHORT_PICK_REASONS,
  ShipmentShortPickActor,
  ShipmentShortPickReason,
  ShipmentShortPickResponseDto,
} from '../dto/shipment-short-pick.dto';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { InvoiceOrchestrator } from './invoice-orchestrator.service';
import { BatchInventorySessionService, BatchInventoryBucket } from './batch-inventory-session.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ToteLifecycleService } from './tote-lifecycle.service';

const SHORT_PICK_WORK_ITEM_STATUSES = ['picking', 'ready_to_pack', 'packing', 'completed'] as const;
const SHORT_PICK_ACTIVE_INVOICE_STATUSES = ['issued', 'used', 'issuing', 'voiding', 'recovery_required'] as const;

type ShortPickLineIntent = {
  shipmentLineId: string;
  sourceLocationId: string;
  expectedLineVersion: number;
  shortQty: number;
  allocationQty: number;
};
type ShortPickIntent = {
  kind: 'short_pick';
  operationId: string;
  shipmentId: string;
  workItemId: string;
  planId: string;
  sessionId: string;
  reason: ShipmentShortPickReason;
  actorId: string;
  lines: ShortPickLineIntent[];
};

type ShortPickSessionPort = {
  approveShortage(
    input: {
      sessionId: string;
      idempotencyKey: string;
      shortPickOperationId: string;
      shipmentLineId: string;
      quantity: number;
      from: BatchInventoryBucket;
      reasonCode: 'MISSING' | 'DAMAGED' | 'DEFECTIVE';
      reason: string;
      approverId: string;
    },
    tx: DbTx,
  ): Promise<unknown>;
  returnShortPickCustody(
    input: {
      sessionId: string;
      idempotencyKey: string;
      shortPickOperationId: string;
      shipmentLineId: string;
      quantity: number;
      from: BatchInventoryBucket;
      reason: string;
      actorId: string;
    },
    tx: DbTx,
  ): Promise<unknown>;
};

type ShortPickReservationPort = {
  lockShipmentGraphForDispatch(shipmentId: string, tx: DbTx): Promise<void>;
  invalidateForShortPick(
    shipmentLineId: string,
    quantity: number,
    shortPickOperationId: string,
    tx: DbTx,
  ): Promise<unknown>;
};

type ShortPickPlanningPort = {
  retirePickingPlanMemberForShortPick(
    input: {
      planId: string;
      shipmentId: string;
      operationId: string;
      reason: string;
    },
    tx: DbTx,
  ): Promise<unknown>;
};

@Injectable()
export class ShipmentShortPickService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    @Inject(forwardRef(() => InvoiceOrchestrator)) private readonly invoices: InvoiceOrchestrator,
    @Inject(BatchInventorySessionService) private readonly session: ShortPickSessionPort,
    @Inject(ShipmentReservationService) private readonly reservations: ShortPickReservationPort,
    @Inject(ShipmentPlanningService) private readonly planning: ShortPickPlanningPort,
    private readonly totes: ToteLifecycleService,
  ) {}

  async report(
    shipmentId: string,
    dto: ReportShipmentShortPickDto,
    idempotencyKey: string,
    actor: ShipmentShortPickActor,
  ): Promise<ShipmentShortPickResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.short_pick.report');
    this.assertDto(dto);
    await this.requireScope(actor);
    const response = await this.commands.execute<ShipmentShortPickResponseDto>(
      {
        commandType: 'shipment.short_pick.report',
        idempotencyKey,
        canonicalRequest: { shipmentId, actorId: actor.id, ...dto },
      },
      async (tx, _commandRequestId, requestHash) => {
        const operationId = randomUUID();
        const intent: ShortPickIntent = {
          kind: 'short_pick',
          operationId,
          shipmentId,
          workItemId: dto.workItemId,
          planId: dto.planId,
          sessionId: dto.sessionId,
          reason: dto.reason,
          actorId: actor.id,
          lines: [...dto.lines]
            .map((line) => ({ ...line, allocationQty: 0 }))
            .sort((left, right) =>
              `${left.shipmentLineId}:${left.sourceLocationId}`.localeCompare(
                `${right.shipmentLineId}:${right.sourceLocationId}`,
              ),
            ),
        };
        // Canonical order: shared shipment graph first, then durable
        // intent/member, then work/plan/session/custody/totes. A member insert
        // is not lock-free — its shipment FK takes KEY SHARE — so it must
        // follow the FOI -> shipment -> line -> reservation graph order.
        // Otherwise two distinct-key operations can each hold that FK lock
        // while one owns the FOI row, forming FOI -> shipment vs shipment -> FOI.
        await this.reservations.lockShipmentGraphForDispatch(shipmentId, tx);
        await tx.insert(wmsTables.shipmentOperations).values({
          id: operationId,
          type: 'short_pick',
          status: 'pending',
          operatorId: actor.id,
          reason: dto.reason,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          beforeManifestSnapshot: { intent },
        });
        await tx.insert(wmsTables.shipmentOperationMembers).values({
          operationId,
          shipmentId,
          role: 'source',
          beforeManifestVersion: dto.expectedManifestVersion,
          beforeManifestSnapshot: { expectedManifestVersion: dto.expectedManifestVersion },
        });

        const shipmentContext = await this.lockAndValidateShipment(shipmentId, dto, tx);
        const requestedByPair = new Map(
          dto.lines.map((line) => [`${line.shipmentLineId}:${line.sourceLocationId}`, line] as const),
        );
        const versionByLine = new Map(shipmentContext.lines.map((line) => [line.id, line.lineVersion]));
        intent.lines = shipmentContext.allocations.map((allocation) => {
          const requested = requestedByPair.get(`${allocation.shipmentLineId}:${allocation.sourceLocationId}`);
          return {
            shipmentLineId: allocation.shipmentLineId,
            sourceLocationId: allocation.sourceLocationId,
            expectedLineVersion: versionByLine.get(allocation.shipmentLineId)!,
            shortQty: requested?.shortQty ?? 0,
            allocationQty: allocation.qty,
          };
        });
        const activeInvoices = await tx
          .select({ id: wmsTables.invoices.id, status: wmsTables.invoices.status })
          .from(wmsTables.invoices)
          .where(
            and(
              eq(wmsTables.invoices.shipmentId, shipmentId),
              inArray(wmsTables.invoices.status, [...SHORT_PICK_ACTIVE_INVOICE_STATUSES]),
            ),
          )
          .orderBy(asc(wmsTables.invoices.id))
          .for('update');
        if (activeInvoices.length > 1) {
          throw this.conflict('SHORT_PICK_INVOICE_AMBIGUOUS', 'Shipment has multiple active invoices');
        }
        const invoice = activeInvoices[0];
        if (invoice?.status === 'used') {
          throw this.conflict('SHORT_PICK_DISPATCH_EXISTS', 'A used invoice cannot enter short-pick recovery');
        }
        let invoiceOperationId: string | null = null;
        if (invoice?.status === 'issued') {
          // The exact void operation is durably owned by InvoiceOrchestrator. Any
          // retry after this command commits must lease that same operation; a
          // second short-pick report must never infer or create another void.
          const invoiceOperation = await this.invoices.void(
            invoice.id,
            {
              reason: `short_pick:${dto.reason}`,
              resumeOperationId: operationId,
              csCaseId: dto.csCaseId,
              note: dto.note,
            },
            `${idempotencyKey}:invoice-void`,
            actor,
            tx,
          );
          invoiceOperationId = invoiceOperation.operationId;
        } else if (invoice) {
          throw this.conflict(
            'SHORT_PICK_INVOICE_NOT_VOIDABLE',
            `Invoice ${invoice.id} is ${invoice.status}; retry its existing durable invoice operation first`,
          );
        }
        const physicalContext = await this.lockAndValidatePhysical(shipmentId, dto, tx);
        const context = { ...shipmentContext, ...physicalContext };
        const [quarantinedShipment] = await tx
          .update(wmsTables.shipments)
          .set({ status: 'recovery_required', recoveryCode: 'SHORT_PICK_PENDING', lastUpdated: new Date() })
          .where(
            and(
              eq(wmsTables.shipments.id, shipmentId),
              eq(wmsTables.shipments.status, 'planned'),
              eq(wmsTables.shipments.manifestVersion, dto.expectedManifestVersion),
            ),
          )
          .returning({ id: wmsTables.shipments.id });
        if (!quarantinedShipment) {
          throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', 'Shipment changed before short-pick quarantine');
        }
        await tx
          .update(wmsTables.shipmentOperations)
          .set({
            beforeManifestSnapshot: {
              intent,
              shipment: context.shipment,
              workItem: context.workItem,
              plan: context.plan,
              session: context.session,
              lines: context.lines,
            },
          })
          .where(eq(wmsTables.shipmentOperations.id, operationId));
        await this.quarantineWorkItem(context.workItem, operationId, dto.reason, tx);
        await this.reconcileAffectedCustody(intent, tx);
        for (const [shipmentLineId, quantity] of this.shortQtyByLine(intent.lines)) {
          await this.reservations.invalidateForShortPick(shipmentLineId, quantity, operationId, tx);
        }
        const toteResult = await this.totes.releaseEmptyAssignmentsForShipment({ shipmentId, operationId }, tx);
        await this.audit.logUserActionRequired(
          'shipment.short_pick.reported',
          'fulfillment',
          `Short pick operation ${operationId} reported for shipment ${shipmentId}`,
          { userId: actor.id },
          {
            operationId,
            shipmentId,
            reason: dto.reason,
            exactVersions: {
              manifest: dto.expectedManifestVersion,
              workItemLease: dto.expectedWorkItemLeaseVersion,
              plan: dto.expectedPlanVersion,
              session: dto.expectedSessionVersion,
              lines: intent.lines,
            },
            releasedToteAssignmentIds: toteResult.releasedAssignmentIds,
            retainedToteIds: toteResult.retainedToteIds,
          },
          tx,
        );

        let operationStatus: ShipmentShortPickResponseDto['operationStatus'];
        if (!invoiceOperationId) {
          await this.resumePending(operationId, tx);
          operationStatus = 'completed';
        } else {
          operationStatus = 'pending';
        }
        return {
          response: {
            operationId,
            shipmentId,
            operationStatus,
            invoiceOperationId,
            workItemId: dto.workItemId,
          },
          resourceType: 'shipment_operation',
          resourceId: operationId,
          operationId,
        };
      },
    );
    return this.currentResponse(response.operationId, response);
  }

  async resumePending(operationId: string, tx?: DbTx): Promise<ShipmentShortPickResponseDto> {
    if (tx) return this.resumePendingInTransaction(operationId, tx);
    try {
      return await this.dbService.run((trx) => this.resumePendingInTransaction(operationId, trx));
    } catch (error) {
      await this.dbService.run((trx) => this.markRecoveryRequired(operationId, error, trx));
      throw error;
    }
  }

  private async resumePendingInTransaction(operationId: string, tx: DbTx): Promise<ShipmentShortPickResponseDto> {
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
    if (!operation || operation.type !== 'short_pick')
      throw new NotFoundException(`Short pick operation ${operationId} not found`);
    const intent = this.intent(operation.snapshot);
    const [sourceMember] = await tx
      .select({ shipmentId: wmsTables.shipmentOperationMembers.shipmentId })
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1)
      .for('update');
    if (sourceMember?.shipmentId !== intent.shipmentId) {
      throw this.conflict('SHORT_PICK_OPERATION_MEMBER_MISMATCH', 'Short-pick source member differs from intent');
    }
    if (operation.status === 'completed') return this.currentResponse(operationId, undefined, tx);
    if (!['pending', 'recovery_required'].includes(operation.status)) {
      throw this.conflict('SHORT_PICK_OPERATION_NOT_RESUMABLE', `Short pick operation is ${operation.status}`);
    }

    await this.reservations.lockShipmentGraphForDispatch(intent.shipmentId, tx);
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, intent.shipmentId))
      .limit(1)
      .for('update');
    if (!shipment) throw new NotFoundException(`Shipment ${intent.shipmentId} not found`);
    const activeInvoices = await tx
      .select({ id: wmsTables.invoices.id, status: wmsTables.invoices.status })
      .from(wmsTables.invoices)
      .where(and(eq(wmsTables.invoices.shipmentId, intent.shipmentId), ne(wmsTables.invoices.status, 'voided')))
      .orderBy(asc(wmsTables.invoices.id))
      .for('update');
    if (shipment.status !== 'recovery_required' || shipment.recoveryCode !== 'SHORT_PICK_PENDING') {
      throw this.conflict('SHORT_PICK_SHIPMENT_NOT_RECOVERING', 'Shipment is not in exact short-pick recovery state');
    }
    if (activeInvoices.length) {
      throw this.conflict('SHORT_PICK_INVOICE_NOT_VOIDED', 'Short-pick recovery cannot finalize before invoice void');
    }
    const [workItem] = await tx
      .select({
        id: wmsTables.outboundBatchWorkItems.id,
        status: wmsTables.outboundBatchWorkItems.status,
        waitingOperationId: wmsTables.outboundBatchWorkItems.waitingOperationId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, intent.workItemId))
      .limit(1)
      .for('update');
    if (workItem?.status !== 'short_pick_recovery' || workItem.waitingOperationId !== operationId) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_STALE', 'Recovery work item changed');
    }
    const [plan] = await tx
      .select({ id: wmsTables.pickingPlans.id })
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, intent.planId))
      .limit(1)
      .for('update');
    if (!plan) throw new NotFoundException(`Picking plan ${intent.planId} not found`);
    const [session] = await tx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, intent.sessionId))
      .limit(1)
      .for('update');
    if (!session) throw new NotFoundException(`Inventory session ${intent.sessionId} not found`);
    await this.assertNoPositiveCustody(intent, tx);
    await this.planning.retirePickingPlanMemberForShortPick(
      { planId: intent.planId, shipmentId: intent.shipmentId, operationId, reason: intent.reason },
      tx,
    );
    await this.totes.releaseEmptyAssignmentsForShipment({ shipmentId: intent.shipmentId, operationId }, tx);
    await tx
      .update(wmsTables.shipmentLines)
      .set({ inspectedQty: 0, lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1` })
      .where(eq(wmsTables.shipmentLines.shipmentId, intent.shipmentId));
    const [updatedShipment] = await tx
      .update(wmsTables.shipments)
      .set({
        status: 'draft',
        recoveryCode: null,
        plannedAt: null,
        manifestVersion: shipment.manifestVersion + 1,
        lastUpdated: new Date(),
      })
      .where(
        and(
          eq(wmsTables.shipments.id, shipment.id),
          eq(wmsTables.shipments.status, 'recovery_required'),
          eq(wmsTables.shipments.recoveryCode, 'SHORT_PICK_PENDING'),
          eq(wmsTables.shipments.manifestVersion, shipment.manifestVersion),
        ),
      )
      .returning();
    if (!updatedShipment) throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', 'Shipment changed during resume');
    const [excluded] = await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({
        status: 'excluded',
        exclusionReason: `short_pick:${intent.reason}`,
        recoveryReason: null,
        waitingOperationId: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.id, intent.workItemId),
          eq(wmsTables.outboundBatchWorkItems.waitingOperationId, operationId),
          eq(wmsTables.outboundBatchWorkItems.status, 'short_pick_recovery'),
        ),
      )
      .returning({ id: wmsTables.outboundBatchWorkItems.id });
    if (!excluded) throw this.conflict('SHORT_PICK_WORK_ITEM_STALE', 'Recovery work item changed');
    const after = { shipment: updatedShipment, retiredWorkItemId: intent.workItemId };
    await tx
      .update(wmsTables.shipmentOperationMembers)
      .set({ afterManifestVersion: updatedShipment.manifestVersion, afterManifestSnapshot: after })
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, intent.shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      );
    await tx
      .update(wmsTables.shipmentOperations)
      .set({ status: 'completed', afterManifestSnapshot: after, lastError: null, completedAt: new Date() })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
    await this.audit.logUserActionRequired(
      'shipment.short_pick.completed',
      'fulfillment',
      `Short pick operation ${operationId} returned shipment ${intent.shipmentId} to Draft`,
      { userId: intent.actorId },
      { operationId, shipmentId: intent.shipmentId, workItemId: intent.workItemId, after },
      tx,
    );
    return this.currentResponse(operationId, undefined, tx);
  }

  async markInvoiceRecoveryRequired(operationId: string, error: unknown, tx: DbTx): Promise<void> {
    await this.markRecoveryRequired(operationId, error, tx);
  }

  private async lockAndValidateShipment(shipmentId: string, dto: ReportShipmentShortPickDto, tx: DbTx) {
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1)
      .for('update');
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (shipment.status !== 'planned')
      throw this.conflict('SHORT_PICK_SHIPMENT_NOT_PLANNED', 'Shipment must be Planned');
    if (shipment.manifestVersion !== dto.expectedManifestVersion) {
      throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', 'Shipment manifest version changed');
    }
    const dispatch = await tx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(
        and(eq(wmsTables.dispatchAttempts.shipmentId, shipmentId), ne(wmsTables.dispatchAttempts.status, 'recalled')),
      )
      .limit(1)
      .for('update');
    if (dispatch.length)
      throw this.conflict('SHORT_PICK_DISPATCH_EXISTS', 'A dispatched shipment cannot be short-picked');

    const requestedIds = [...new Set(dto.lines.map((line) => line.shipmentLineId))].sort();
    const sourcePairs = new Set(dto.lines.map((line) => `${line.shipmentLineId}:${line.sourceLocationId}`));
    if (sourcePairs.size !== dto.lines.length) {
      throw new BadRequestException('Short-pick shipmentLineId/sourceLocationId pairs must be unique');
    }
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id))
      .for('update');
    const loadedIds = new Set(lines.map((line) => line.id));
    if (lines.length === 0 || requestedIds.some((id) => !loadedIds.has(id))) {
      throw this.conflict('SHORT_PICK_LINE_MISMATCH', 'Every short-pick line must belong to the shipment');
    }
    const requestedById = new Map<string, ReportShipmentShortPickDto['lines'][number]>();
    for (const requested of dto.lines) {
      const existing = requestedById.get(requested.shipmentLineId);
      if (existing && existing.expectedLineVersion !== requested.expectedLineVersion) {
        throw new BadRequestException(`Line ${requested.shipmentLineId} must use one expectedLineVersion`);
      }
      requestedById.set(requested.shipmentLineId, requested);
    }
    for (const line of lines) {
      const requested = requestedById.get(line.id);
      if (!requested) continue;
      if (line.lineVersion !== requested.expectedLineVersion) {
        throw this.conflict('SHORT_PICK_LINE_STALE', `Shipment line ${line.id} version changed`);
      }
      const totalShortQty = dto.lines
        .filter((entry) => entry.shipmentLineId === line.id)
        .reduce((sum, entry) => sum + entry.shortQty, 0);
      if (totalShortQty > line.qty) throw new BadRequestException(`shortQty exceeds line ${line.id} quantity`);
    }
    const allocations = await tx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, dto.planId),
          inArray(
            wmsTables.pickingSourceAllocations.shipmentLineId,
            lines.map((line) => line.id),
          ),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      )
      .for('update');
    const allocationByPair = new Map(
      allocations.map((row) => [`${row.shipmentLineId}:${row.sourceLocationId}`, row] as const),
    );
    for (const requested of dto.lines) {
      const allocation = allocationByPair.get(`${requested.shipmentLineId}:${requested.sourceLocationId}`);
      if (!allocation || requested.shortQty > allocation.qty) {
        throw this.conflict(
          'SHORT_PICK_ALLOCATION_MISMATCH',
          `Short quantity exceeds persisted allocation for ${requested.shipmentLineId}/${requested.sourceLocationId}`,
        );
      }
    }
    return { shipment, lines, allocations };
  }

  private async lockAndValidatePhysical(shipmentId: string, dto: ReportShipmentShortPickDto, tx: DbTx) {
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, dto.workItemId))
      .limit(1)
      .for('update');
    if (!workItem || workItem.shipmentId !== shipmentId) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_MISMATCH', 'Work item mismatch');
    }
    if (!SHORT_PICK_WORK_ITEM_STATUSES.includes(workItem.status as (typeof SHORT_PICK_WORK_ITEM_STATUSES)[number])) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_STATE', `Work item is ${workItem.status}`);
    }
    if (workItem.leaseVersion !== dto.expectedWorkItemLeaseVersion) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_STALE', 'Work item lease version changed');
    }
    const [plan] = await tx
      .select()
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, dto.planId))
      .limit(1)
      .for('update');
    if (
      !plan ||
      plan.batchId !== workItem.batchId ||
      plan.version !== dto.expectedPlanVersion ||
      plan.status !== 'active'
    ) {
      throw this.conflict('SHORT_PICK_PLAN_STALE', 'Picking plan identity/version is invalid');
    }
    const member = await tx
      .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
      .from(wmsTables.pickingPlanMembers)
      .where(
        and(
          eq(wmsTables.pickingPlanMembers.planId, dto.planId),
          eq(wmsTables.pickingPlanMembers.shipmentId, shipmentId),
          isNull(wmsTables.pickingPlanMembers.retiredAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!member.length) throw this.conflict('SHORT_PICK_PLAN_MEMBER_MISSING', 'Shipment is not an active plan member');
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, dto.sessionId))
      .limit(1)
      .for('update');
    if (
      !session ||
      session.batchId !== workItem.batchId ||
      session.version !== dto.expectedSessionVersion ||
      !['active', 'recovery_required'].includes(session.status)
    ) {
      throw this.conflict('SHORT_PICK_SESSION_STALE', 'Inventory session identity/version is invalid');
    }
    const startEvents = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, dto.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        ),
      );
    if (
      startEvents.length === 0 ||
      startEvents.some((event) => (event.payload as { planId?: unknown } | null)?.planId !== dto.planId)
    ) {
      throw this.conflict('SHORT_PICK_SESSION_PLAN_MISMATCH', 'Inventory session does not belong to the exact plan');
    }
    return { workItem, plan, session };
  }

  private async quarantineWorkItem(
    workItem: typeof wmsTables.outboundBatchWorkItems.$inferSelect,
    operationId: string,
    reason: string,
    tx: DbTx,
  ): Promise<void> {
    const [updated] = await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({
        status: 'short_pick_recovery',
        pickerId: null,
        pickerClaimedAt: null,
        pickerReleasedAt: null,
        packerId: null,
        packerClaimedAt: null,
        packerReleasedAt: null,
        leaseExpiresAt: null,
        leaseVersion: workItem.leaseVersion + 1,
        completedAt: null,
        recoveryReason: reason,
        waitingOperationId: operationId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.id, workItem.id),
          eq(wmsTables.outboundBatchWorkItems.leaseVersion, workItem.leaseVersion),
        ),
      )
      .returning({ id: wmsTables.outboundBatchWorkItems.id });
    if (!updated) throw this.conflict('SHORT_PICK_WORK_ITEM_STALE', 'Work item changed while entering recovery');
  }

  private async reconcileAffectedCustody(intent: ShortPickIntent, tx: DbTx): Promise<void> {
    for (const line of intent.lines) {
      const [shipmentLine] = await tx
        .select({ skuId: wmsTables.shipmentLines.skuId })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, line.shipmentLineId))
        .limit(1);
      if (!shipmentLine) throw new NotFoundException(`Shipment line ${line.shipmentLineId} not found`);
      const attributed = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, intent.sessionId),
            eq(wmsTables.batchInventorySessionBalances.shipmentLineId, line.shipmentLineId),
            eq(wmsTables.batchInventorySessionBalances.sourceLocationId, line.sourceLocationId),
            gt(wmsTables.batchInventorySessionBalances.qty, 0),
          ),
        )
        .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
        .for('update');
      const attributedQty = attributed.reduce((sum, balance) => sum + balance.qty, 0);
      if (attributedQty > line.allocationQty) {
        throw this.conflict(
          'SHORT_PICK_CUSTODY_EXCEEDS_ALLOCATION',
          `Attributed custody exceeds allocation for ${line.shipmentLineId}/${line.sourceLocationId}`,
        );
      }
      let shortageRemaining = line.shortQty;
      let allocationRemaining = line.allocationQty;
      for (const balance of attributed) {
        const from: BatchInventoryBucket = {
          skuId: balance.skuId,
          sourceLocationId: balance.sourceLocationId!,
          custodyType: balance.custodyType,
          custodyRef: balance.custodyRef,
          shipmentLineId: balance.shipmentLineId,
        };
        const terminalQty = Math.min(allocationRemaining, balance.qty);
        const shortageQty = Math.min(shortageRemaining, terminalQty);
        if (shortageQty > 0) {
          await this.session.approveShortage(
            {
              sessionId: intent.sessionId,
              idempotencyKey: `${intent.operationId}:${line.shipmentLineId}:${balance.id}:shortage`,
              shortPickOperationId: intent.operationId,
              shipmentLineId: line.shipmentLineId,
              quantity: shortageQty,
              from,
              reasonCode: this.reasonCode(intent.reason),
              reason: intent.reason,
              approverId: intent.actorId,
            },
            tx,
          );
          shortageRemaining -= shortageQty;
        }
        const returnQty = terminalQty - shortageQty;
        if (returnQty > 0) {
          await this.session.returnShortPickCustody(
            {
              sessionId: intent.sessionId,
              idempotencyKey: `${intent.operationId}:${line.shipmentLineId}:${balance.id}:return`,
              shortPickOperationId: intent.operationId,
              shipmentLineId: line.shipmentLineId,
              quantity: returnQty,
              from,
              reason: intent.reason,
              actorId: intent.actorId,
            },
            tx,
          );
        }
        allocationRemaining -= terminalQty;
      }
      if (allocationRemaining > 0) {
        const pooled = await tx
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(
            and(
              eq(wmsTables.batchInventorySessionBalances.sessionId, intent.sessionId),
              eq(wmsTables.batchInventorySessionBalances.skuId, shipmentLine.skuId),
              eq(wmsTables.batchInventorySessionBalances.sourceLocationId, line.sourceLocationId),
              isNull(wmsTables.batchInventorySessionBalances.shipmentLineId),
              inArray(wmsTables.batchInventorySessionBalances.custodyType, ['AT_SOURCE', 'BULK_CART']),
              gt(wmsTables.batchInventorySessionBalances.qty, 0),
            ),
          )
          .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
          .for('update');
        for (const balance of pooled) {
          const terminalQty = Math.min(allocationRemaining, balance.qty);
          if (terminalQty === 0) continue;
          const from: BatchInventoryBucket = {
            skuId: balance.skuId,
            sourceLocationId: balance.sourceLocationId!,
            custodyType: balance.custodyType,
            custodyRef: balance.custodyRef,
            shipmentLineId: null,
          };
          const shortageQty = Math.min(shortageRemaining, terminalQty);
          if (shortageQty > 0) {
            await this.session.approveShortage(
              {
                sessionId: intent.sessionId,
                idempotencyKey: `${intent.operationId}:${line.shipmentLineId}:${line.sourceLocationId}:${balance.id}:pooled-shortage`,
                shortPickOperationId: intent.operationId,
                shipmentLineId: line.shipmentLineId,
                quantity: shortageQty,
                from,
                reasonCode: this.reasonCode(intent.reason),
                reason: intent.reason,
                approverId: intent.actorId,
              },
              tx,
            );
            shortageRemaining -= shortageQty;
          }
          const returnQty = terminalQty - shortageQty;
          if (returnQty > 0) {
            await this.session.returnShortPickCustody(
              {
                sessionId: intent.sessionId,
                idempotencyKey: `${intent.operationId}:${line.shipmentLineId}:${line.sourceLocationId}:${balance.id}:pooled-return`,
                shortPickOperationId: intent.operationId,
                shipmentLineId: line.shipmentLineId,
                quantity: returnQty,
                from,
                reason: intent.reason,
                actorId: intent.actorId,
              },
              tx,
            );
          }
          allocationRemaining -= terminalQty;
          if (allocationRemaining === 0) break;
        }
      }
      if (shortageRemaining > 0 || allocationRemaining > 0) {
        throw this.conflict(
          'SHORT_PICK_CUSTODY_INSUFFICIENT',
          `Allocation ${line.shipmentLineId}/${line.sourceLocationId} lacks terminal custody evidence`,
        );
      }
    }
  }

  private async assertNoPositiveCustody(intent: ShortPickIntent, tx: DbTx): Promise<void> {
    const positive = await tx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, intent.sessionId),
          inArray(
            wmsTables.batchInventorySessionBalances.shipmentLineId,
            intent.lines.map((line) => line.shipmentLineId),
          ),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .limit(1)
      .for('update');
    if (positive.length) throw this.conflict('SHORT_PICK_CUSTODY_REMAINS', 'Affected shipment custody is not zero');
  }

  private async markRecoveryRequired(operationId: string, error: unknown, tx: DbTx): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
    const [operation] = await tx
      .select({
        operatorId: wmsTables.shipmentOperations.operatorId,
        status: wmsTables.shipmentOperations.status,
      })
      .from(wmsTables.shipmentOperations)
      .where(and(eq(wmsTables.shipmentOperations.id, operationId), eq(wmsTables.shipmentOperations.type, 'short_pick')))
      .limit(1)
      .for('update');
    if (!operation || !['pending', 'recovery_required'].includes(operation.status)) return;
    const [updated] = await tx
      .update(wmsTables.shipmentOperations)
      .set({ status: 'recovery_required', lastError: message })
      .where(
        and(
          eq(wmsTables.shipmentOperations.id, operationId),
          eq(wmsTables.shipmentOperations.type, 'short_pick'),
          inArray(wmsTables.shipmentOperations.status, ['pending', 'recovery_required']),
        ),
      )
      .returning({ id: wmsTables.shipmentOperations.id });
    if (!updated) return;
    await this.audit.logUserActionRequired(
      'shipment.short_pick.recovery_required',
      'fulfillment',
      `Short pick operation ${operationId} requires recovery`,
      { userId: operation.operatorId },
      { operationId, error: message },
      tx,
    );
  }

  private async currentResponse(
    operationId: string,
    fallback?: ShipmentShortPickResponseDto,
    tx?: DbTx,
  ): Promise<ShipmentShortPickResponseDto> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({
          operationId: wmsTables.shipmentOperations.id,
          status: wmsTables.shipmentOperations.status,
          shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
        })
        .from(wmsTables.shipmentOperations)
        .innerJoin(
          wmsTables.shipmentOperationMembers,
          eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
        )
        .where(
          and(eq(wmsTables.shipmentOperations.id, operationId), eq(wmsTables.shipmentOperationMembers.role, 'source')),
        )
        .limit(1);
      if (!row) {
        if (fallback) return fallback;
        throw new NotFoundException(`Short pick operation ${operationId} not found`);
      }
      const [invoiceOperation] = await trx
        .select({ id: wmsTables.invoiceOperations.id })
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.resumeOperationId, operationId))
        .limit(1);
      const intentRow = await trx
        .select({ snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot })
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      const intent = this.intent(intentRow[0]?.snapshot);
      return {
        operationId,
        shipmentId: row.shipmentId,
        operationStatus:
          row.status === 'completed'
            ? 'completed'
            : row.status === 'recovery_required'
              ? 'recovery_required'
              : 'pending',
        invoiceOperationId: invoiceOperation?.id ?? null,
        workItemId: intent.workItemId,
      };
    }, tx);
  }

  private intent(snapshot: unknown): ShortPickIntent {
    const value = (snapshot ?? {}) as { intent?: ShortPickIntent };
    if (value.intent?.kind !== 'short_pick') throw new Error('Short pick operation intent is missing');
    return value.intent;
  }

  private reasonCode(reason: ShipmentShortPickReason): 'MISSING' | 'DAMAGED' | 'DEFECTIVE' {
    if (reason === 'inventory_shortage') return 'MISSING';
    if (reason === 'item_damaged') return 'DAMAGED';
    return 'DEFECTIVE';
  }

  private shortQtyByLine(lines: ShortPickLineIntent[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const line of lines) {
      if (line.shortQty > 0) result.set(line.shipmentLineId, (result.get(line.shipmentLineId) ?? 0) + line.shortQty);
    }
    return result;
  }

  private assertDto(dto: ReportShipmentShortPickDto): void {
    if (!SHIPMENT_SHORT_PICK_REASONS.includes(dto.reason))
      throw new BadRequestException('Unsupported short-pick reason');
    if (!dto.lines.length) throw new BadRequestException('At least one short-pick line is required');
  }

  private async requireScope(actor: ShipmentShortPickActor): Promise<void> {
    if (actor.roles.includes('master')) return;
    const scopes = await this.authorization.getScopesByRoles(actor.roles);
    if (!scopes.has(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)) {
      throw new ForbiddenException(`Missing required scope: ${FULFILLMENT_SCOPE.SHIPMENT_REOPEN}`);
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
