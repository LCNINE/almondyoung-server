import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { and, asc, eq, ne } from 'drizzle-orm';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { describeStartBlockers } from '../picking/allocation/allocation.locks';
import { StartBlockerView } from '../picking/allocation/allocation.types';
import {
  ReportShipmentShortPickDto,
  SHIPMENT_SHORT_PICK_REASONS,
  ShipmentShortPickActor,
  ShipmentShortPickReason,
  ShipmentShortPickResponseDto,
  ShortPickRefillDto,
  ShortPickShortageDto,
} from '../dto/shipment-short-pick.dto';
import { ApprovedShortageReasonCode, ShortPickOperationIntentProof } from './batch-inventory-session.service';
import { BoxAllocationManager, RefillView } from './box-allocation.manager';
import { BoxWithdrawalService, WorkItemRow } from './box-withdrawal.service';
import { FulfillmentCommandResult, FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

/** 결품을 보고할 수 있는 작업 항목 — 아직 박스에 담기 전(집는 중이거나 대기). */
const SHORT_PICK_WORK_ITEM_STATUSES: readonly string[] = ['queued', 'picking'];

@Injectable()
export class ShipmentShortPickService {
  constructor(
    private readonly commands: FulfillmentCommandService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly boxes: BoxAllocationManager,
    private readonly withdrawals: BoxWithdrawalService,
  ) {}

  /**
   * 결품 보고(스펙 §9) — 한 트랜잭션. 안 집은 몫을 부족 승인하고 결품 로케이션을 뺀 곳에서 다시 채운다. 못 채우면 이탈(exit_to=draft)이
   * 결품 오퍼레이션을 기다리고, 나가기가 예약·송장·박스를 정리한다(PR 4 계획이 정함 1~6 — 마무리는 `ShortPickExitService`).
   * 잠금: 구성요소 → 박스·줄 → 작업 항목 → 세션·보관 → 배정(판정) → 오퍼레이션·멤버 INSERT → 부족 승인 → SKU 가용·원장.
   */
  async report(
    shipmentId: string,
    dto: ReportShipmentShortPickDto,
    idempotencyKey: string,
    actor: ShipmentShortPickActor,
    tx?: DbTx,
  ): Promise<ShipmentShortPickResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.short_pick.report');
    this.assertDto(dto);
    await this.requireScope(actor);
    return this.commands.execute<ShipmentShortPickResponseDto>(
      {
        commandType: 'shipment.short_pick.report',
        idempotencyKey,
        canonicalRequest: { shipmentId, actorId: actor.id, ...dto },
      },
      async (trx, commandRequestId, requestHash) => {
        await this.withdrawals.lockComponentsOf([shipmentId], trx);
        const { lines } = await this.lockAndValidateShipment(shipmentId, dto, trx);
        const workItem = await this.lockWorkItem(shipmentId, dto, trx);
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${workItem.batchId} referenced by a work item is missing`);
        const session = await this.boxes.lockOpenSession(workItem.batchId, trx);
        if (!session || session.id !== dto.sessionId || session.version !== dto.expectedSessionVersion) {
          throw this.conflict('SHORT_PICK_SESSION_STALE', 'Inventory session identity/version is invalid');
        }
        if (session.status !== 'active') {
          throw this.conflict(
            'PICKING_SESSION_NOT_ACTIVE',
            `Batch ${workItem.batchId} inventory session is ${session.status}`,
          );
        }
        const { active: waybill, voidable } = await this.withdrawals.exitWaybill(shipmentId, trx);
        if (waybill?.status === 'used')
          throw this.conflict('SHORT_PICK_DISPATCH_EXISTS', 'A used waybill cannot be short-picked');

        // 판정 먼저(쓰지 않는다) — 모자라면 SHORT_PICK_EXCEEDS_UNPICKED 로 전부 보고하고 오퍼레이션도 남기지 않는다.
        const planned = await this.boxes.planShortages(
          {
            session,
            workItemId: workItem.id,
            shortages: dto.lines.map((line) => ({
              shipmentLineId: line.shipmentLineId,
              sourceLocationId: line.sourceLocationId,
              qty: line.shortQty,
            })),
          },
          trx,
        );
        const operationId = randomUUID();
        // 의도의 allocationQty 는 보고 시점 배정(감소 전). 세션의 부족 승인이 이 의도를 읽으므로 승인보다 먼저 적는다.
        const intent: ShortPickOperationIntentProof = {
          kind: 'short_pick',
          operationId,
          shipmentId,
          workItemId: workItem.id,
          sessionId: session.id,
          reason: dto.reason,
          actorId: actor.id,
          lines: planned.map((row) => ({
            shipmentLineId: row.shipmentLineId,
            sourceLocationId: row.sourceLocationId,
            shortQty: row.qty,
            allocationQty: row.allocationQty,
          })),
        };
        await trx.insert(wmsTables.shipmentOperations).values({
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
        await trx.insert(wmsTables.shipmentOperationMembers).values({
          operationId,
          shipmentId,
          role: 'source',
          beforeManifestVersion: dto.expectedManifestVersion,
          beforeManifestSnapshot: { expectedManifestVersion: dto.expectedManifestVersion },
        });
        await this.boxes.approveShortages(
          {
            session,
            workItemId: workItem.id,
            shortPickOperationId: operationId,
            actorId: actor.id,
            reasonCode: this.reasonCode(dto.reason),
            reason: dto.reason,
            planned,
          },
          trx,
        );
        const approved = planned;
        const allLines = lines.map((line) => ({ id: line.id, skuId: line.skuId, qty: line.qty }));
        const plan = await this.boxes.planRefill(
          {
            session,
            warehouseId: batch.warehouseId,
            workItemId: workItem.id,
            lines: allLines,
            excludedSources: approved.map((row) => ({ skuId: row.skuId, sourceLocationId: row.sourceLocationId })),
          },
          trx,
        );
        if (!plan.shortages.length) {
          const refills = await this.boxes.applyRefill(
            {
              session,
              batchId: workItem.batchId,
              actorId: actor.id,
              operationId: commandRequestId,
              plan,
              lines: allLines,
            },
            trx,
          );
          await this.completeRefilled(operationId, shipmentId, dto.expectedManifestVersion, refills, trx);
          await this.audit.logUserActionRequired(
            'shipment.short_pick.refilled',
            'fulfillment',
            `Short pick operation ${operationId} refilled shipment ${shipmentId}`,
            { userId: actor.id },
            { operationId, shipmentId, workItemId: workItem.id, approved, refills },
            trx,
          );
          return this.done({
            operationId,
            shipmentId,
            workItemId: workItem.id,
            operationStatus: 'completed',
            outcome: 'refilled',
            refills: refills.map(toRefillDto),
            shortages: [],
          });
        }
        // 못 채움 → 이탈. 나갈 때 송장을 무효화하므로 지금 무효화할 수 있어야 한다(정한 것 3).
        if (!voidable) {
          throw this.conflict(
            'SHORT_PICK_INVOICE_NOT_VOIDABLE',
            `Waybill ${waybill?.id} is ${waybill?.status}; resolve it before short-pick withdrawal`,
          );
        }
        const shortages = await describeStartBlockers(
          trx,
          plan.shortages.map((shortage) => ({
            shipmentId,
            reason: shortage.reason,
            shipmentLineId: shortage.shipmentLineId,
            skuId: shortage.skuId,
            requiredQty: shortage.requiredQty,
            shortQty: shortage.shortQty,
            detail: null,
          })),
        );
        const outcome = await this.withdrawals.begin(
          {
            batchId: workItem.batchId,
            shipmentId,
            shipmentStatus: 'planned',
            workItem,
            lines: lines.map((line) => ({ id: line.id, skuId: line.skuId })),
            exitTo: 'draft',
            reason: `short_pick:${dto.reason}`,
            waitingOperationId: operationId,
            actorId: actor.id,
            operationId: commandRequestId,
          },
          trx,
        );
        await this.audit.logUserActionRequired(
          'shipment.short_pick.withdrawing',
          'fulfillment',
          `Short pick operation ${operationId} could not refill shipment ${shipmentId}`,
          { userId: actor.id },
          { operationId, shipmentId, workItemId: workItem.id, approved, shortages, outcome: outcome.kind },
          trx,
        );
        return this.done({
          operationId,
          shipmentId,
          workItemId: workItem.id,
          operationStatus: outcome.kind === 'exited' ? 'completed' : 'pending',
          outcome: outcome.kind,
          refills: [],
          shortages: shortages.map(toShortageDto),
        });
      },
      tx,
    );
  }

  /**
   * 박스·줄을 잠그고 요청을 판정한다(planned·매니페스트·발송 시도·줄 버전·줄 수량·쌍 중복). 배정 행 잠금과 «안 집은 몫» 판정은
   * `BoxAllocationManager.planShortages` 의 몫이다.
   */
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
    return { shipment, lines };
  }

  /**
   * 작업 항목 하나를 잠그고 판정한다 — 박스 일치 → 빼는 중 → 상태 → 임대 버전 → 다른 오퍼레이션 대기 순.
   */
  private async lockWorkItem(shipmentId: string, dto: ReportShipmentShortPickDto, tx: DbTx): Promise<WorkItemRow> {
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, dto.workItemId))
      .limit(1)
      .for('update');
    if (!workItem || workItem.shipmentId !== shipmentId) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_MISMATCH', 'Work item mismatch');
    }
    if (workItem.status === 'withdrawing') {
      throw this.conflict('SHIPMENT_WITHDRAWN', `Shipment ${shipmentId} is leaving its batch`);
    }
    if (!SHORT_PICK_WORK_ITEM_STATUSES.includes(workItem.status)) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_STATE', `Work item is ${workItem.status}`);
    }
    if (workItem.leaseVersion !== dto.expectedWorkItemLeaseVersion) {
      throw this.conflict('SHORT_PICK_WORK_ITEM_STALE', 'Work item lease version changed');
    }
    if (workItem.waitingOperationId) {
      throw this.conflict(
        'SHORT_PICK_WORK_ITEM_WAITING',
        `Work item ${workItem.id} waits for operation ${workItem.waitingOperationId}`,
      );
    }
    return workItem;
  }

  /** 채움 — 멤버·오퍼레이션을 completed 로. 박스는 그대로라 매니페스트 버전도 그대로다(`ShortPickExitService.complete` 와 같은 모양). */
  private async completeRefilled(
    operationId: string,
    shipmentId: string,
    manifestVersion: number,
    refills: RefillView[],
    tx: DbTx,
  ): Promise<void> {
    const after = { outcome: 'refilled', refills };
    await tx
      .update(wmsTables.shipmentOperationMembers)
      .set({ afterManifestVersion: manifestVersion, afterManifestSnapshot: after })
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      );
    const [done] = await tx
      .update(wmsTables.shipmentOperations)
      .set({ status: 'completed', afterManifestSnapshot: after, lastError: null, completedAt: new Date() })
      .where(and(eq(wmsTables.shipmentOperations.id, operationId), eq(wmsTables.shipmentOperations.status, 'pending')))
      .returning({ id: wmsTables.shipmentOperations.id });
    if (!done) throw new Error(`Short-pick operation ${operationId} left pending before its refill completed`);
  }

  private done(
    response: Omit<ShipmentShortPickResponseDto, 'invoiceOperationId'>,
  ): FulfillmentCommandResult<ShipmentShortPickResponseDto> {
    return {
      response: { ...response, invoiceOperationId: null },
      resourceType: 'shipment_operation',
      resourceId: response.operationId,
      operationId: response.operationId,
    };
  }

  private reasonCode(reason: ShipmentShortPickReason): ApprovedShortageReasonCode {
    if (reason === 'inventory_shortage') return 'MISSING';
    if (reason === 'item_damaged') return 'DAMAGED';
    return 'DEFECTIVE';
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

function toRefillDto(refill: RefillView): ShortPickRefillDto {
  return {
    shipmentLineId: refill.shipmentLineId,
    skuId: refill.skuId,
    sourceLocationId: refill.sourceLocationId,
    locationCode: refill.locationCode,
    qty: refill.qty,
  };
}

function toShortageDto(view: StartBlockerView): ShortPickShortageDto {
  // holds because the blockers come from plan.shortages (line reasons only) — never a waybill blocker.
  if (view.reason === 'WAYBILL_NOT_READY') throw new Error('A refill shortage cannot be a waybill blocker');
  return {
    shipmentLineId: view.shipmentLineId,
    skuId: view.skuId,
    skuCode: view.skuCode,
    skuName: view.skuName,
    requiredQty: view.requiredQty,
    shortQty: view.shortQty,
    reason: view.reason,
  };
}
