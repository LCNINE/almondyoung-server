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
import { FulfillmentReopenedPayload, ShipmentDispatchRecalledPayload } from '@packages/event-contracts/streams';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  RecallShipmentDispatchDto,
  SHIPMENT_RECALL_REASONS,
  ShipmentRecallActor,
  ShipmentRecallReason,
  ShipmentRecallResponseDto,
} from '../dto/shipment-recall.dto';
import { fulfillmentReopenedOutboxEvent, shipmentDispatchRecalledOutboxEvent } from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { InvoiceOrchestrator } from './invoice-orchestrator.service';
import { ShipmentReservationService } from './shipment-reservation.service';

type RecallIntent = {
  kind: 'shipment_recall';
  operationId: string;
  shipmentId: string;
  dispatchAttemptId: string;
  attemptNo: number;
  invoiceId: string;
  expectedManifestVersion: number;
  physicalRecoveryConfirmed: true;
  reason: ShipmentRecallReason;
  actorId: string;
};

type RecallInventoryPort = {
  reverseShipmentDispatch(
    input: {
      dispatchAttemptId: string;
      reversalJournalId: string;
      recallOperationId: string;
      actorId: string;
      reason: string;
      occurredAt?: Date;
    },
    tx: DbTx,
  ): Promise<{
    reversalJournalId: string;
    sources: Array<{
      dispatchAttemptSourceId: string;
      shipmentLineId: string;
      skuId: string;
      warehouseId: string;
      outboundReworkLocationId: string;
      quantity: number;
      originalEventId: string;
      reversalEventId: string;
    }>;
    affectedSkuIds: string[];
  }>;
};

type RecallReservationPort = {
  lockShipmentGraphForDispatch(shipmentId: string, tx: DbTx): Promise<void>;
  restoreForRecall(
    shipmentId: string,
    attemptId: string,
    operationId: string,
    tx: DbTx,
  ): Promise<{
    restoredQuantity: number;
    reservationIds: string[];
    affectedSkuIds: string[];
  }>;
  finalizeRecallRestoration(shipmentId: string, affectedSkuIds: readonly string[], tx: DbTx): Promise<void>;
};

@Injectable()
export class ShipmentRecallService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly authorization: AuthorizationService,
    @Inject(forwardRef(() => InvoiceOrchestrator)) private readonly invoices: InvoiceOrchestrator,
    @Inject(InventoryCommandService) private readonly inventory: RecallInventoryPort,
    @Inject(ShipmentReservationService) private readonly reservations: RecallReservationPort,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  async report(
    shipmentId: string,
    dispatchAttemptId: string,
    dto: RecallShipmentDispatchDto,
    idempotencyKey: string,
    actor: ShipmentRecallActor,
  ): Promise<ShipmentRecallResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.dispatch.recall');
    this.assertDto(dto);
    if (dto.dispatchAttemptId !== dispatchAttemptId) {
      throw new BadRequestException('dispatchAttemptId must identify one exact recall attempt');
    }
    await this.requireScope(actor);

    const accepted = await this.commands.execute<ShipmentRecallResponseDto>(
      {
        commandType: 'shipment.dispatch.recall',
        idempotencyKey,
        canonicalRequest: { shipmentId, actorId: actor.id, ...dto },
      },
      async (tx, _commandRequestId, requestHash) => {
        const operationId = randomUUID();
        const initialIntent = {
          kind: 'shipment_recall' as const,
          operationId,
          shipmentId,
          dispatchAttemptId,
          expectedManifestVersion: dto.expectedManifestVersion,
          physicalRecoveryConfirmed: true as const,
          reason: dto.reason,
          actorId: actor.id,
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
          type: 'recall',
          status: 'pending',
          operatorId: actor.id,
          reason: dto.reason,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          beforeManifestSnapshot: { intent: initialIntent },
        });
        await tx.insert(wmsTables.shipmentOperationMembers).values({
          operationId,
          shipmentId,
          role: 'source',
          beforeManifestVersion: dto.expectedManifestVersion,
        });

        const [shipment] = await tx
          .select()
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, shipmentId))
          .limit(1)
          .for('update');
        if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
        if (shipment.manifestVersion !== dto.expectedManifestVersion) {
          throw this.conflict('SHIPMENT_RECALL_STALE_MANIFEST', 'Shipment manifest changed');
        }
        if (shipment.status !== 'shipped') {
          throw this.conflict('SHIPMENT_RECALL_NOT_SHIPPED', `Shipment is ${shipment.status}`);
        }

        const [attempt] = await tx
          .select()
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
          .limit(1)
          .for('update');
        if (!attempt || attempt.shipmentId !== shipmentId) {
          throw new NotFoundException(`Dispatch attempt ${dispatchAttemptId} not found on shipment ${shipmentId}`);
        }
        if (attempt.status !== 'dispatched') {
          throw this.conflict('SHIPMENT_RECALL_ATTEMPT_NOT_DISPATCHED', `Dispatch attempt is ${attempt.status}`);
        }
        if (!attempt.invoiceId || !attempt.stockJournalId || !attempt.dispatchedAt) {
          throw this.conflict(
            'SHIPMENT_RECALL_ATTEMPT_INCOMPLETE',
            'Dispatch attempt lacks immutable dispatch evidence',
          );
        }
        if (attempt.carrierAcceptedAt) {
          throw this.conflict('SHIPMENT_RECALL_CARRIER_ACCEPTED', 'Carrier-accepted dispatch cannot be recalled');
        }
        const tracking = await tx
          .select({ status: wmsTables.shipmentTracking.status })
          .from(wmsTables.shipmentTracking)
          .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, attempt.id))
          .orderBy(asc(wmsTables.shipmentTracking.timestamp), asc(wmsTables.shipmentTracking.id))
          .for('update');
        if (tracking.some((row) => ['in_transit', 'delivered'].includes(row.status))) {
          throw this.conflict(
            'SHIPMENT_RECALL_CARRIER_PROGRESS_EXISTS',
            'In-transit or delivered tracking evidence forbids recall',
          );
        }
        const [invoice] = await tx
          .select()
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.id, attempt.invoiceId))
          .limit(1)
          .for('update');
        if (!invoice || invoice.shipmentId !== shipmentId || invoice.status !== 'used') {
          throw this.conflict(
            'SHIPMENT_RECALL_INVOICE_NOT_USED',
            'Exact attempt invoice is not the used shipment invoice',
          );
        }

        const intent: RecallIntent = { ...initialIntent, attemptNo: attempt.attemptNo, invoiceId: invoice.id };
        const before = { shipment, attempt, intent };
        await tx
          .update(wmsTables.shipmentOperations)
          .set({ beforeManifestSnapshot: before })
          .where(eq(wmsTables.shipmentOperations.id, operationId));
        await tx
          .update(wmsTables.shipmentOperationMembers)
          .set({ beforeManifestSnapshot: before })
          .where(
            and(
              eq(wmsTables.shipmentOperationMembers.operationId, operationId),
              eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
              eq(wmsTables.shipmentOperationMembers.role, 'source'),
            ),
          );

        const invoiceOperation = await this.invoices.void(
          invoice.id,
          {
            reason: `shipment_recall:${dto.reason}`,
            resumeOperationId: operationId,
            csCaseId: dto.csCaseId,
            note: dto.note,
          },
          `${idempotencyKey}:invoice-void`,
          actor,
          tx,
        );
        const now = new Date();
        const [quarantinedAttempt] = await tx
          .update(wmsTables.dispatchAttempts)
          .set({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING', updatedAt: now })
          .where(
            and(eq(wmsTables.dispatchAttempts.id, attempt.id), eq(wmsTables.dispatchAttempts.status, 'dispatched')),
          )
          .returning({ id: wmsTables.dispatchAttempts.id });
        if (!quarantinedAttempt) throw this.conflict('SHIPMENT_RECALL_ATTEMPT_CHANGED', 'Dispatch attempt changed');
        const [quarantinedShipment] = await tx
          .update(wmsTables.shipments)
          .set({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING', lastUpdated: now })
          .where(and(eq(wmsTables.shipments.id, shipmentId), eq(wmsTables.shipments.status, 'shipped')))
          .returning({ id: wmsTables.shipments.id });
        if (!quarantinedShipment) throw this.conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed');
        await this.audit.logUserActionRequired(
          'shipment.dispatch.recall.requested',
          'fulfillment',
          `Recall operation ${operationId} requested for dispatch attempt ${attempt.id}`,
          { userId: actor.id },
          {
            operationId,
            shipmentId,
            dispatchAttemptId: attempt.id,
            attemptNo: attempt.attemptNo,
            invoiceId: invoice.id,
            invoiceOperationId: invoiceOperation.operationId,
            physicalRecoveryConfirmed: true,
            reason: dto.reason,
          },
          tx,
        );
        const response: ShipmentRecallResponseDto = {
          operationId,
          shipmentId,
          dispatchAttemptId: attempt.id,
          operationStatus: 'pending',
          invoiceOperationId: invoiceOperation.operationId,
        };
        return { response, resourceType: 'shipment_operation', resourceId: operationId, operationId };
      },
    );
    return this.currentResponse(accepted.operationId);
  }

  async resumePending(operationId: string, tx?: DbTx): Promise<ShipmentRecallResponseDto> {
    if (tx) return this.resumePendingInTransaction(operationId, tx);
    try {
      return await this.dbService.run((trx) => this.resumePendingInTransaction(operationId, trx));
    } catch (error) {
      await this.dbService.run((trx) => this.markRecoveryRequired(operationId, error, trx));
      throw error;
    }
  }

  private async resumePendingInTransaction(operationId: string, tx: DbTx): Promise<ShipmentRecallResponseDto> {
    const [operation] = await tx
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1)
      .for('update');
    if (!operation || operation.type !== 'recall')
      throw new NotFoundException(`Recall operation ${operationId} not found`);
    const intent = this.intent(operation.beforeManifestSnapshot);
    if (operation.status === 'completed') return this.currentResponse(operationId, tx);
    if (!['pending', 'recovery_required'].includes(operation.status)) {
      throw this.conflict('SHIPMENT_RECALL_NOT_RESUMABLE', `Recall operation is ${operation.status}`);
    }
    const [member] = await tx
      .select()
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, intent.shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1)
      .for('update');
    if (!member) throw this.conflict('SHIPMENT_RECALL_OWNER_MISSING', 'Recall operation has no exact source member');

    await this.reservations.lockShipmentGraphForDispatch(intent.shipmentId, tx);
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, intent.shipmentId))
      .limit(1)
      .for('update');
    if (!shipment) throw new NotFoundException(`Shipment ${intent.shipmentId} not found`);
    const [attempt] = await tx
      .select()
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, intent.dispatchAttemptId))
      .limit(1)
      .for('update');
    if (!attempt || attempt.shipmentId !== intent.shipmentId || attempt.attemptNo !== intent.attemptNo) {
      throw this.conflict('SHIPMENT_RECALL_ATTEMPT_CHANGED', 'Exact dispatch attempt ownership changed');
    }
    if (shipment.status !== 'recovery_required' || shipment.recoveryCode !== 'DISPATCH_RECALL_PENDING') {
      throw this.conflict('SHIPMENT_RECALL_SHIPMENT_NOT_RECOVERING', 'Shipment is not in exact recall recovery');
    }
    if (attempt.status !== 'recovery_required' || attempt.recoveryCode !== 'DISPATCH_RECALL_PENDING') {
      throw this.conflict('SHIPMENT_RECALL_ATTEMPT_NOT_RECOVERING', 'Dispatch attempt is not in exact recall recovery');
    }
    if (attempt.carrierAcceptedAt) {
      throw this.conflict('SHIPMENT_RECALL_CARRIER_ACCEPTED', 'Carrier acceptance appeared during recovery');
    }
    const blockingTracking = await tx
      .select({ id: wmsTables.shipmentTracking.id })
      .from(wmsTables.shipmentTracking)
      .where(
        and(
          eq(wmsTables.shipmentTracking.dispatchAttemptId, attempt.id),
          inArray(wmsTables.shipmentTracking.status, ['in_transit', 'delivered']),
        ),
      )
      .orderBy(asc(wmsTables.shipmentTracking.id))
      .for('update');
    if (blockingTracking.length) {
      throw this.conflict('SHIPMENT_RECALL_CARRIER_PROGRESS_EXISTS', 'Carrier progress appeared during recovery');
    }
    const [invoice] = await tx
      .select()
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.id, intent.invoiceId))
      .limit(1)
      .for('update');
    if (!invoice || invoice.shipmentId !== intent.shipmentId || invoice.status !== 'voided') {
      throw this.conflict('SHIPMENT_RECALL_INVOICE_NOT_VOIDED', 'Recall cannot reopen before exact invoice void');
    }

    const recalledAt = new Date();
    const reversalJournalId = randomUUID();
    await tx.insert(wmsTables.stockJournals).values({
      id: reversalJournalId,
      sourceType: 'SHIPMENT_RECALL',
      sourceId: operationId,
      idempotencyKey: `shipment-recall:${operationId}`,
      actorId: intent.actorId,
    });
    const reversal = await this.inventory.reverseShipmentDispatch(
      {
        dispatchAttemptId: intent.dispatchAttemptId,
        reversalJournalId,
        recallOperationId: operationId,
        actorId: intent.actorId,
        reason: intent.reason,
        occurredAt: recalledAt,
      },
      tx,
    );
    const restored = await this.reservations.restoreForRecall(
      intent.shipmentId,
      intent.dispatchAttemptId,
      operationId,
      tx,
    );
    const quantitiesByLine = new Map<string, number>();
    for (const source of reversal.sources) {
      quantitiesByLine.set(source.shipmentLineId, (quantitiesByLine.get(source.shipmentLineId) ?? 0) + source.quantity);
    }
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, intent.shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id))
      .for('update');
    if (
      lines.length === 0 ||
      lines.some((line) => quantitiesByLine.get(line.id) !== line.qty) ||
      restored.restoredQuantity !== lines.reduce((sum, line) => sum + line.qty, 0)
    ) {
      throw this.conflict('SHIPMENT_RECALL_QUANTITY_MISMATCH', 'Reversal and reservation restoration must be exact');
    }
    const fulfillmentOrderIds = new Set<string>();
    for (const line of lines) {
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, line.fulfillmentOrderItemId))
        .limit(1)
        .for('update');
      if (!item || item.shippedQty < line.qty) {
        throw this.conflict(
          'SHIPMENT_RECALL_FOI_PROGRESS_MISMATCH',
          `FOI ${line.fulfillmentOrderItemId} is not shipped`,
        );
      }
      fulfillmentOrderIds.add(item.fulfillmentOrderId);
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: item.shippedQty - line.qty, updatedAt: recalledAt })
        .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
    }
    await tx
      .update(wmsTables.shipmentLines)
      .set({ inspectedQty: 0, forced: false, lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1` })
      .where(eq(wmsTables.shipmentLines.shipmentId, intent.shipmentId));
    const [updatedShipment] = await tx
      .update(wmsTables.shipments)
      .set({
        status: 'draft',
        recoveryCode: null,
        plannedAt: null,
        shippedAt: null,
        deliveredAt: null,
        manifestVersion: shipment.manifestVersion + 1,
        lastUpdated: recalledAt,
      })
      .where(
        and(
          eq(wmsTables.shipments.id, shipment.id),
          eq(wmsTables.shipments.status, 'recovery_required'),
          eq(wmsTables.shipments.recoveryCode, 'DISPATCH_RECALL_PENDING'),
          eq(wmsTables.shipments.manifestVersion, shipment.manifestVersion),
        ),
      )
      .returning();
    if (!updatedShipment) throw this.conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed during recall');
    const [recalledAttempt] = await tx
      .update(wmsTables.dispatchAttempts)
      .set({
        status: 'recalled',
        reversalJournalId: reversal.reversalJournalId,
        recalledAt,
        recoveryCode: null,
        updatedAt: recalledAt,
      })
      .where(
        and(
          eq(wmsTables.dispatchAttempts.id, attempt.id),
          eq(wmsTables.dispatchAttempts.status, 'recovery_required'),
          eq(wmsTables.dispatchAttempts.recoveryCode, 'DISPATCH_RECALL_PENDING'),
        ),
      )
      .returning();
    if (!recalledAttempt)
      throw this.conflict('SHIPMENT_RECALL_ATTEMPT_CHANGED', 'Dispatch attempt changed during recall');
    if (fulfillmentOrderIds.size > 0) {
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ shippedAt: null, updatedAt: recalledAt })
        .where(inArray(wmsTables.fulfillmentOrders.id, [...fulfillmentOrderIds]));
    }
    await this.reservations.finalizeRecallRestoration(
      intent.shipmentId,
      [...new Set([...reversal.affectedSkuIds, ...restored.affectedSkuIds])],
      tx,
    );

    await this.outbox.enqueue(
      shipmentDispatchRecalledOutboxEvent({
        shipmentId: intent.shipmentId,
        dispatchAttemptId: intent.dispatchAttemptId,
        attemptNo: intent.attemptNo,
        recallOperationId: operationId,
        recalledAt: recalledAt.toISOString(),
      } satisfies ShipmentDispatchRecalledPayload),
      tx,
    );
    const summaries = await this.fulfillmentSummaries([...fulfillmentOrderIds], tx);
    for (const summary of summaries) {
      if (summary.outstandingQty <= 0) {
        throw this.conflict(
          'SHIPMENT_RECALL_FO_NOT_REOPENED',
          `FO ${summary.fulfillmentOrderId} has no demand to reopen`,
        );
      }
      await this.outbox.enqueue(
        fulfillmentReopenedOutboxEvent({
          fulfillmentOrderId: summary.fulfillmentOrderId,
          salesOrderId: summary.salesOrderId,
          dispatchAttemptId: intent.dispatchAttemptId,
          recallOperationId: operationId,
          reopenedAt: recalledAt.toISOString(),
          shippedQty: summary.shippedQty,
          canceledQty: summary.canceledQty,
          outstandingQty: summary.outstandingQty,
        } satisfies FulfillmentReopenedPayload),
        tx,
      );
    }
    const after = {
      shipment: updatedShipment,
      dispatchAttempt: recalledAttempt,
      reversalJournalId,
      restoredReservationIds: restored.reservationIds,
      fulfillmentOrders: summaries,
    };
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
      .set({ status: 'completed', afterManifestSnapshot: after, lastError: null, completedAt: recalledAt })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
    await this.audit.logUserActionRequired(
      'shipment.dispatch.recall.completed',
      'fulfillment',
      `Recalled dispatch attempt ${intent.dispatchAttemptId} and reopened shipment ${intent.shipmentId}`,
      { userId: intent.actorId },
      {
        operationId,
        shipmentId: intent.shipmentId,
        dispatchAttemptId: intent.dispatchAttemptId,
        attemptNo: intent.attemptNo,
        invoiceId: intent.invoiceId,
        reversalJournalId,
        originalStockEventIds: reversal.sources.map((source) => source.originalEventId),
        reversalStockEventIds: reversal.sources.map((source) => source.reversalEventId),
        restoredReservationIds: restored.reservationIds,
        physicalRecoveryConfirmed: intent.physicalRecoveryConfirmed,
        reason: intent.reason,
      },
      tx,
    );
    return this.currentResponse(operationId, tx);
  }

  async markInvoiceRecoveryRequired(operationId: string, error: unknown, tx: DbTx): Promise<void> {
    await this.markRecoveryRequired(operationId, error, tx);
  }

  getOperation(operationId: string): Promise<ShipmentRecallResponseDto> {
    return this.currentResponse(operationId);
  }

  private async markRecoveryRequired(operationId: string, error: unknown, tx: DbTx): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const [operation] = await tx
      .select({
        status: wmsTables.shipmentOperations.status,
        snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .where(and(eq(wmsTables.shipmentOperations.id, operationId), eq(wmsTables.shipmentOperations.type, 'recall')))
      .limit(1)
      .for('update');
    if (!operation || operation.status === 'completed') return;
    const intent = this.intent(operation.snapshot);
    await tx
      .update(wmsTables.shipmentOperations)
      .set({ status: 'recovery_required', lastError: message })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
    await tx
      .update(wmsTables.shipments)
      .set({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING', lastUpdated: new Date() })
      .where(eq(wmsTables.shipments.id, intent.shipmentId));
    await tx
      .update(wmsTables.dispatchAttempts)
      .set({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING', updatedAt: new Date() })
      .where(eq(wmsTables.dispatchAttempts.id, intent.dispatchAttemptId));
    await this.audit.logUserActionRequired(
      'shipment.dispatch.recall.recovery_required',
      'fulfillment',
      `Recall operation ${operationId} requires recovery`,
      { userId: intent.actorId },
      { operationId, shipmentId: intent.shipmentId, dispatchAttemptId: intent.dispatchAttemptId, error: message },
      tx,
    );
  }

  private async currentResponse(operationId: string, tx?: DbTx): Promise<ShipmentRecallResponseDto> {
    return this.dbService.run(async (trx) => {
      const [operation] = await trx
        .select({
          status: wmsTables.shipmentOperations.status,
          snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
        })
        .from(wmsTables.shipmentOperations)
        .where(and(eq(wmsTables.shipmentOperations.id, operationId), eq(wmsTables.shipmentOperations.type, 'recall')))
        .limit(1);
      if (!operation) throw new NotFoundException(`Recall operation ${operationId} not found`);
      const intent = this.intent(operation.snapshot);
      const [invoiceOperation] = await trx
        .select({ id: wmsTables.invoiceOperations.id })
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.resumeOperationId, operationId))
        .limit(1);
      return {
        operationId,
        shipmentId: intent.shipmentId,
        dispatchAttemptId: intent.dispatchAttemptId,
        operationStatus:
          operation.status === 'completed'
            ? 'completed'
            : operation.status === 'recovery_required'
              ? 'recovery_required'
              : 'pending',
        invoiceOperationId: invoiceOperation?.id ?? null,
      };
    }, tx);
  }

  private async fulfillmentSummaries(fulfillmentOrderIds: string[], tx: DbTx) {
    const result: Array<{
      fulfillmentOrderId: string;
      salesOrderId: string | null;
      shippedQty: number;
      canceledQty: number;
      outstandingQty: number;
    }> = [];
    for (const fulfillmentOrderId of fulfillmentOrderIds.sort()) {
      const [fo] = await tx
        .select({ salesOrderId: wmsTables.fulfillmentOrders.salesOrderId })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!fo) throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      const items = await tx
        .select({
          qty: wmsTables.fulfillmentOrderItems.qty,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
          canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
      const shippedQty = items.reduce((sum, item) => sum + item.shippedQty, 0);
      const canceledQty = items.reduce((sum, item) => sum + item.canceledQty, 0);
      result.push({
        fulfillmentOrderId,
        salesOrderId: fo.salesOrderId,
        shippedQty,
        canceledQty,
        outstandingQty: items.reduce((sum, item) => sum + item.qty, 0) - shippedQty - canceledQty,
      });
    }
    return result;
  }

  private intent(snapshot: unknown): RecallIntent {
    const candidate = snapshot as { intent?: RecallIntent } | null;
    if (
      candidate?.intent?.kind !== 'shipment_recall' ||
      candidate.intent.operationId === undefined ||
      candidate.intent.attemptNo === undefined ||
      candidate.intent.invoiceId === undefined
    ) {
      throw new Error('Shipment recall operation intent is missing or incomplete');
    }
    return candidate.intent;
  }

  private assertDto(dto: RecallShipmentDispatchDto): void {
    if (dto.physicalRecoveryConfirmed !== true) {
      throw new BadRequestException('physicalRecoveryConfirmed must be exactly true');
    }
    if (!SHIPMENT_RECALL_REASONS.includes(dto.reason)) throw new BadRequestException('Unsupported recall reason');
  }

  private async requireScope(actor: ShipmentRecallActor): Promise<void> {
    if (actor.roles.includes('master')) return;
    const scopes = await this.authorization.getScopesByRoles(actor.roles);
    if (!scopes.has(FULFILLMENT_SCOPE.DISPATCH_RECALL)) {
      throw new ForbiddenException(`Missing required scope: ${FULFILLMENT_SCOPE.DISPATCH_RECALL}`);
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
