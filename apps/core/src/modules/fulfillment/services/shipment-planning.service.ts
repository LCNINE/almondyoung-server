import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { AuthorizationService } from '@app/authorization';
import { and, asc, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  CancelShipmentOutstandingDto,
  PlanShipmentDto,
  ReviseShipmentRecipientDto,
  ShipmentPlanningActor,
  ShipmentDetailResponseDto,
  ShipmentSummaryResponseDto,
  FulfillmentOperationResponseDto,
  SplitShipmentDto,
} from '../dto/shipment-planning.dto';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { BoxWithdrawalService, WorkItemRow } from './box-withdrawal.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';

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

type CancelResponse = {
  operationId: string;
  operationStatus: 'pending' | 'completed';
  shipmentId: string;
  manifestVersion: number;
  shipment?: ShipmentManifestSnapshot;
};

type PendingCancellationIntent = {
  kind: 'cancel_outstanding';
  shipmentId: string;
  expectedManifestVersion: number;
  lines: CancelShipmentOutstandingDto['lines'];
  reason: string;
  csCaseId: string | null;
  note: string | null;
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

function sameJson(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.trim() : value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // null 과 undefined 를 같게 본다. @IsOptional() 은 null 을 통과시키므로 저장된
        // 스냅샷에 `deliveryNote: null` 이 남아 있을 수 있는데, 그걸 "키 없음"과 다르게
        // 읽으면 주소를 안 고친 정정에서도 manifestVersion 이 올라간다.
        .filter(([, entry]) => entry !== undefined && entry !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

type RecipientRevisionUpdate = {
  recipientSnapshot?: (typeof wmsTables.shipments.$inferInsert)['recipientSnapshot'];
  manifestVersion?: number;
  entrancePassword?: string;
};

export type RecipientRevisionOutcome = {
  update: RecipientRevisionUpdate;
  snapshotChanged: boolean;
  passwordChanged: boolean;
};

/**
 * 수령인 정정 요청을 shipments update 패치로 바꾼다.
 *
 * 공동현관 비번은 recipient_snapshot 밖에 사는 크리덴셜이지 배송 지시가 아니다.
 * 그래서 비번만 정정하면 recipientSnapshot 도 manifestVersion 도 패치에 담지
 * 않는다 — 그 둘은 합배송 호환성(canonicalConsolidationRecipient)과 송장 멱등성
 * (waybill.recipientHash / manifestVersion)의 입력이라, 주소가 그대로인데 값이
 * 움직이면 이미 발행된 멀쩡한 송장이 stale 로 무효화된다.
 *
 * 빈 패치는 "바뀐 게 없다"는 뜻이며 호출자가 거절한다. 공백뿐인 비번은 정정으로
 * 치지 않는다(빈 값으로 지우는 경로는 이 커맨드의 범위 밖이다).
 */
export function resolveRecipientRevision(
  current: { recipientSnapshot: unknown; manifestVersion: number; entrancePassword: string | null },
  requested: { recipientSnapshot?: unknown; entrancePassword?: string },
): RecipientRevisionOutcome {
  const update: RecipientRevisionUpdate = {};
  const snapshotChanged =
    requested.recipientSnapshot !== undefined && !sameJson(current.recipientSnapshot, requested.recipientSnapshot);
  if (snapshotChanged) {
    update.recipientSnapshot = requested.recipientSnapshot;
    update.manifestVersion = current.manifestVersion + 1;
  }

  const nextPassword = requested.entrancePassword?.trim() ?? '';
  const passwordChanged = nextPassword !== '' && nextPassword !== current.entrancePassword;
  if (passwordChanged) update.entrancePassword = nextPassword;

  return { update, snapshotChanged, passwordChanged };
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
    private readonly withdrawals: BoxWithdrawalService,
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
        await this.assertNoActiveWaybill(shipmentId, tx);

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
            // 분할된 상자도 같은 문 앞에 선다 — 비번을 안 물려주면 이 상자의 송장에만
            // 현관 정보가 빠진 채 나가고 기사가 문을 못 연다. 주소를 복사하면서 비번을
            // 빠뜨리는 것이 정확히 그 사고다.
            entrancePassword: aggregate.shipment.entrancePassword,
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
        await this.assertNoActiveWaybill(shipmentId, tx);

        const revision = resolveRecipientRevision(
          {
            recipientSnapshot: aggregate.shipment.recipientSnapshot,
            manifestVersion: aggregate.shipment.manifestVersion,
            entrancePassword: aggregate.shipment.entrancePassword,
          },
          dto,
        );
        if (!revision.snapshotChanged && !revision.passwordChanged) {
          // 비번 값은 메시지에 싣지 않는다 — 크리덴셜이라 예외 본문·로그에 남으면 안 된다.
          throw new BadRequestException('Recipient revision has no change');
        }
        // 배송 지시를 실제로 덮어쓸 때만 override 스코프를 요구한다. 비번만 고치는
        // 정정은 주문의 배송지를 건드리지 않으므로 이 판정에 들어가지 않는다.
        const orderRecipients = revision.snapshotChanged ? await this.loadOrderRecipientSnapshots(aggregate, tx) : [];
        const overridesOrder = orderRecipients.some((recipient) => !sameJson(recipient, dto.recipientSnapshot));
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
          .set({ ...revision.update, lastUpdated: new Date() })
          .where(eq(wmsTables.shipments.id, shipmentId));
        await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
        const after = this.snapshot(await this.loadAggregate(shipmentId, tx));
        await this.completeOperation(tx, operation.id, [{ shipmentId, role: 'target', before, after }]);
        await this.auditCommand(tx, actor, 'shipment.revise_recipient', operation.id, dto.reason, {
          shipmentId,
          overridesOrder,
          // 비번은 값이 아니라 "바뀌었다"는 사실만 남긴다. before/after 스냅샷에도
          // entrancePassword 는 들어 있지 않다.
          entrancePasswordRevised: revision.passwordChanged,
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
        await this.assertNoActiveWaybill(shipmentId, tx);
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

    return this.commands.execute<CancelResponse>(
      {
        commandType: 'shipment.cancel_outstanding',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto, lines: requestedLines },
      },
      async (tx, commandRequestId, requestHash) => {
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

        // 전체 취소 연결(E10, 스펙 §8): 시작된 배치의 박스를 전량 취소하면 대기가 아니라 이탈로 끝낸다.
        const withdrawal = await this.withdrawalTarget(aggregate, requestedLines, tx);
        if (withdrawal) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
          await this.recordPendingIntent(tx, operation.id, aggregate, dto, requestedLines, before);
          const outcome = await this.withdrawals.begin(
            {
              batchId: withdrawal.batchId,
              shipmentId,
              shipmentStatus: aggregate.shipment.status,
              workItem: withdrawal.workItem,
              lines: aggregate.lines.map((line) => ({ id: line.id, skuId: line.skuId })),
              exitTo: 'canceled',
              reason: dto.reason,
              waitingOperationId: operation.id,
              actorId: actor.id,
              operationId: commandRequestId,
            },
            tx,
          );
          if (outcome.kind === 'exited') {
            const response = await this.finishWithdrawnCancellation(operation.id, tx);
            return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
          }
          await this.auditCommand(tx, actor, 'shipment.cancel_outstanding.withdrawing', operation.id, dto.reason, {
            shipmentId,
            workItemId: outcome.workItem.id,
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

        if (await this.requiresDurableReplan(aggregate, tx)) {
          await this.requireScope(actor, FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
          await this.markActiveWorkItemWaitingForCancellation(shipmentId, operation.id, tx);
          await tx
            .update(wmsTables.shipments)
            .set({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING', lastUpdated: new Date() })
            .where(eq(wmsTables.shipments.id, shipmentId));
          await this.reservations.recompute(shipmentId, tx);
          await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
          await this.recordPendingIntent(tx, operation.id, aggregate, dto, requestedLines, before);
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

  /** Resume the exact durable cancellation after invoice/work/custody/picking prerequisites have cleared. */
  async resumePendingCancellation(operationId: string, tx?: DbTx): Promise<CancelResponse> {
    this.workflowGate.assertV2MutationAllowed('shipment.cancel_outstanding.resume');
    return this.dbService.run(async (trx) => {
      const [optimisticOperation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      if (!optimisticOperation || optimisticOperation.type !== 'cancel') {
        throw new NotFoundException(`Cancellation operation ${operationId} not found`);
      }
      if (optimisticOperation.status === 'completed') {
        return this.completedCancellationResponse(operationId, trx);
      }
      if (optimisticOperation.status !== 'pending') {
        throw this.conflict(
          'CANCELLATION_OPERATION_NOT_PENDING',
          `Cancellation operation ${operationId} is ${optimisticOperation.status}`,
        );
      }

      const pending = this.pendingCancellationIntent(optimisticOperation.afterManifestSnapshot);
      const aggregate = await this.lockAggregate(pending.shipmentId, trx);
      const [operation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1)
        .for('update');
      if (!operation || operation.type !== 'cancel') {
        throw new NotFoundException(`Cancellation operation ${operationId} not found`);
      }
      if (operation.status === 'completed') {
        return this.completedCancellationResponse(operationId, trx);
      }
      if (operation.status !== 'pending') {
        throw this.conflict(
          'CANCELLATION_OPERATION_NOT_PENDING',
          `Cancellation operation ${operationId} is ${operation.status}`,
        );
      }
      const lockedPending = this.pendingCancellationIntent(operation.afterManifestSnapshot);
      if (JSON.stringify(lockedPending) !== JSON.stringify(pending)) {
        throw this.conflict('CANCELLATION_OPERATION_CHANGED_RETRY', 'Cancellation intent changed; retry resume');
      }
      const [member] = await trx
        .select({ shipmentId: wmsTables.shipmentOperationMembers.shipmentId })
        .from(wmsTables.shipmentOperationMembers)
        .where(
          and(
            eq(wmsTables.shipmentOperationMembers.operationId, operationId),
            eq(wmsTables.shipmentOperationMembers.shipmentId, pending.shipmentId),
            eq(wmsTables.shipmentOperationMembers.role, 'source'),
          ),
        )
        .limit(1);
      if (!member) {
        throw this.conflict(
          'CANCELLATION_OPERATION_MEMBER_MISSING',
          `Cancellation operation ${operationId} is not attached to shipment ${pending.shipmentId}`,
        );
      }
      if (
        aggregate.shipment.status !== 'recovery_required' ||
        aggregate.shipment.recoveryCode !== 'CANCEL_REPLAN_PENDING'
      ) {
        throw this.conflict(
          'CANCELLATION_SOURCE_STATE_CHANGED',
          `Shipment ${pending.shipmentId} is not waiting for cancellation replan`,
        );
      }
      this.assertShipmentVersion(aggregate.shipment, pending.expectedManifestVersion);
      const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
      const selected = pending.lines.map((request) => {
        const line = lineById.get(request.shipmentLineId);
        if (!line) {
          throw this.conflict(
            'CANCELLATION_LINE_CHANGED',
            `Shipment line ${request.shipmentLineId} is no longer in ${pending.shipmentId}`,
          );
        }
        if (line.lineVersion !== request.expectedLineVersion || request.qty > line.qty) {
          throw this.conflict('CANCELLATION_LINE_CHANGED', `Shipment line ${line.id} changed before resume`);
        }
        return { request, line };
      });

      await this.assertNoActiveWaybill(pending.shipmentId, trx);
      await this.assertNoCustodyOrActiveWork(aggregate, trx);
      return this.applyPendingCancellation(operation, pending, aggregate, selected, trx);
    }, tx);
  }

  /**
   * 이탈로 나간 박스의 전체 취소를 끝낸다(E10). 박스가 나가는 트랜잭션에서만 부른다 — 이 서비스의 전체 취소(집은 게 없으면 즉시),
   * 되돌림 명령(`BoxReturnService`, 마지막 몫). 송장은 나가면서 이미 무효화됐다(`BoxWithdrawalService.exitIfDrained`).
   */
  async finishWithdrawnCancellation(operationId: string, tx: DbTx): Promise<CancelResponse> {
    const [operation] = await tx
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1)
      .for('update');
    if (!operation || operation.type !== 'cancel') {
      throw new NotFoundException(`Cancellation operation ${operationId} not found`);
    }
    if (operation.status !== 'pending') {
      throw this.conflict(
        'CANCELLATION_OPERATION_NOT_PENDING',
        `Cancellation operation ${operationId} is ${operation.status}`,
      );
    }
    const pending = this.pendingCancellationIntent(operation.afterManifestSnapshot);
    const aggregate = await this.lockAggregate(pending.shipmentId, tx);
    if (aggregate.shipment.status !== 'planned') {
      throw this.conflict(
        'CANCELLATION_SOURCE_STATE_CHANGED',
        `Shipment ${pending.shipmentId} is ${aggregate.shipment.status}, not the planned box that left its batch`,
      );
    }
    this.assertShipmentVersion(aggregate.shipment, pending.expectedManifestVersion);
    // 되돌림이 PACKED 에서 빼면 inspected_qty 와 line_version 이 바뀐다(정한 것 6) — 줄이 그대로인지는 버전 대신 수량으로 본다.
    const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
    const selected = pending.lines.map((request) => {
      const line = lineById.get(request.shipmentLineId);
      if (!line || request.qty !== line.qty) {
        throw this.conflict('CANCELLATION_LINE_CHANGED', `Shipment line ${request.shipmentLineId} changed before exit`);
      }
      return { request, line };
    });
    if (selected.length !== aggregate.lines.length) {
      throw this.conflict('CANCELLATION_LINE_CHANGED', `Shipment ${pending.shipmentId} lines changed before exit`);
    }
    await this.assertNoActiveWaybill(pending.shipmentId, tx);
    await this.assertNoCustodyOrActiveWork(aggregate, tx);
    return this.applyPendingCancellation(operation, pending, aggregate, selected, tx);
  }

  async getShipmentDetail(shipmentId: string, tx?: DbTx): Promise<ShipmentDetailResponseDto> {
    return this.dbService.run(async (trx) => {
      const aggregate = await this.loadAggregate(shipmentId, trx);
      const lineIds = aggregate.lines.map((line) => line.id);
      const [reservations, waybills, workItems, attempts, origins, operations] = await Promise.all([
        lineIds.length
          ? trx
              .select()
              .from(wmsTables.stockReservations)
              .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds))
              .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
          : [],
        trx
          .select({
            id: wmsTables.waybills.id,
            status: wmsTables.waybills.status,
            trackingNo: wmsTables.waybills.trackingNo,
            carrier: wmsTables.waybills.carrier,
            manifestVersion: wmsTables.waybills.manifestVersion,
            issuedAt: wmsTables.waybills.issuedAt,
            voidedAt: wmsTables.waybills.voidedAt,
          })
          .from(wmsTables.waybills)
          .where(eq(wmsTables.waybills.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.waybills.createdAt)),
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
        trx
          .select({
            operationId: wmsTables.shipmentOperations.id,
            type: wmsTables.shipmentOperations.type,
            status: wmsTables.shipmentOperations.status,
            lastError: wmsTables.shipmentOperations.lastError,
            createdAt: wmsTables.shipmentOperations.createdAt,
            completedAt: wmsTables.shipmentOperations.completedAt,
          })
          .from(wmsTables.shipmentOperationMembers)
          .innerJoin(
            wmsTables.shipmentOperations,
            eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
          )
          .where(eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.shipmentOperations.createdAt), asc(wmsTables.shipmentOperations.id)),
      ]);
      const attemptIds = attempts.map((attempt) => attempt.id);
      const attemptSources: Array<typeof wmsTables.dispatchAttemptSources.$inferSelect> = attemptIds.length
        ? await trx
            .select()
            .from(wmsTables.dispatchAttemptSources)
            .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds))
            .orderBy(asc(wmsTables.dispatchAttemptSources.createdAt), asc(wmsTables.dispatchAttemptSources.id))
        : [];
      const trackingEvents = await trx
        .select()
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.shipmentId, shipmentId))
        .orderBy(asc(wmsTables.shipmentTracking.timestamp), asc(wmsTables.shipmentTracking.id));
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
        waybills,
        workItems,
        dispatchAttempts: attempts.map((attempt) => ({
          ...attempt,
          sources: attemptSources
            .filter((source) => source.dispatchAttemptId === attempt.id)
            .map((source) => ({ ...source, quantity: source.qty })),
          trackingEvents: trackingEvents.filter((event) => event.dispatchAttemptId === attempt.id),
        })),
        operations,
      };
    }, tx);
  }

  async getFulfillmentShipments(fulfillmentOrderId: string, tx?: DbTx): Promise<ShipmentSummaryResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const [fulfillmentOrder] = await trx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!fulfillmentOrder) throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      const rows = await trx
        .select({ shipment: wmsTables.shipments, line: wmsTables.shipmentLines })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId))
        .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id), asc(wmsTables.shipmentLines.id));
      const byShipment = new Map<string, ShipmentSummaryResponseDto>();
      for (const { shipment, line } of rows) {
        const summary = byShipment.get(shipment.id) ?? {
          id: shipment.id,
          status: shipment.status,
          warehouseId: shipment.warehouseId,
          manifestVersion: shipment.manifestVersion,
          reservationVersion: shipment.reservationVersion,
          totalQty: 0,
          reservedQty: 0,
          inspectedQty: 0,
          recoveryCode: shipment.recoveryCode,
        };
        summary.totalQty += line.qty;
        summary.reservedQty += line.reservedQty;
        summary.inspectedQty += line.inspectedQty;
        byShipment.set(shipment.id, summary);
      }
      return [...byShipment.values()];
    }, tx);
  }

  async getOperation(operationId: string, tx?: DbTx): Promise<FulfillmentOperationResponseDto> {
    return this.dbService.run(async (trx) => {
      // Domain sagas take precedence over their completed command envelope so
      // polling never hides a pending/recovery_required provider state.
      const [shipmentOperation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      if (shipmentOperation) {
        return {
          operationId,
          type: shipmentOperation.type,
          status: shipmentOperation.status,
          resourceType: 'shipment_operation',
          resourceId: operationId,
          lastError: shipmentOperation.lastError,
          responseSnapshot: shipmentOperation.afterManifestSnapshot,
          createdAt: shipmentOperation.createdAt,
          completedAt: shipmentOperation.completedAt,
        };
      }
      const [command] = await trx
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(
          or(
            eq(wmsTables.fulfillmentCommandRequests.id, operationId),
            eq(wmsTables.fulfillmentCommandRequests.operationId, operationId),
          ),
        )
        .orderBy(asc(wmsTables.fulfillmentCommandRequests.createdAt))
        .limit(1);
      if (command) {
        return {
          operationId,
          type: command.commandType,
          status: command.status,
          resourceType: command.resourceType,
          resourceId: command.resourceId,
          lastError: command.lastError,
          responseSnapshot: command.responseSnapshot,
          createdAt: command.createdAt,
          completedAt: command.completedAt,
        };
      }
      throw new NotFoundException(`Fulfillment operation ${operationId} not found`);
    }, tx);
  }

  /** 대기 중인 취소를 실제로 적용한다 — 옛 재개(CANCEL_REPLAN_PENDING)와 이탈 완료(E10)가 같은 꼬리를 쓴다. */
  private async applyPendingCancellation(
    operation: typeof wmsTables.shipmentOperations.$inferSelect,
    pending: PendingCancellationIntent,
    aggregate: ShipmentAggregate,
    selected: Array<{ request: CancelShipmentOutstandingDto['lines'][number]; line: ShipmentLineRow }>,
    tx: DbTx,
  ): Promise<CancelResponse> {
    const operationId = operation.id;
    await tx
      .update(wmsTables.shipments)
      .set({ status: 'draft', recoveryCode: null, plannedAt: null, lastUpdated: new Date() })
      .where(eq(wmsTables.shipments.id, pending.shipmentId));
    await tx
      .delete(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, pending.shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      );

    const dto: CancelShipmentOutstandingDto = {
      expectedManifestVersion: pending.expectedManifestVersion,
      lines: pending.lines,
      reason: pending.reason,
      csCaseId: pending.csCaseId ?? undefined,
      note: pending.note ?? undefined,
    };
    const actor = { id: operation.operatorId, roles: [] };
    await this.applyDraftCancellation(
      aggregate,
      selected,
      operation.id,
      dto,
      actor,
      tx,
      (operation.beforeManifestSnapshot as ShipmentManifestSnapshot | null) ?? undefined,
    );
    const after = this.snapshot(await this.loadAggregate(pending.shipmentId, tx));
    const response: CancelResponse = {
      operationId,
      operationStatus: 'completed',
      shipmentId: pending.shipmentId,
      manifestVersion: after.manifestVersion,
      shipment: after,
    };
    await tx
      .update(wmsTables.fulfillmentCommandRequests)
      .set({
        resourceType: 'shipment',
        resourceId: pending.shipmentId,
        responseSnapshot: response,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.fulfillmentCommandRequests.operationId, operationId));
    return response;
  }

  /** 대기 중인 취소의 의도(afterManifestSnapshot.pendingIntent)와 소스 멤버 — 옛 대기 갈래와 이탈 갈래가 같이 쓴다. */
  private async recordPendingIntent(
    tx: DbTx,
    operationId: string,
    aggregate: ShipmentAggregate,
    dto: CancelShipmentOutstandingDto,
    requestedLines: CancelShipmentOutstandingDto['lines'],
    before: ShipmentManifestSnapshot,
  ): Promise<void> {
    const pendingIntent: PendingCancellationIntent = {
      kind: 'cancel_outstanding',
      shipmentId: aggregate.shipment.id,
      expectedManifestVersion: dto.expectedManifestVersion,
      lines: requestedLines,
      reason: dto.reason,
      csCaseId: dto.csCaseId ?? null,
      note: dto.note ?? null,
    };
    await tx
      .update(wmsTables.shipmentOperations)
      .set({ afterManifestSnapshot: { pendingIntent } })
      .where(eq(wmsTables.shipmentOperations.id, operationId));
    await tx.insert(wmsTables.shipmentOperationMembers).values({
      operationId,
      shipmentId: aggregate.shipment.id,
      role: 'source',
      beforeManifestVersion: before.manifestVersion,
      beforeManifestSnapshot: before,
      afterManifestSnapshot: { pendingIntent },
    });
  }

  /**
   * 전체 취소 연결의 대상(정한 것 10) — 박스 전량 취소, 시작된 배치의 활성 작업 항목, 활성 송장이 나갈 때 무효화할 수 있음
   * (없거나 `registered` — `BoxWithdrawalService.exitWaybill`), 이탈을 막는 사유 없음.
   * 아니면 null — 옛 CANCEL_REPLAN_PENDING 대기(부분 취소는 E11, 세션 recovery_required·무효화할 수 없는 송장 등은 운영자 몫).
   * 작업 항목을 FOR UPDATE 로 잡는다(구성요소 다음 — 스펙 §13 순서). 이미 빼는 중이면 begin 이 canceled 로 올린다.
   */
  private async withdrawalTarget(
    aggregate: ShipmentAggregate,
    requestedLines: CancelShipmentOutstandingDto['lines'],
    tx: DbTx,
  ): Promise<{ batchId: string; workItem: WorkItemRow } | null> {
    const requestedByLine = new Map(requestedLines.map((line) => [line.shipmentLineId, line.qty]));
    const whole =
      requestedLines.length === aggregate.lines.length &&
      aggregate.lines.every((line) => requestedByLine.get(line.id) === line.qty);
    if (!whole) return null;
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1)
      .for('update');
    if (!workItem) return null;
    const [batch] = await tx
      .select({ startedAt: wmsTables.outboundBatches.startedAt })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
      .limit(1);
    if (!batch?.startedAt) return null;
    // 이미 빼는 중이면 canceled 로 올린다 — 이 트랜잭션에서 나가지 않으니 송장 조건이 취소를 되돌리지 않는다. 옛 대기로 보내면
    // draft 로 나간 뒤 재개가 SHIPMENT_ACTIVE_INVOICE·CANCELLATION_LINE_CHANGED(PACKED 에서 뺄 때마다 line_version 이 오른다)에 막힌다.
    if (workItem.status === 'withdrawing') return { batchId: workItem.batchId, workItem };
    // 나갈 때 무효화할 수 없는 송장(`pending`·`allocated` 등)이면 이탈로 들이지 않는다 — 집은 게 없는 박스는 이 트랜잭션에서
    // 나가며 WITHDRAWAL_WAYBILL_NOT_VOIDABLE 로 취소 전체(판매 주문 취소 포함)를 되돌린다. 옛 대기가 그 취소를 받는다.
    if (!(await this.withdrawals.exitWaybill(aggregate.shipment.id, tx)).voidable) return null;
    const checked = await this.withdrawals.blockerOf(
      {
        batchId: workItem.batchId,
        shipmentId: aggregate.shipment.id,
        shipmentStatus: aggregate.shipment.status,
        workItem,
      },
      tx,
    );
    return 'blocker' in checked ? null : { batchId: workItem.batchId, workItem };
  }

  private async applyDraftCancellation(
    aggregate: ShipmentAggregate,
    selected: Array<{ request: CancelShipmentOutstandingDto['lines'][number]; line: ShipmentLineRow }>,
    operationId: string,
    dto: CancelShipmentOutstandingDto,
    actor: ShipmentPlanningActor,
    tx: DbTx,
    operationBefore?: ShipmentManifestSnapshot,
  ): Promise<void> {
    const before = operationBefore ?? this.snapshot(aggregate);
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
      // 취소 묘비 상자는 **의도적으로 비번을 안 받는다.** 이 상자는 송장을 발행하지 않고
      // 배송되지도 않으므로 비번을 실을 이유가 없고, 실으면 배송 완료 파기가 영영 도달하지
      // 않는 사본이 하나 더 생긴다(백스톱 배치만 남는다).
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
    }> = [{ shipmentId: aggregate.shipment.id, role: 'source', before, after: sourceAfter }];
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
      before,
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

  // 'SHIPMENT_ACTIVE_INVOICE' 코드 문자열은 운영/클라이언트 의미 보존을 위해 유지(데이터소스만 waybill 로 전환).
  private async assertNoActiveWaybill(shipmentId: string, tx: DbTx): Promise<void> {
    const [waybill] = await tx
      .select({ id: wmsTables.waybills.id, status: wmsTables.waybills.status })
      .from(wmsTables.waybills)
      .where(
        and(
          eq(wmsTables.waybills.shipmentId, shipmentId),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .limit(1);
    if (waybill) throw this.conflict('SHIPMENT_ACTIVE_INVOICE', `Void active waybill ${waybill.id} before editing`);
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

  private async markActiveWorkItemWaitingForCancellation(
    shipmentId: string,
    operationId: string,
    tx: DbTx,
  ): Promise<void> {
    const [workItem] = await tx
      .select({
        id: wmsTables.outboundBatchWorkItems.id,
        waitingOperationId: wmsTables.outboundBatchWorkItems.waitingOperationId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
      .limit(1)
      .for('update');
    if (!workItem) return;
    if (workItem.waitingOperationId && workItem.waitingOperationId !== operationId) {
      throw this.conflict(
        'CANCELLATION_WORK_ITEM_ALREADY_WAITING',
        `Work item ${workItem.id} already waits for operation ${workItem.waitingOperationId}`,
      );
    }
    await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({ waitingOperationId: operationId, updatedAt: new Date() })
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
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
    const [waybill, workItem, consolidation, sessionBalance] = await Promise.all([
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
    return Boolean(waybill[0] || workItem[0] || consolidation[0] || sessionBalance[0]);
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

  private pendingCancellationIntent(value: unknown): PendingCancellationIntent {
    const record = value as { pendingIntent?: PendingCancellationIntent } | null;
    if (!record?.pendingIntent || record.pendingIntent.kind !== 'cancel_outstanding') {
      throw this.conflict('CANCELLATION_PENDING_INTENT_MISSING', 'Pending cancellation intent is missing');
    }
    return record.pendingIntent;
  }

  private async completedCancellationResponse(operationId: string, tx: DbTx): Promise<CancelResponse> {
    const [command] = await tx
      .select({ response: wmsTables.fulfillmentCommandRequests.responseSnapshot })
      .from(wmsTables.fulfillmentCommandRequests)
      .where(eq(wmsTables.fulfillmentCommandRequests.operationId, operationId))
      .limit(1);
    if (!command?.response) {
      throw this.conflict('CANCELLATION_COMMAND_RESULT_MISSING', 'Completed cancellation result is missing');
    }
    return command.response as CancelResponse;
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

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
