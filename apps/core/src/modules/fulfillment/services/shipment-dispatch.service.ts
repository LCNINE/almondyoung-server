import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { isScopeAuthorizationDecision, ScopeAuthorizationDecision } from '@app/authorization';
import {
  FulfillmentProgressedPayload,
  FulfillmentShippedPayload,
  ShipmentEventOrder,
  ShipmentShippedPayload,
} from '@packages/event-contracts/streams';
import { and, asc, eq, inArray, isNull, max, notInArray, sql } from 'drizzle-orm';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import {
  fulfillmentProgressedOutboxEvent,
  fulfillmentShippedV1OutboxEvent,
  shipmentShippedOutboxEvent,
} from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { WaybillService } from '../waybill/waybill.service';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import type { WaybillRow } from '../waybill/waybill.types';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';

const TRUSTED_CHANNEL_DISPATCH_SALES_CHANNELS = new Set(['medusa', 'naver', 'coupang']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ShipmentDispatchActor {
  id: string;
  roles: string[];
}

export interface InspectionScanInput {
  barcode: string;
  quantity: number;
  actor: ShipmentDispatchActor;
  idempotencyKey: string;
}

export interface ForceShipmentDispatchInput {
  reason: string;
  csCaseId?: string;
  note?: string;
  actor: ShipmentDispatchActor;
  idempotencyKey: string;
  authorization: ScopeAuthorizationDecision | undefined;
}

export interface ShipmentDispatchResponse {
  shipmentId: string;
  status: 'inspecting' | 'shipped';
  dispatchAttemptId: string | null;
  attemptNo: number | null;
  shipmentLineId?: string;
  inspectedQty?: number;
  forcedQuantities?: Array<{ shipmentLineId: string; quantity: number }>;
}

type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect;
type SessionRow = typeof wmsTables.batchInventorySessions.$inferSelect;

interface LockedDispatchAggregate {
  shipment: ShipmentRow;
  lines: ShipmentLineRow[];
  waybill: WaybillRow;
  session: SessionRow;
  workItem: typeof wmsTables.outboundBatchWorkItems.$inferSelect;
  planId: string;
}

interface DispatchSource {
  id: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
}

interface DispatchAllocation {
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
}

interface ExactDispatchCustodySource extends DispatchAllocation {
  skuId: string;
  balances: Array<typeof wmsTables.batchInventorySessionBalances.$inferSelect>;
}

interface DispatchLineManifestEvidence {
  shipmentLineId: string;
  fulfillmentOrderItemId: string;
  skuId: string;
  qty: number;
  inspectedQty: number;
  forced: boolean;
  lineVersion: number;
}

interface ForceDispatchContext {
  forcedQuantities: Array<{ shipmentLineId: string; quantity: number }>;
  reason: string;
  csCaseId: string | null;
  note: string | null;
  commandRequestId: string;
  authorizationScope: string;
  beforeLineManifest: DispatchLineManifestEvidence[];
}

interface EventLineIdentity {
  shipmentLineId: string;
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
  channelOrderId: string;
  channelOrderItemId: string;
  channelProductId: string | null;
  skuId: string;
  qty: number;
  fulfillmentOrderItemQty: number;
  fulfillmentOrderItemShippedQty: number;
  fulfillmentOrderItemCanceledQty: number;
}

interface FulfillmentSummary {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
  fullyShipped: boolean;
  items: Array<{ id: string; skuId: string; shippedQty: number }>;
}

@Injectable()
export class ShipmentDispatchService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly inventory: InventoryCommandService,
    private readonly sessions: BatchInventorySessionService,
    private readonly shipmentReservations: ShipmentReservationService,
    private readonly waybills: WaybillService,
    private readonly barcode: BarcodeService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  async inspectionScan(shipmentId: string, input: InspectionScanInput): Promise<ShipmentDispatchResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.inspection.scan');
    this.assertActor(input.actor);
    this.assertPositiveInteger('quantity', input.quantity);

    return this.commands.execute(
      {
        commandType: 'shipment.inspection.scan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode: input.barcode.trim(),
          quantity: input.quantity,
          actorId: input.actor.id,
        },
      },
      async (tx) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertDispatchCandidate(aggregate, input.actor, false);
        const line = await this.resolveInspectionLine(input.barcode, input.quantity, aggregate.lines, tx);
        if (line.inspectedQty + input.quantity > line.qty) {
          throw this.conflict('SHIPMENT_LINE_OVER_INSPECTED', 'Inspection quantity exceeds the shipment line');
        }

        await this.moveInspectionCustody(
          aggregate.session.id,
          line,
          input.quantity,
          input.actor.id,
          input.idempotencyKey,
          tx,
        );
        const inspectedQty = line.inspectedQty + input.quantity;
        await tx
          .update(wmsTables.shipmentLines)
          .set({ inspectedQty, lineVersion: line.lineVersion + 1 })
          .where(
            and(eq(wmsTables.shipmentLines.id, line.id), eq(wmsTables.shipmentLines.lineVersion, line.lineVersion)),
          );
        line.inspectedQty = inspectedQty;
        line.lineVersion += 1;

        let response: ShipmentDispatchResponse;
        if (aggregate.lines.every((candidate) => candidate.inspectedQty === candidate.qty)) {
          response = await this.dispatchLocked(aggregate, input.actor, tx);
          response.shipmentLineId = line.id;
          response.inspectedQty = inspectedQty;
        } else {
          response = {
            shipmentId,
            shipmentLineId: line.id,
            inspectedQty,
            status: 'inspecting',
            dispatchAttemptId: null,
            attemptNo: null,
          };
        }

        return {
          response,
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: response.dispatchAttemptId ?? undefined,
        };
      },
    );
  }

  async forceDispatch(shipmentId: string, input: ForceShipmentDispatchInput): Promise<ShipmentDispatchResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.dispatch.force');
    this.assertActor(input.actor);
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    if (input.reason.trim().length > 500) throw new BadRequestException('reason must be at most 500 characters');
    const authorization = input.authorization;
    if (!isScopeAuthorizationDecision(authorization, FULFILLMENT_SCOPE.DISPATCH_FORCE)) {
      throw new ForbiddenException({
        code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN',
        message: 'Force dispatch scope is required',
      });
    }

    return this.commands.execute(
      {
        commandType: 'shipment.dispatch.force',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          reason: input.reason.trim(),
          csCaseId: input.csCaseId?.trim() || null,
          note: input.note?.trim() || null,
          actorId: input.actor.id,
        },
      },
      async (tx, commandRequestId) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        this.assertDispatchCandidate(aggregate, input.actor, true);
        const beforeLineManifest = this.dispatchLineManifest(aggregate.lines);
        const forcedQuantities = aggregate.lines
          .map((line) => ({ shipmentLineId: line.id, quantity: line.qty - line.inspectedQty }))
          .filter((entry) => entry.quantity > 0);
        if (forcedQuantities.length > 0) {
          for (const forced of forcedQuantities) {
            const line = aggregate.lines.find((candidate) => candidate.id === forced.shipmentLineId)!;
            await this.moveInspectionCustody(
              aggregate.session.id,
              line,
              forced.quantity,
              input.actor.id,
              `force:${input.idempotencyKey}`,
              tx,
            );
            await tx
              .update(wmsTables.shipmentLines)
              .set({ forced: true, inspectedQty: line.qty, lineVersion: line.lineVersion + 1 })
              .where(
                and(eq(wmsTables.shipmentLines.id, line.id), eq(wmsTables.shipmentLines.lineVersion, line.lineVersion)),
              );
            line.forced = true;
            line.inspectedQty = line.qty;
            line.lineVersion += 1;
          }
        }

        const response = await this.dispatchLocked(aggregate, input.actor, tx, {
          forcedQuantities,
          reason: input.reason.trim(),
          csCaseId: input.csCaseId?.trim() || null,
          note: input.note?.trim() || null,
          commandRequestId,
          authorizationScope: authorization.scope,
          beforeLineManifest,
        });
        return {
          response,
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: response.dispatchAttemptId ?? undefined,
        };
      },
    );
  }

  private async lockAggregate(shipmentId: string, tx: DbTx): Promise<LockedDispatchAggregate> {
    await this.shipmentReservations.lockShipmentGraphForDispatch(shipmentId, tx);
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    const [initialWorkItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, ['ready_to_pack', 'packing']),
        ),
      )
      .limit(1);
    if (!initialWorkItem) throw this.conflict('SHIPMENT_WORK_ITEM_MISSING', 'Shipment has no outbound work item');
    const [initialSession] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, initialWorkItem.batchId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
        ),
      )
      .limit(1);
    if (!initialSession) throw this.conflict('SHIPMENT_SESSION_MISSING', 'Shipment batch has no inventory session');
    const [handIn] = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, initialSession.id),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        ),
      )
      .limit(1);
    const planId = this.payloadString(handIn?.payload, 'planId');
    if (!planId) throw this.conflict('SHIPMENT_SESSION_PLAN_MISSING', 'Session has no immutable picking plan identity');

    // 활성 waybill 을 FOR UPDATE 로 잠근다 — dispatch 가 markUsed 로 이 행을 갱신하므로 concurrent void/reissue
    // 와 직렬화돼야 한다. staleness/carrier/trackingNo 검증은 dispatchLocked 의 assertDispatchable 이 담당.
    const activeWaybills = await tx
      .select()
      .from(wmsTables.waybills)
      .where(
        and(
          eq(wmsTables.waybills.shipmentId, shipmentId),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.waybills.id))
      .for('update');
    if (activeWaybills.length !== 1)
      throw this.conflict('SHIPMENT_INVOICE_NOT_READY', 'Shipment requires one active waybill');

    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.id, initialWorkItem.id),
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, ['ready_to_pack', 'packing']),
        ),
      )
      .limit(1)
      .for('update');
    if (!workItem || workItem.batchId !== initialWorkItem.batchId) {
      throw this.conflict('SHIPMENT_WORK_ITEM_CHANGED', 'Shipment work item changed while acquiring dispatch locks');
    }

    const [plan] = await tx
      .select({
        id: wmsTables.pickingPlans.id,
        batchId: wmsTables.pickingPlans.batchId,
        status: wmsTables.pickingPlans.status,
      })
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, planId))
      .limit(1)
      .for('update');
    if (!plan || plan.batchId !== workItem.batchId || plan.status !== 'active') {
      throw this.conflict('SHIPMENT_SESSION_PLAN_CHANGED', 'Session picking plan no longer belongs to the batch');
    }
    const [member] = await tx
      .select()
      .from(wmsTables.pickingPlanMembers)
      .where(
        and(
          eq(wmsTables.pickingPlanMembers.planId, planId),
          eq(wmsTables.pickingPlanMembers.shipmentId, shipmentId),
          isNull(wmsTables.pickingPlanMembers.retiredAt),
        ),
      )
      .limit(1);
    if (
      !member ||
      member.manifestVersion !== shipment.manifestVersion ||
      member.reservationVersion !== shipment.reservationVersion
    ) {
      throw this.conflict('SHIPMENT_PICKING_PLAN_STALE', 'Picking plan does not match current shipment versions');
    }
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, initialSession.id))
      .limit(1)
      .for('update');
    if (!session || session.batchId !== workItem.batchId) {
      throw this.conflict('SHIPMENT_SESSION_CHANGED', 'Inventory session changed while acquiring dispatch locks');
    }
    const lockedHandIns = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        ),
      );
    const lockedPlanIds = new Set(lockedHandIns.map((event) => this.payloadString(event.payload, 'planId')));
    if (lockedPlanIds.size !== 1 || !lockedPlanIds.has(planId)) {
      throw this.conflict('SHIPMENT_SESSION_PLAN_CHANGED', 'Session plan identity changed while acquiring locks');
    }
    await tx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id))
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
      .for('update');

    const [activeTote] = await tx
      .select({ id: wmsTables.shipmentToteAssignments.id })
      .from(wmsTables.shipmentToteAssignments)
      .where(
        and(
          eq(wmsTables.shipmentToteAssignments.shipmentId, shipmentId),
          isNull(wmsTables.shipmentToteAssignments.releasedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (activeTote) {
      throw this.conflict('SHIPMENT_TOTE_NOT_RELEASED', 'Shipment cannot dispatch while a tote assignment is active');
    }

    await tx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.dispatchAttempts.attemptNo), asc(wmsTables.dispatchAttempts.id))
      .for('update');

    return { shipment, lines, workItem, session, waybill: activeWaybills[0], planId };
  }

  private assertDispatchCandidate(
    aggregate: LockedDispatchAggregate,
    actor: ShipmentDispatchActor,
    force: boolean,
  ): void {
    if (aggregate.shipment.status !== 'planned') {
      throw this.conflict('SHIPMENT_NOT_DISPATCHABLE', `Shipment is ${aggregate.shipment.status}`);
    }
    if (!['ready_to_pack', 'packing'].includes(aggregate.workItem.status)) {
      throw this.conflict('SHIPMENT_NOT_INSPECTION_READY', `Work item is ${aggregate.workItem.status}`);
    }
    if (aggregate.session.status !== 'active') {
      throw this.conflict('SHIPMENT_SESSION_NOT_ACTIVE', `Inventory session is ${aggregate.session.status}`);
    }
    if (!force) {
      if (
        aggregate.workItem.status !== 'packing' ||
        aggregate.workItem.packerId !== actor.id ||
        !aggregate.workItem.packerClaimedAt ||
        aggregate.workItem.packerReleasedAt ||
        !aggregate.workItem.leaseExpiresAt ||
        aggregate.workItem.leaseExpiresAt.getTime() <= Date.now()
      ) {
        throw this.conflict('SHIPMENT_PACKER_LEASE_REQUIRED', 'Inspection requires the active packer lease');
      }
    }
  }

  private async resolveInspectionLine(
    barcode: string,
    quantity: number,
    lines: ShipmentLineRow[],
    tx: DbTx,
  ): Promise<ShipmentLineRow> {
    const normalized = barcode.trim();
    if (!normalized) throw new BadRequestException('barcode is required');
    const parsed = this.barcode.parseBarcode(normalized);
    const [registered] = await tx
      .select({ skuId: wmsTables.skuBarcodes.skuId })
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.barcode, normalized))
      .limit(1);
    let skuId = registered?.skuId ?? null;
    if (!skuId && parsed.type === 'sku' && UUID_PATTERN.test(parsed.id)) skuId = parsed.id.toLowerCase();
    if (!skuId && parsed.type === 'unknown' && UUID_PATTERN.test(parsed.id)) skuId = parsed.id.toLowerCase();
    if (!skuId) {
      const [sku] = await tx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.code, normalized))
        .limit(1);
      skuId = sku?.id ?? null;
    }
    if (!skuId) throw this.conflict('SHIPMENT_INSPECTION_BARCODE_UNKNOWN', 'Barcode does not resolve to a SKU');

    const matching = lines
      .filter((line) => line.skuId === skuId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (matching.length === 0) {
      throw this.conflict('SHIPMENT_INSPECTION_SKU_MISMATCH', 'Scanned SKU does not belong to this shipment');
    }
    const line = matching.find((candidate) => candidate.qty - candidate.inspectedQty >= quantity);
    if (!line) {
      throw this.conflict('SHIPMENT_LINE_OVER_INSPECTED', 'Inspection quantity exceeds the remaining matching line');
    }
    return line;
  }

  private async moveInspectionCustody(
    sessionId: string,
    line: ShipmentLineRow,
    quantity: number,
    actorId: string,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<void> {
    const balances = await tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, line.id),
          eq(wmsTables.batchInventorySessionBalances.skuId, line.skuId),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'PACKING'),
          sql`${wmsTables.batchInventorySessionBalances.qty} > 0`,
        ),
      )
      .orderBy(
        asc(wmsTables.batchInventorySessionBalances.sourceLocationId),
        asc(wmsTables.batchInventorySessionBalances.custodyRef),
        asc(wmsTables.batchInventorySessionBalances.id),
      );
    let remaining = quantity;
    for (const balance of balances) {
      if (remaining === 0) break;
      const moved = Math.min(remaining, balance.qty);
      await this.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `inspection:${idempotencyKey}:${balance.id}`,
          actorId,
          quantity: moved,
          from: {
            skuId: line.skuId,
            sourceLocationId: balance.sourceLocationId!,
            custodyType: 'PACKING',
            custodyRef: balance.custodyRef,
            shipmentLineId: line.id,
          },
          to: {
            skuId: line.skuId,
            sourceLocationId: balance.sourceLocationId!,
            custodyType: 'PACKED',
            custodyRef: balance.custodyRef,
            shipmentLineId: line.id,
          },
          context: { kind: 'inspection_scan', shipmentLineId: line.id },
        },
        tx,
      );
      remaining -= moved;
    }
    if (remaining !== 0) {
      throw this.conflict('SHIPMENT_INSPECTION_CUSTODY_SHORT', 'Packing custody is short for this inspection scan');
    }
  }

  private async dispatchLocked(
    aggregate: LockedDispatchAggregate,
    actor: ShipmentDispatchActor,
    tx: DbTx,
    force?: ForceDispatchContext,
  ): Promise<ShipmentDispatchResponse> {
    if (!force && aggregate.lines.some((line) => line.inspectedQty !== line.qty)) {
      throw this.conflict('SHIPMENT_INSPECTION_INCOMPLETE', 'Every shipment line must be inspected');
    }
    // assertDispatchable 이 활성-1개·carrier·trackingNo·manifest/recipient staleness 를 모두 내부 검사한다.
    // 구 invoice.id 비교와 중복 staleness 재검은 불필요 — 제거. seam 순서 계약상 markUsed 보다 반드시 선행한다.
    await this.waybills.assertDispatchable(aggregate.shipment.id, tx);

    const allocations = await tx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, aggregate.planId),
          inArray(
            wmsTables.pickingSourceAllocations.shipmentLineId,
            aggregate.lines.map((line) => line.id),
          ),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
    for (const line of aggregate.lines) {
      const allocated = allocations
        .filter((allocation) => allocation.shipmentLineId === line.id)
        .reduce((sum, allocation) => sum + allocation.qty, 0);
      if (allocated !== line.qty) {
        throw this.conflict(
          'SHIPMENT_DISPATCH_ALLOCATION_MISMATCH',
          `Line ${line.id} allocation is ${allocated}/${line.qty}`,
        );
      }
    }

    const custody = await tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, aggregate.session.id),
          inArray(
            wmsTables.batchInventorySessionBalances.shipmentLineId,
            aggregate.lines.map((line) => line.id),
          ),
          sql`${wmsTables.batchInventorySessionBalances.qty} > 0`,
        ),
      )
      .orderBy(
        asc(wmsTables.batchInventorySessionBalances.shipmentLineId),
        asc(wmsTables.batchInventorySessionBalances.sourceLocationId),
        asc(wmsTables.batchInventorySessionBalances.custodyType),
        asc(wmsTables.batchInventorySessionBalances.id),
      )
      .for('update');
    const exactCustodySources = this.requireExactPackedCustody(aggregate.lines, allocations, custody);

    await acquireStockAvailabilityLocks(
      tx,
      aggregate.lines.map((line) => ({ skuId: line.skuId, warehouseId: aggregate.shipment.warehouseId })),
    );

    const [attemptNoRow] = await tx
      .select({ attemptNo: max(wmsTables.dispatchAttempts.attemptNo) })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.shipmentId, aggregate.shipment.id));
    const attemptNo = Number(attemptNoRow?.attemptNo ?? 0) + 1;
    const attemptId = randomUUID();
    const journalId = randomUUID();
    const attemptKey = `dispatch:${aggregate.shipment.id}:${attemptNo}`;
    const dispatchedAt = new Date();
    await tx.insert(wmsTables.stockJournals).values({
      id: journalId,
      sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
      sourceId: attemptId,
      idempotencyKey: attemptKey,
      actorId: actor.id,
    });
    await tx.insert(wmsTables.dispatchAttempts).values({
      id: attemptId,
      shipmentId: aggregate.shipment.id,
      attemptNo,
      status: 'pending',
      idempotencyKey: attemptKey,
      waybillId: aggregate.waybill.id,
      stockJournalId: journalId,
    });

    const sources: DispatchSource[] = exactCustodySources.map((source) => ({
      id: randomUUID(),
      shipmentLineId: source.shipmentLineId,
      skuId: source.skuId,
      sourceLocationId: source.sourceLocationId,
      qty: source.qty,
    }));
    await tx.insert(wmsTables.dispatchAttemptSources).values(
      sources.map((source) => ({
        id: source.id,
        dispatchAttemptId: attemptId,
        shipmentLineId: source.shipmentLineId,
        sourceLocationId: source.sourceLocationId,
        qty: source.qty,
      })),
    );

    const sourceEvents: Array<{
      dispatchAttemptSourceId: string;
      shipmentLineId: string;
      sourceLocationId: string;
      stockEventId: string;
    }> = [];
    for (const [sourceIndex, source] of sources.entries()) {
      const sourceCustody = exactCustodySources[sourceIndex].balances;
      const shipped = await this.inventory.ship(
        {
          skuId: source.skuId,
          warehouseId: aggregate.shipment.warehouseId,
          locationId: source.sourceLocationId,
          quantity: source.qty,
          occurredAt: dispatchedAt,
          idempotencyKey: `dispatch:${attemptId}:${source.shipmentLineId}:${source.sourceLocationId}`,
          reason: force ? `Force dispatch: ${force.reason}` : `Shipment ${aggregate.shipment.id} dispatched`,
          journalId,
          batchSessionDispatch: { sessionId: aggregate.session.id, dispatchAttemptSourceId: source.id },
          deferSellableProjection: true,
        },
        tx,
      );
      if (!shipped.eventId) throw new Error(`Dispatch source ${source.id} did not create a stock event`);
      sourceEvents.push({
        dispatchAttemptSourceId: source.id,
        shipmentLineId: source.shipmentLineId,
        sourceLocationId: source.sourceLocationId,
        stockEventId: shipped.eventId,
      });

      for (const balance of sourceCustody) {
        await this.sessions.settleForDispatch(
          {
            sessionId: aggregate.session.id,
            idempotencyKey: `dispatch-settle:${source.id}:${balance.id}`,
            actorId: actor.id,
            quantity: balance.qty,
            dispatchAttemptSourceId: source.id,
            from: {
              skuId: source.skuId,
              sourceLocationId: source.sourceLocationId,
              custodyType: balance.custodyType,
              custodyRef: balance.custodyRef,
              shipmentLineId: source.shipmentLineId,
            },
          },
          tx,
        );
      }
    }

    const consumption = await this.shipmentReservations.consumeForDispatch(
      aggregate.shipment.id,
      attemptId,
      aggregate.lines.map((line) => ({ shipmentLineId: line.id, quantity: line.qty })),
      tx,
    );
    await this.incrementFulfillmentItems(aggregate.lines, dispatchedAt, tx);

    // seam 순서: dispatchLocked 상단의 assertDispatchable 이 이미 staleness 를 검증했으므로 여기서는 CAS 만.
    // markUsed 는 staleness 를 재검하지 않는다(registered/used → used 엄격 CAS).
    await this.waybills.markUsed(aggregate.shipment.id, tx);
    await tx
      .update(wmsTables.shipments)
      .set({ status: 'shipped', shippedAt: dispatchedAt, lastUpdated: dispatchedAt })
      .where(eq(wmsTables.shipments.id, aggregate.shipment.id));
    await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'completed', completedAt: dispatchedAt, updatedAt: dispatchedAt })
      .where(eq(wmsTables.outboundBatchWorkItems.id, aggregate.workItem.id));
    await tx
      .update(wmsTables.dispatchAttempts)
      .set({ status: 'dispatched', dispatchedAt, updatedAt: dispatchedAt })
      .where(and(eq(wmsTables.dispatchAttempts.id, attemptId), eq(wmsTables.dispatchAttempts.status, 'pending')));

    await this.shipmentReservations.finalizeDispatchConsumption(aggregate.shipment.id, consumption.affectedSkuIds, tx);
    const summaries = await this.loadFulfillmentSummaries(aggregate.lines, tx);
    const eventIdentities = await this.loadEventLineIdentities(aggregate.shipment.id, tx);
    for (const summary of summaries) {
      if (summary.fullyShipped) {
        await tx
          .update(wmsTables.fulfillmentOrders)
          .set({ shippedAt: dispatchedAt, updatedAt: dispatchedAt })
          .where(eq(wmsTables.fulfillmentOrders.id, summary.fulfillmentOrderId));
      }
    }

    await this.emitDispatchEvents(aggregate, attemptId, attemptNo, dispatchedAt, eventIdentities, summaries, tx);
    await this.audit.logUserActionRequired(
      'shipment.dispatch',
      'fulfillment',
      `Dispatched shipment ${aggregate.shipment.id} as attempt ${attemptNo}`,
      { userId: actor.id },
      {
        shipmentId: aggregate.shipment.id,
        dispatchAttemptId: attemptId,
        attemptNo,
        forcedQuantities: force?.forcedQuantities ?? [],
      },
      tx,
    );
    if (force) {
      await this.audit.logUserActionRequired(
        'shipment.dispatch.force',
        'fulfillment',
        `Force-dispatched shipment ${aggregate.shipment.id}`,
        { userId: actor.id },
        {
          commandRequestId: force.commandRequestId,
          authorization: { scope: force.authorizationScope, granted: true, source: 'scope_guard' },
          reason: force.reason,
          csCaseId: force.csCaseId,
          note: force.note,
          forcedQuantities: force.forcedQuantities,
          shipmentId: aggregate.shipment.id,
          dispatchAttemptId: attemptId,
          fulfillmentOrderIds: summaries.map((summary) => summary.fulfillmentOrderId),
          shipmentManifestVersion: aggregate.shipment.manifestVersion,
          waybill: {
            waybillId: aggregate.waybill.id,
            manifestVersion: aggregate.waybill.manifestVersion,
            recipientHash: aggregate.waybill.recipientHash,
          },
          beforeLineManifest: force.beforeLineManifest,
          afterLineManifest: this.dispatchLineManifest(aggregate.lines),
          lineage: {
            planId: aggregate.planId,
            sessionId: aggregate.session.id,
            workItemId: aggregate.workItem.id,
            dispatchAttemptId: attemptId,
            stockJournalId: journalId,
            dispatchAttemptSourceIds: sources.map((source) => source.id),
            stockEventIds: sourceEvents.map((source) => source.stockEventId),
            sources: sourceEvents,
          },
          stateTransitions: [
            { resource: 'shipment', id: aggregate.shipment.id, from: aggregate.shipment.status, to: 'shipped' },
            { resource: 'waybill', id: aggregate.waybill.id, from: aggregate.waybill.status, to: 'used' },
            { resource: 'work_item', id: aggregate.workItem.id, from: aggregate.workItem.status, to: 'completed' },
            { resource: 'dispatch_attempt', id: attemptId, from: 'absent', via: 'pending', to: 'dispatched' },
          ],
          fulfillmentProgress: summaries.map((summary) => ({
            fulfillmentOrderId: summary.fulfillmentOrderId,
            shippedQty: summary.shippedQty,
            canceledQty: summary.canceledQty,
            outstandingQty: summary.outstandingQty,
          })),
        },
        tx,
      );
    }

    return {
      shipmentId: aggregate.shipment.id,
      status: 'shipped',
      dispatchAttemptId: attemptId,
      attemptNo,
      ...(force ? { forcedQuantities: force.forcedQuantities } : {}),
    };
  }

  private requireExactPackedCustody(
    lines: ShipmentLineRow[],
    allocations: DispatchAllocation[],
    custody: Array<typeof wmsTables.batchInventorySessionBalances.$inferSelect>,
  ): ExactDispatchCustodySource[] {
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const allocationBySource = new Map<string, DispatchAllocation>();
    for (const allocation of allocations) {
      const key = `${allocation.shipmentLineId}|${allocation.sourceLocationId}`;
      const current = allocationBySource.get(key);
      allocationBySource.set(key, { ...allocation, qty: (current?.qty ?? 0) + allocation.qty });
    }

    const custodyBySource = new Map<
      string,
      {
        shipmentLineId: string;
        sourceLocationId: string;
        skuId: string;
        qty: number;
        balances: Array<typeof wmsTables.batchInventorySessionBalances.$inferSelect>;
      }
    >();
    for (const balance of custody) {
      const line = balance.shipmentLineId ? lineById.get(balance.shipmentLineId) : undefined;
      if (!line || !balance.sourceLocationId || balance.skuId !== line.skuId || balance.custodyType !== 'PACKED') {
        throw this.conflict(
          'SHIPMENT_DISPATCH_CUSTODY_MISMATCH',
          'Every positive shipment-line custody balance must be PACKED for the allocated SKU and source',
        );
      }
      const key = `${line.id}|${balance.sourceLocationId}`;
      const current = custodyBySource.get(key);
      custodyBySource.set(key, {
        shipmentLineId: line.id,
        sourceLocationId: balance.sourceLocationId,
        skuId: line.skuId,
        qty: (current?.qty ?? 0) + balance.qty,
        balances: [...(current?.balances ?? []), balance],
      });
    }

    if (custodyBySource.size !== allocationBySource.size) {
      throw this.conflict(
        'SHIPMENT_DISPATCH_CUSTODY_MISMATCH',
        'Positive shipment-line custody sources do not exactly match picking allocations',
      );
    }
    const exactSources: ExactDispatchCustodySource[] = [];
    for (const [key, allocation] of allocationBySource) {
      const matched = custodyBySource.get(key);
      if (!matched || matched.qty !== allocation.qty) {
        throw this.conflict(
          'SHIPMENT_DISPATCH_CUSTODY_MISMATCH',
          'Positive shipment-line custody quantities do not exactly match picking allocations',
        );
      }
      exactSources.push({ ...allocation, skuId: matched.skuId, balances: matched.balances });
    }
    return exactSources;
  }

  private dispatchLineManifest(lines: ShipmentLineRow[]): DispatchLineManifestEvidence[] {
    return [...lines]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((line) => ({
        shipmentLineId: line.id,
        fulfillmentOrderItemId: line.fulfillmentOrderItemId,
        skuId: line.skuId,
        qty: line.qty,
        inspectedQty: line.inspectedQty,
        forced: line.forced,
        lineVersion: line.lineVersion,
      }));
  }

  private async incrementFulfillmentItems(lines: ShipmentLineRow[], now: Date, tx: DbTx): Promise<void> {
    for (const line of lines) {
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, line.fulfillmentOrderItemId))
        .limit(1);
      if (!item) throw this.conflict('SHIPMENT_FOI_MISSING', `FOI ${line.fulfillmentOrderItemId} disappeared`);
      if (item.shippedQty + item.canceledQty + line.qty > item.qty) {
        throw this.conflict('SHIPMENT_FOI_OVER_SHIPPED', `FOI ${item.id} cannot accept shipment line ${line.id}`);
      }
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: item.shippedQty + line.qty, updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
    }
  }

  private async loadFulfillmentSummaries(lines: ShipmentLineRow[], tx: DbTx): Promise<FulfillmentSummary[]> {
    const foiRows = await tx
      .select({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        inArray(
          wmsTables.fulfillmentOrderItems.id,
          lines.map((line) => line.fulfillmentOrderItemId),
        ),
      );
    const fulfillmentOrderIds = [...new Set(foiRows.map((row) => row.fulfillmentOrderId))].sort();
    const summaries: FulfillmentSummary[] = [];
    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!fo) throw this.conflict('SHIPMENT_FULFILLMENT_ORDER_MISSING', `FO ${fulfillmentOrderId} disappeared`);
      const items = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId))
        .orderBy(asc(wmsTables.fulfillmentOrderItems.id));
      const shippedQty = items.reduce((sum, item) => sum + item.shippedQty, 0);
      const canceledQty = items.reduce((sum, item) => sum + item.canceledQty, 0);
      const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
      const outstandingQty = totalQty - shippedQty - canceledQty;
      const fullyShipped = outstandingQty === 0 && canceledQty === 0;
      summaries.push({
        fulfillmentOrderId,
        salesOrderId: fo.salesOrderId,
        shippedQty,
        canceledQty,
        outstandingQty,
        fullyShipped,
        items: items.map((item) => ({ id: item.id, skuId: item.skuId, shippedQty: item.shippedQty })),
      });
    }
    return summaries;
  }

  private async loadEventLineIdentities(shipmentId: string, tx: DbTx): Promise<EventLineIdentity[]> {
    const rows = await tx
      .select({
        shipmentLineId: wmsTables.shipmentLines.id,
        fulfillmentOrderItemId: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        salesOrderId: wmsTables.salesOrders.id,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        salesChannel: wmsTables.salesOrders.salesChannel,
        channelOrderId: wmsTables.salesOrders.channelOrderId,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        channelProductId: wmsTables.salesOrderLines.channelProductId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        fulfillmentOrderItemQty: wmsTables.fulfillmentOrderItems.qty,
        fulfillmentOrderItemShippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        fulfillmentOrderItemCanceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
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
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .leftJoin(
        wmsTables.salesOrderLines,
        sql`${wmsTables.salesOrderLines.id}::text = ${wmsTables.fulfillmentOrderItems.salesOrderLineId}`,
      )
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.fulfillmentOrders.id), asc(wmsTables.shipmentLines.id));
    const invalid = rows.find(
      (row) =>
        row.salesChannel !== null &&
        TRUSTED_CHANNEL_DISPATCH_SALES_CHANNELS.has(row.salesChannel) &&
        (!row.salesOrderId ||
          !row.salesOrderLineId ||
          !UUID_PATTERN.test(row.salesOrderLineId) ||
          !row.channelOrderItemId?.trim() ||
          !row.channelOrderId?.trim()),
    );
    if (invalid) {
      throw this.conflict(
        'SHIPMENT_EVENT_IDENTITY_MISSING',
        `Shipment line ${invalid.shipmentLineId} has no trusted channel identity`,
      );
    }
    return rows.filter(
      (row) =>
        row.salesOrderId !== null &&
        row.salesOrderLineId !== null &&
        UUID_PATTERN.test(row.salesOrderLineId) &&
        row.salesChannel !== null &&
        Boolean(row.channelOrderId?.trim()) &&
        Boolean(row.channelOrderItemId?.trim()),
    ) as EventLineIdentity[];
  }

  private async emitDispatchEvents(
    aggregate: LockedDispatchAggregate,
    attemptId: string,
    attemptNo: number,
    dispatchedAt: Date,
    lines: EventLineIdentity[],
    summaries: FulfillmentSummary[],
    tx: DbTx,
  ): Promise<void> {
    // assertDispatchable 이 carrier/trackingNo 존재를 이미 보장하지만, 이벤트 계약(non-null trackingNo)을 위해
    // 여기서 타입을 좁힌다. waybill.carrier 는 not-null 이라 별도 가드 불필요(구 invoice 는 그 반대였다).
    const waybill = aggregate.waybill;
    if (!waybill.trackingNo) {
      throw this.conflict('SHIPMENT_INVOICE_NOT_READY', 'Dispatch waybill tracking number is missing');
    }
    const summaryByFo = new Map(summaries.map((summary) => [summary.fulfillmentOrderId, summary]));
    const orders: ShipmentEventOrder[] = [];
    for (const fulfillmentOrderId of [...new Set(lines.map((line) => line.fulfillmentOrderId))].sort()) {
      const orderLines = lines.filter((line) => line.fulfillmentOrderId === fulfillmentOrderId);
      const first = orderLines[0];
      const summary = summaryByFo.get(fulfillmentOrderId)!;
      orders.push({
        salesOrderId: first.salesOrderId,
        fulfillmentOrderId,
        salesChannel: first.salesChannel,
        channelOrderId: first.channelOrderId,
        isPartial: summary.outstandingQty > 0,
        lines: orderLines.map((line) => ({
          shipmentLineId: line.shipmentLineId,
          fulfillmentOrderItemId: line.fulfillmentOrderItemId,
          salesOrderLineId: line.salesOrderLineId,
          channelOrderItemId: line.channelOrderItemId,
          ...(line.channelProductId ? { channelProductId: line.channelProductId } : {}),
          skuId: line.skuId,
          qty: line.qty,
          isPartialQuantity:
            line.qty <
            line.fulfillmentOrderItemQty -
              (line.fulfillmentOrderItemShippedQty - line.qty) -
              line.fulfillmentOrderItemCanceledQty,
        })),
      });
    }
    const shipmentPayload: ShipmentShippedPayload = {
      shipmentId: aggregate.shipment.id,
      dispatchAttemptId: attemptId,
      attemptNo,
      warehouseId: aggregate.shipment.warehouseId,
      dispatchedAt: dispatchedAt.toISOString(),
      invoice: { invoiceId: waybill.id, carrier: waybill.carrier, trackingNo: waybill.trackingNo },
      orders,
    };
    await this.outbox.enqueue(shipmentShippedOutboxEvent(shipmentPayload), tx);

    for (const summary of summaries) {
      const progressed: FulfillmentProgressedPayload = {
        fulfillmentOrderId: summary.fulfillmentOrderId,
        salesOrderId: summary.salesOrderId,
        dispatchAttemptId: attemptId,
        progressedAt: dispatchedAt.toISOString(),
        shippedQty: summary.shippedQty,
        canceledQty: summary.canceledQty,
        outstandingQty: summary.outstandingQty,
      };
      await this.outbox.enqueue(fulfillmentProgressedOutboxEvent(progressed), tx);

      const eventLine = lines.find((line) => line.fulfillmentOrderId === summary.fulfillmentOrderId);
      if (summary.fullyShipped && summary.salesOrderId && eventLine) {
        const v1Payload: FulfillmentShippedPayload = {
          fulfillmentId: summary.fulfillmentOrderId,
          orderId: summary.salesOrderId,
          channelOrderId: eventLine.channelOrderId,
          trackingInfo: { carrier: waybill.carrier, trackingNumber: waybill.trackingNo },
          shippedAt: dispatchedAt.toISOString(),
          shippedItems: summary.items.map((item) => ({
            fulfillmentItemId: item.id,
            skuId: item.skuId,
            shippedQty: item.shippedQty,
          })),
        };
        await this.outbox.enqueue(
          fulfillmentShippedV1OutboxEvent(v1Payload, { ...summary, salesOrderId: summary.salesOrderId }),
          tx,
        );
      }
    }
  }

  private assertActor(actor: ShipmentDispatchActor): void {
    if (!actor.id.trim()) throw new BadRequestException('actor.id is required');
  }

  private assertPositiveInteger(name: string, value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException(`${name} must be a positive integer`);
  }

  private payloadString(payload: unknown, key: string): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
