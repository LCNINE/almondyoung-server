import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import type {
  DirectDeliveryDispatchDto,
  DirectDeliveryDispatchResultDto,
  DirectDeliveryReturnDto,
  DirectDeliveryReturnResultDto,
  DirectDeliveryTakeoverDto,
  DirectDeliveryTakeoverResultDto,
  DirectDeliveryTrackingDto,
} from '../../dto/one-order-direct.dto';
import type { ShipmentPlanningActor } from '../../dto/shipment-planning.dto';
import { FulfillmentCommandService } from '../../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { loadReservationQueueKey } from '../../services/reservation-queue-key';
import {
  completeShipmentOperation,
  createShipmentOperation,
  loadShipmentAggregate,
  shipmentSnapshot,
} from '../../services/shipment-aggregate';
import {
  lockShipmentConnectedComponentGraph,
  ShipmentReservationService,
} from '../../services/shipment-reservation.service';
import { editShipmentManifest, type ManifestEditDeps } from '../../shipment/shipment-manifest-edit';
import { transitionShipments } from '../../shipment/shipment-lifecycle';
import { resolveOperationReason } from '../../shipment/shipment-operation-reasons';
import { WaybillRepository } from '../../waybill/waybill.repository';
import { normalizeTrackingNo, shipSupplierShipment, type SupplierDispatchDeps } from '../supplier-dispatch';
import { SupplierShipmentNotShippableError } from '../supplier-shipment.errors';
import {
  DirectDeliveryChangedError,
  DirectDeliveryNotEligibleError,
  DirectDeliveryRecipientIncompleteError,
  DirectDeliveryReturnNotEligibleError,
  DirectDeliverySellmateHandedOverError,
} from './one-order-direct.errors';
import {
  type DirectDeliveryFacts,
  loadDirectDeliveryFacts,
  recipientOf,
  returnBlockers,
  takeoverBlockers,
} from './one-order-direct.reader';

/** 예약 행 state_reason 접두 — 어떤 작업이 재고를 놓았는지 행에서 읽힌다. */
export const DIRECT_DELIVERY_RELEASE_REASON = 'direct-delivery';

/**
 * 한 주문만 공급처가 고객에게 바로 보내게 한다. 상자 주인은 바꿀 수 없으므로(쓰기 가드) 새 상자를 열고 옛 상자를 대체한다 —
 * 입점사 합포장과 같은 모양. 예약 대기 순번은 새 줄의 `demand_requested_at` 으로 물려줘 되돌릴 때 그대로 선다.
 */
@Injectable()
export class OneOrderDirectManager {
  constructor(
    private readonly commands: FulfillmentCommandService,
    private readonly reservations: ShipmentReservationService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
    private readonly waybills: WaybillRepository,
    private readonly workflowGate: FulfillmentWorkflowGate,
    @InjectPublisher(SHIPMENT_STREAM) private readonly shipments: PublisherFor<typeof SHIPMENT_STREAM>,
    @InjectPublisher(FULFILLMENT_V2_STREAM)
    private readonly fulfillmentsV2: PublisherFor<typeof FULFILLMENT_V2_STREAM>,
    @InjectPublisher(FULFILLMENT_STREAM) private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    @InjectPublisher(CORE_ORDER_STREAM) private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
  ) {}

  /** 창고 상자 → 공급처 상자. 재고를 놓고 넘김 기록을 남긴다. 송장이 있으면 같은 트랜잭션에서 발송까지. */
  async takeover(
    shipmentId: string,
    dto: DirectDeliveryTakeoverDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ): Promise<DirectDeliveryTakeoverResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.direct_delivery');
    const reason = resolveOperationReason('direct_delivery', dto);
    const tracking = trackingOf(dto);
    return this.commands.execute(
      {
        commandType: 'shipment.direct_delivery',
        idempotencyKey,
        canonicalRequest: {
          actorId: actor.id,
          shipmentId,
          ...dto,
          trackingNo: tracking ? tracking.trackingNo : undefined,
        },
      },
      async (trx, _commandRequestId, requestHash) => {
        const seen = await loadDirectDeliveryFacts(trx, shipmentId);
        const seenWarehouse = seen.box.warehouseId;
        if (seenWarehouse === null) assertTakeover(seen);
        // 상자 → 재고 순으로 잠근다(예약 재시도 워커와 같은 순서). 잠근 뒤 다시 읽어 판정한다.
        if (seenWarehouse !== null) {
          await this.reservations.lockLinesForReservation(
            seen.lines.map((l) => l.lineId),
            seen.lines.map((l) => l.skuId),
            seenWarehouse,
            trx,
          );
        }
        const facts = await loadDirectDeliveryFacts(trx, shipmentId);
        assertTakeover(facts);
        if (facts.box.manifestVersion !== dto.expectedManifestVersion) {
          throw new DirectDeliveryChangedError(
            `Shipment ${shipmentId} changed (version ${facts.box.manifestVersion}, expected ${dto.expectedManifestVersion})`,
          );
        }
        await this.assertSupplier(trx, dto.supplierId);

        // 순번은 예약을 놓기 «전에» 읽는다 — 놓은 뒤에는 확정 예약 행이 사라져 «지금»으로 밀린다
        const queueKeys = new Map<string, Date>();
        for (const line of facts.lines) queueKeys.set(line.lineId, await loadReservationQueueKey(trx, line.lineId));

        const before = shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId));
        const operation = await createShipmentOperation(trx, {
          type: 'direct_delivery',
          actorId: actor.id,
          reason: reason.reason,
          reasonCode: reason.reasonCode,
          requestChannel: reason.requestChannel,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          before,
        });

        const at = new Date();
        let releasedQty = 0;
        const created = await editShipmentManifest(
          this.manifestDeps(),
          { shipmentIds: [shipmentId], allow: ['draft'], at },
          async (writer, aggregates) => {
            const box = aggregates[0].shipment;
            for (const line of aggregates[0].lines) {
              if (line.reservedQty <= 0) continue;
              await this.reservations.releasePartial(
                line.id,
                line.reservedQty,
                `${DIRECT_DELIVERY_RELEASE_REASON}:${operation.id}`,
                trx,
              );
              releasedQty += line.reservedQty;
            }
            const [handoff] = await trx
              .insert(wmsTables.supplierHandoffs)
              .values({ supplierId: dto.supplierId, createdBy: actor.id, createdAt: at })
              .returning({ id: wmsTables.supplierHandoffs.id });
            const target = await writer.createShipment({
              owner: { kind: 'supplier', supplierId: dto.supplierId },
              status: 'draft',
              shippingProfileId: null,
              recipientSnapshot: box.recipientSnapshot,
              entrancePassword: box.entrancePassword,
              supplierHandoffId: handoff.id,
              openedBy: actor.id,
              openedAt: box.openedAt ?? undefined,
            });
            for (const line of aggregates[0].lines) {
              await writer.addLine(target.id, {
                fulfillmentOrderItemId: line.fulfillmentOrderItemId,
                skuId: line.skuId,
                qty: line.qty,
                createdFromLineId: line.id,
                createdAt: line.createdAt,
                demandRequestedAt: queueKeys.get(line.id) ?? line.demandRequestedAt ?? line.createdAt,
              });
            }
            await transitionShipments(trx, {
              shipmentIds: [shipmentId],
              from: ['draft'],
              to: 'superseded',
              at,
              stale: 'unreachable',
            });
            return target.id;
          },
          trx,
        );

        if (tracking) {
          await shipSupplierShipment(this.dispatchDeps(), trx, {
            shipmentId: created,
            carrier: tracking.carrier,
            trackingNo: tracking.trackingNo,
            actorId: actor.id,
            at,
          });
        }

        await completeShipmentOperation(trx, operation.id, [
          {
            shipmentId,
            role: 'source',
            before,
            after: shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId)),
          },
          {
            shipmentId: created,
            role: 'target',
            before: null,
            after: shipmentSnapshot(await loadShipmentAggregate(trx, created)),
          },
        ]);
        await this.audit.logUserActionRequired(
          'shipment.direct_delivery',
          'fulfillment',
          `shipment.direct_delivery operation ${operation.id}`,
          { userId: actor.id },
          {
            operationId: operation.id,
            reason: reason.reason,
            shipmentId,
            targetShipmentId: created,
            supplierId: dto.supplierId,
            releasedQty,
            dispatched: tracking !== null,
          },
          trx,
        );
        const response: DirectDeliveryTakeoverResultDto = {
          shipmentId: created,
          previousShipmentId: shipmentId,
          releasedQty,
          dispatched: tracking !== null,
          operationId: operation.id,
        };
        return { response, resourceType: 'shipment', resourceId: created, operationId: operation.id };
      },
      tx,
    );
  }

  /** 공급처 상자에 송장을 넣어 발송 완료한다. 넘기지 않은(대기) 상자면 그 상자 하나만 넘김 기록을 먼저 남긴다. */
  async dispatch(
    shipmentId: string,
    dto: DirectDeliveryDispatchDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ): Promise<DirectDeliveryDispatchResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.direct_delivery_dispatch');
    const trackingNo = normalizeTrackingNo(dto.trackingNo);
    return this.commands.execute(
      {
        commandType: 'shipment.direct_delivery_dispatch',
        idempotencyKey,
        canonicalRequest: {
          actorId: actor.id,
          shipmentId,
          carrier: dto.carrier,
          trackingNo,
          expectedManifestVersion: dto.expectedManifestVersion,
        },
      },
      async (trx) => {
        const seeds = await trx
          .select({ foiId: wmsTables.shipmentLines.fulfillmentOrderItemId })
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
        if (seeds.length === 0) throw new NotFoundError(`Shipment ${shipmentId} not found`);
        await lockShipmentConnectedComponentGraph(
          trx,
          seeds.map((s) => s.foiId),
        );
        const [box] = await trx
          .select()
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, shipmentId))
          .limit(1)
          .for('update');
        if (!box) throw new NotFoundError(`Shipment ${shipmentId} not found`);
        if (box.supplierId === null || box.status !== 'draft' || box.recoveryCode !== null) {
          throw new SupplierShipmentNotShippableError(
            `Shipment ${shipmentId} cannot be shipped by the supplier (status ${box.status})`,
          );
        }
        // 송장 한 장이 상자 전체를 발송한다 — 창을 연 뒤 합치거나 나눴으면 다시 보게 한다
        if (box.manifestVersion !== dto.expectedManifestVersion) {
          throw new DirectDeliveryChangedError(
            `Shipment ${shipmentId} changed (version ${box.manifestVersion}, expected ${dto.expectedManifestVersion})`,
          );
        }
        const at = new Date();
        let handedOffNow = false;
        if (box.supplierHandoffId === null) {
          if (recipientOf(box.recipientSnapshot, box.entrancePassword) === null) {
            throw new DirectDeliveryRecipientIncompleteError(`Shipment ${shipmentId} has an incomplete recipient`);
          }
          const [handoff] = await trx
            .insert(wmsTables.supplierHandoffs)
            .values({ supplierId: box.supplierId, createdBy: actor.id, createdAt: at })
            .returning({ id: wmsTables.supplierHandoffs.id });
          const stamped = await trx
            .update(wmsTables.shipments)
            .set({ supplierHandoffId: handoff.id })
            .where(and(eq(wmsTables.shipments.id, shipmentId), isNull(wmsTables.shipments.supplierHandoffId)))
            .returning({ id: wmsTables.shipments.id });
          if (stamped.length !== 1) throw new Error(`Supplier handoff ${handoff.id} did not stamp ${shipmentId}`);
          handedOffNow = true;
        }
        const result = await shipSupplierShipment(this.dispatchDeps(), trx, {
          shipmentId,
          carrier: dto.carrier,
          trackingNo,
          actorId: actor.id,
          at,
        });
        const response: DirectDeliveryDispatchResultDto = {
          shipmentId,
          waybillId: result.waybillId,
          handedOffNow,
        };
        return { response, resourceType: 'shipment', resourceId: shipmentId, attemptId: result.attemptId };
      },
      tx,
    );
  }

  /** 공급처 상자(발송 전·회수 뒤) → 창고 상자. 재고는 예약 재시도 워커가 원래 순번대로 다시 잡는다. */
  async returnToWarehouse(
    shipmentId: string,
    dto: DirectDeliveryReturnDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ): Promise<DirectDeliveryReturnResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.direct_delivery_return');
    const reason = resolveOperationReason('direct_delivery_return', dto);
    return this.commands.execute(
      {
        commandType: 'shipment.direct_delivery_return',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx, _commandRequestId, requestHash) => {
        const seen = await loadDirectDeliveryFacts(trx, shipmentId);
        await lockShipmentConnectedComponentGraph(
          trx,
          seen.lines.map((l) => l.fulfillmentOrderItemId),
        );
        const facts = await loadDirectDeliveryFacts(trx, shipmentId);
        const blockers = returnBlockers(facts);
        if (blockers.length > 0) {
          throw new DirectDeliveryReturnNotEligibleError(
            `Shipment ${shipmentId} cannot return to the warehouse: ${blockers.map((b) => b.code).join(',')}`,
          );
        }
        const warehouseId = facts.foWarehouseId;
        if (warehouseId === null) throw new Error(`Shipment ${shipmentId} has no warehouse after the check`);
        if (facts.box.manifestVersion !== dto.expectedManifestVersion) {
          throw new DirectDeliveryChangedError(
            `Shipment ${shipmentId} changed (version ${facts.box.manifestVersion}, expected ${dto.expectedManifestVersion})`,
          );
        }

        const before = shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId));
        const operation = await createShipmentOperation(trx, {
          type: 'direct_delivery_return',
          actorId: actor.id,
          reason: reason.reason,
          reasonCode: reason.reasonCode,
          requestChannel: reason.requestChannel,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          before,
        });
        const at = new Date();
        const created = await editShipmentManifest(
          this.manifestDeps(),
          { shipmentIds: [shipmentId], allow: ['draft'], at },
          async (writer, aggregates) => {
            const box = aggregates[0].shipment;
            const target = await writer.createShipment({
              owner: { kind: 'warehouse', warehouseId },
              status: 'draft',
              shippingProfileId: null,
              recipientSnapshot: box.recipientSnapshot,
              entrancePassword: box.entrancePassword,
              openedBy: actor.id,
              openedAt: box.openedAt ?? undefined,
            });
            for (const line of aggregates[0].lines) {
              await writer.addLine(target.id, {
                fulfillmentOrderItemId: line.fulfillmentOrderItemId,
                skuId: line.skuId,
                qty: line.qty,
                createdFromLineId: line.id,
                createdAt: line.createdAt,
                demandRequestedAt: line.demandRequestedAt ?? line.createdAt,
              });
            }
            await transitionShipments(trx, {
              shipmentIds: [shipmentId],
              from: ['draft'],
              to: 'superseded',
              at,
              stale: 'unreachable',
            });
            return target.id;
          },
          trx,
        );

        await completeShipmentOperation(trx, operation.id, [
          {
            shipmentId,
            role: 'source',
            before,
            after: shipmentSnapshot(await loadShipmentAggregate(trx, shipmentId)),
          },
          {
            shipmentId: created,
            role: 'target',
            before: null,
            after: shipmentSnapshot(await loadShipmentAggregate(trx, created)),
          },
        ]);
        const wasHandedOff = facts.box.supplierHandoffId !== null;
        await this.audit.logUserActionRequired(
          'shipment.direct_delivery_return',
          'fulfillment',
          `shipment.direct_delivery_return operation ${operation.id}`,
          { userId: actor.id },
          {
            operationId: operation.id,
            reason: reason.reason,
            shipmentId,
            targetShipmentId: created,
            supplierId: facts.box.supplierId,
            wasHandedOff,
          },
          trx,
        );
        const response: DirectDeliveryReturnResultDto = {
          shipmentId: created,
          previousShipmentId: shipmentId,
          wasHandedOff,
          operationId: operation.id,
        };
        return { response, resourceType: 'shipment', resourceId: created, operationId: operation.id };
      },
      tx,
    );
  }

  private async assertSupplier(trx: DbTx, supplierId: string): Promise<void> {
    const [row] = await trx
      .select({ id: wmsTables.suppliers.id })
      .from(wmsTables.suppliers)
      .where(eq(wmsTables.suppliers.id, supplierId))
      .limit(1);
    if (!row) throw new NotFoundError(`Supplier ${supplierId} not found`);
  }

  /** 실행부가 받는 평범한 객체. 클래스 필드 초기화식에서 만들지 않는다(useDefineForClassFields). */
  private manifestDeps(): ManifestEditDeps {
    return { invariant: this.invariant, reservations: this.reservations };
  }

  private dispatchDeps(): SupplierDispatchDeps {
    return {
      shipments: this.shipments,
      fulfillmentsV2: this.fulfillmentsV2,
      fulfillmentsV1: this.fulfillmentsV1,
      coreOrders: this.coreOrders,
      audit: this.audit,
      invariant: this.invariant,
      waybills: this.waybills,
    };
  }
}

function trackingOf(
  dto: DirectDeliveryTakeoverDto,
): { carrier: DirectDeliveryTrackingDto['carrier']; trackingNo: string } | null {
  if (dto.carrier === undefined && dto.trackingNo === undefined) return null;
  const trackingNo = normalizeTrackingNo(dto.trackingNo ?? '');
  if (dto.carrier === undefined || !trackingNo) {
    throw new BadRequestError('carrier and trackingNo go together');
  }
  return { carrier: dto.carrier, trackingNo };
}

function assertTakeover(facts: DirectDeliveryFacts): void {
  const blockers = takeoverBlockers(facts);
  if (blockers.some((b) => b.code === 'sellmate_handed_over')) {
    throw new DirectDeliverySellmateHandedOverError(`Shipment ${facts.box.id} belongs to a Sellmate order`);
  }
  if (blockers.some((b) => b.code === 'recipient_incomplete') && blockers.length === 1) {
    throw new DirectDeliveryRecipientIncompleteError(`Shipment ${facts.box.id} has an incomplete recipient`);
  }
  if (blockers.length > 0) {
    throw new DirectDeliveryNotEligibleError(
      `Shipment ${facts.box.id} cannot go to a supplier: ${blockers.map((b) => b.code).join(',')}`,
    );
  }
}
