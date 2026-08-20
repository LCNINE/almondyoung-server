import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { FULFILLMENT_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { InjectPublisher, PublisherFor } from '@app/events';
import { outbox_events } from '@app/events';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { ShipmentTrackingEventDto } from '../dto/shipment-tracking-event.dto';
import { FULFILLMENT_EVENTS, fulfillmentDeliveredV1OutboxEvent, shipmentDeliveredOutboxEvent } from '../events';
import { purgeTargetSalesOrderIds } from './entrance-password.purge';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';

export interface ShipmentTrackingEventResult {
  shipmentId: string;
  dispatchAttemptId: string;
  providerEventId: string;
  status: 'in_transit' | 'delivered';
  replayed: boolean;
}

type ExistingTracking = typeof wmsTables.shipmentTracking.$inferSelect;

class RecallTrackingLockOrderRetry extends Error {}

@Injectable()
export class ShipmentDeliveryTrackingService {
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    @InjectPublisher(SHIPMENT_STREAM)
    private readonly shipments: PublisherFor<typeof SHIPMENT_STREAM>,
    @InjectPublisher(FULFILLMENT_STREAM)
    private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly shipmentReservations: ShipmentReservationService,
  ) {}

  async recordProviderEvent(
    dispatchAttemptId: string,
    input: ShipmentTrackingEventDto,
    tx?: DbTx,
  ): Promise<ShipmentTrackingEventResult> {
    this.workflowGate.assertV2MutationAllowed('shipment.tracking.record');
    const providerEventId = input.providerEventId.trim();
    const location = input.location?.trim() || null;
    const occurredAt = new Date(input.occurredAt);
    if (!providerEventId) throw new BadRequestException('providerEventId must contain a visible character');
    if (!Number.isFinite(occurredAt.getTime())) throw new BadRequestException('occurredAt must be a valid timestamp');

    const persist = async (retryCount: number): Promise<ShipmentTrackingEventResult> => {
      try {
        return await this.db.run(async (trx) => {
          const initialExisting = await this.findProviderEvent(dispatchAttemptId, providerEventId, trx);
          if (initialExisting)
            return this.exactReplay(initialExisting, dispatchAttemptId, input.status, occurredAt, location);

          const [initialAttempt] = await trx
            .select({
              shipmentId: wmsTables.dispatchAttempts.shipmentId,
              status: wmsTables.dispatchAttempts.status,
              recoveryCode: wmsTables.dispatchAttempts.recoveryCode,
            })
            .from(wmsTables.dispatchAttempts)
            .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
            .limit(1);
          if (!initialAttempt) throw new NotFoundException(`Dispatch attempt ${dispatchAttemptId} not found`);

          const optimisticRecallPending =
            initialAttempt.status === 'recovery_required' && initialAttempt.recoveryCode === 'DISPATCH_RECALL_PENDING';
          const recallOperationId = optimisticRecallPending
            ? await this.lockRecallOperationForLateEvidence(initialAttempt.shipmentId, dispatchAttemptId, trx)
            : null;

          await this.shipmentReservations.lockShipmentGraphForDispatch(initialAttempt.shipmentId, trx);
          await trx.execute(
            sql`SELECT id FROM ${wmsTables.dispatchAttempts} WHERE ${wmsTables.dispatchAttempts.id} = ${dispatchAttemptId} FOR UPDATE`,
          );
          const [attempt] = await trx
            .select()
            .from(wmsTables.dispatchAttempts)
            .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
            .limit(1);
          if (!attempt) throw new NotFoundException(`Dispatch attempt ${dispatchAttemptId} not found`);
          if (attempt.shipmentId !== initialAttempt.shipmentId) {
            throw this.conflict(
              'DISPATCH_ATTEMPT_CHANGED',
              `Dispatch attempt ${dispatchAttemptId} changed shipment ownership`,
            );
          }
          const recallPending =
            attempt.status === 'recovery_required' && attempt.recoveryCode === 'DISPATCH_RECALL_PENDING';
          if (recallPending && !recallOperationId) {
            // The attempt was dispatched during the optimistic read, but a recall
            // quarantined it while this transaction waited for the graph. Roll this
            // transaction back and retry so operation/member can be locked before
            // graph→attempt in canonical order.
            throw new RecallTrackingLockOrderRetry();
          }
          if (attempt.status !== 'dispatched' && !recallPending) {
            throw this.conflict(
              'DISPATCH_ATTEMPT_NOT_TRACKABLE',
              `Dispatch attempt ${dispatchAttemptId} is '${attempt.status}', expected 'dispatched'`,
            );
          }
          if (!attempt.dispatchedAt || occurredAt.getTime() < attempt.dispatchedAt.getTime()) {
            throw this.conflict(
              'TRACKING_EVENT_BEFORE_DISPATCH',
              `Tracking event ${providerEventId} occurred before dispatch attempt ${dispatchAttemptId}`,
            );
          }

          const [shipment] = await trx
            .select({ status: wmsTables.shipments.status, recoveryCode: wmsTables.shipments.recoveryCode })
            .from(wmsTables.shipments)
            .where(eq(wmsTables.shipments.id, attempt.shipmentId))
            .limit(1);
          const shipmentRecallPending =
            shipment?.status === 'recovery_required' && shipment.recoveryCode === 'DISPATCH_RECALL_PENDING';
          if (
            !shipment ||
            (recallPending ? !shipmentRecallPending : !['shipped', 'in_transit', 'delivered'].includes(shipment.status))
          ) {
            throw this.conflict(
              'SHIPMENT_NOT_TRACKABLE',
              `Shipment ${attempt.shipmentId} is '${shipment?.status ?? 'missing'}' and cannot accept carrier tracking`,
            );
          }
          const [activeAttempt] = await trx
            .select({ id: wmsTables.dispatchAttempts.id })
            .from(wmsTables.dispatchAttempts)
            .where(
              and(
                eq(wmsTables.dispatchAttempts.shipmentId, attempt.shipmentId),
                ne(wmsTables.dispatchAttempts.status, 'recalled'),
              ),
            )
            .orderBy(desc(wmsTables.dispatchAttempts.attemptNo))
            .limit(1);
          if (activeAttempt?.id !== attempt.id) {
            throw this.conflict(
              'DISPATCH_ATTEMPT_NOT_ACTIVE',
              `Dispatch attempt ${dispatchAttemptId} is not the latest non-recalled attempt`,
            );
          }

          if (!attempt.carrierAcceptedAt || occurredAt.getTime() < attempt.carrierAcceptedAt.getTime()) {
            await trx
              .update(wmsTables.dispatchAttempts)
              .set({ carrierAcceptedAt: occurredAt, updatedAt: new Date() })
              .where(
                recallPending
                  ? and(
                      eq(wmsTables.dispatchAttempts.id, attempt.id),
                      eq(wmsTables.dispatchAttempts.status, 'recovery_required'),
                      eq(wmsTables.dispatchAttempts.recoveryCode, 'DISPATCH_RECALL_PENDING'),
                    )
                  : and(
                      eq(wmsTables.dispatchAttempts.id, attempt.id),
                      eq(wmsTables.dispatchAttempts.status, 'dispatched'),
                    ),
              );
          }

          const [inserted] = await trx
            .insert(wmsTables.shipmentTracking)
            .values({
              shipmentId: attempt.shipmentId,
              dispatchAttemptId: attempt.id,
              providerEventId,
              status: input.status,
              location,
              timestamp: occurredAt,
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted) {
            const concurrentExisting = await this.findProviderEvent(dispatchAttemptId, providerEventId, trx);
            if (!concurrentExisting) throw new Error('Provider event conflict did not resolve to an existing row');
            return this.exactReplay(concurrentExisting, dispatchAttemptId, input.status, occurredAt, location);
          }

          if (recallPending) {
            if (!recallOperationId) {
              throw this.conflict(
                'DISPATCH_RECALL_OWNER_MISSING',
                `Recall-pending dispatch attempt ${dispatchAttemptId} has no exact operation owner`,
              );
            }
            await trx
              .update(wmsTables.shipmentOperations)
              .set({
                status: 'recovery_required',
                lastError: `Carrier ${input.status} evidence ${providerEventId} arrived during dispatch recall`,
              })
              .where(
                and(
                  eq(wmsTables.shipmentOperations.id, recallOperationId),
                  inArray(wmsTables.shipmentOperations.status, ['pending', 'recovery_required']),
                ),
              );
            return {
              shipmentId: attempt.shipmentId,
              dispatchAttemptId: attempt.id,
              providerEventId,
              status: input.status,
              replayed: false,
            };
          }

          if (input.status === 'in_transit') {
            await trx
              .update(wmsTables.shipments)
              .set({ status: 'in_transit', lastUpdated: occurredAt })
              .where(and(eq(wmsTables.shipments.id, attempt.shipmentId), eq(wmsTables.shipments.status, 'shipped')));
          } else {
            await trx
              .update(wmsTables.shipments)
              .set({ status: 'delivered', deliveredAt: occurredAt, lastUpdated: occurredAt })
              .where(
                and(
                  eq(wmsTables.shipments.id, attempt.shipmentId),
                  inArray(wmsTables.shipments.status, ['shipped', 'in_transit']),
                ),
              );
            // ⚠️ 이 두 줄의 **순서는 임의가 아니다.** 파기는 `emitDeliveredProjections` 보다
            // 먼저 와야 한다 — 그쪽이 `fulfillment_orders` 에 `FOR UPDATE` 를 건다.
            // 파기를 뒤로 옮기면 배송완료 경로의 잠금 순서가 `FO → sales_orders` 가 되는데,
            // 주문 취소 경로(`SalesOrdersService.cancelSalesOrder`)는 `sales_orders → FO`
            // 순서로 잡는다. 두 순서가 맞물리면 진짜 교착 고리가 생긴다.
            // (지금은 취소가 draft/planned/recovery_required 상자만, 파기가
            // shipped/in_transit/delivered 상자만 다뤄 집합이 서로 겹치지 않지만,
            // 그건 이 순서를 지킬 때의 여유이지 순서를 바꿔도 되는 이유가 아니다.)
            //
            // `sales_orders` 를 잠그는 곳이 `SalesOrdersService` 뿐이라고 읽지 말 것 —
            // `FulfillmentsService.createV2`(fulfillments.service.ts:119-123) 도
            // `SELECT … FROM sales_orders … FOR UPDATE` 를 걸고 이어서 `shipments` 를 만진다.
            // 그런데도 그쪽과는 고리가 닫히지 않는다. **FO 생성은 상자를 INSERT 만 하고
            // 기존 상자 행을 잠그지 않기 때문이다** (이 서비스는 상자 행을 `FOR UPDATE` 로
            // 잡는 `assertFulfillmentOrders` 를 아예 부르지 않고, INSERT 는 다른 트랜잭션의
            // 행 잠금을 기다리지 않는다). 즉 FO 생성은 `sales_orders` 를 들고 상자를 기다리는
            // 상태가 될 수 없고, 배송완료 경로(`shipments → sales_orders`)와 마주 볼 변이
            // 없다. 이 서비스들 중 하나라도 기존 상자 행을 잠그기 시작하면 그때는 이 판단을
            // 다시 해야 한다.
            await this.purgeEntrancePassword(attempt.shipmentId, trx);
            await this.emitDeliveredProjections(attempt, providerEventId, occurredAt, trx);
          }

          return {
            shipmentId: attempt.shipmentId,
            dispatchAttemptId: attempt.id,
            providerEventId,
            status: input.status,
            replayed: false,
          };
        }, tx);
      } catch (error) {
        if (error instanceof RecallTrackingLockOrderRetry && !tx && retryCount < 2) {
          return persist(retryCount + 1);
        }
        if (error instanceof RecallTrackingLockOrderRetry) {
          throw this.conflict(
            'TRACKING_RETRY_REQUIRED',
            `Dispatch attempt ${dispatchAttemptId} entered recall recovery; retry the provider event`,
          );
        }
        throw error;
      }
    };
    return persist(0);
  }

  /** Operation/member precede the shared graph in the recall canonical order. */
  private async lockRecallOperationForLateEvidence(
    shipmentId: string,
    dispatchAttemptId: string,
    tx: DbTx,
  ): Promise<string> {
    const candidates = await tx
      .select({
        id: wmsTables.shipmentOperations.id,
        beforeManifestSnapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperations.type, 'recall'),
          inArray(wmsTables.shipmentOperations.status, ['pending', 'recovery_required']),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .orderBy(wmsTables.shipmentOperations.id);
    const candidate = candidates.find(
      (row) => this.recallIntentAttemptId(row.beforeManifestSnapshot) === dispatchAttemptId,
    );
    if (!candidate) {
      throw this.conflict(
        'DISPATCH_RECALL_OWNER_MISSING',
        `Recall-pending dispatch attempt ${dispatchAttemptId} has no exact operation owner`,
      );
    }

    const [operation] = await tx
      .select({
        id: wmsTables.shipmentOperations.id,
        status: wmsTables.shipmentOperations.status,
        type: wmsTables.shipmentOperations.type,
        beforeManifestSnapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, candidate.id))
      .limit(1)
      .for('update');
    const [member] = await tx
      .select({ operationId: wmsTables.shipmentOperationMembers.operationId })
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, candidate.id),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1)
      .for('update');
    if (
      !operation ||
      operation.type !== 'recall' ||
      !['pending', 'recovery_required'].includes(operation.status) ||
      this.recallIntentAttemptId(operation.beforeManifestSnapshot) !== dispatchAttemptId ||
      !member
    ) {
      throw this.conflict(
        'DISPATCH_RECALL_OWNER_CHANGED',
        `Recall operation ownership changed for dispatch attempt ${dispatchAttemptId}`,
      );
    }
    return operation.id;
  }

  private recallIntentAttemptId(snapshot: unknown): string | null {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const intent = (snapshot as Record<string, unknown>).intent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null;
    const attemptId = (intent as Record<string, unknown>).dispatchAttemptId;
    return typeof attemptId === 'string' ? attemptId : null;
  }

  /**
   * 배송이 끝난 순간 공동현관 비번을 파기한다.
   *
   * 쇼핑몰이 결제 화면에서 "배송 완료 후 삭제됩니다" 라고 약속했고 개인정보처리방침이
   * "지체 없이 파기" 를 적었다. core 가 이 값의 SoT 이므로 약속을 지키는 코드도 여기 하나뿐이다.
   * 상자 사본(`shipments.entrance_password`)과 주문 원본(`sales_orders.entrance_password`)이
   * 둘 다 대상이다 — 한쪽만 지우면 남은 쪽이 그대로 크리덴셜이다.
   *
   * **상태 전이 UPDATE 에 얹지 않은 이유**: 그쪽은 `status IN ('shipped','in_transit')` 을
   * 매치해야 하므로 이미 delivered 인 상자에 다른 provider 이벤트가 늦게 도착하면 0행이 되어
   * 파기가 조용히 건너뛰어진다. 별도 문장으로 두면 몇 번을 다시 불러도 결과가 같다 —
   * 이미 null 인 컬럼을 null 로 만드는 것은 아무 일도 아니다.
   *
   * `IS NOT NULL` 술어는 멱등성보다 **잠금 범위**를 위한 것이다. 비번이 없는 절대다수의
   * 주문 행은 아예 잠기지 않으므로, 이 문장이 다른 트랜잭션과 만날 표면이 최소가 된다.
   *
   * 값 자체는 어디에도 남기지 않는다 — 로그도 예외 본문도 마찬가지다.
   */
  private async purgeEntrancePassword(shipmentId: string, tx: DbTx): Promise<void> {
    await tx
      .update(wmsTables.shipments)
      .set({ entrancePassword: null })
      .where(and(eq(wmsTables.shipments.id, shipmentId), isNotNull(wmsTables.shipments.entrancePassword)));

    const carriedOrders = await tx
      .selectDistinct({ salesOrderId: wmsTables.fulfillmentOrders.salesOrderId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));

    const salesOrderIds = purgeTargetSalesOrderIds(carriedOrders);
    if (salesOrderIds.length === 0) return;

    await tx
      .update(wmsTables.salesOrders)
      .set({ entrancePassword: null, entrancePasswordExpiresAt: null })
      .where(and(inArray(wmsTables.salesOrders.id, salesOrderIds), isNotNull(wmsTables.salesOrders.entrancePassword)));
  }

  private async emitDeliveredProjections(
    attempt: typeof wmsTables.dispatchAttempts.$inferSelect,
    providerEventId: string,
    deliveredAt: Date,
    tx: DbTx,
  ): Promise<void> {
    await this.shipments.enqueue(
      shipmentDeliveredOutboxEvent({
        shipmentId: attempt.shipmentId,
        dispatchAttemptId: attempt.id,
        attemptNo: attempt.attemptNo,
        providerEventId,
        deliveredAt: deliveredAt.toISOString(),
      }),
      tx,
    );

    const affectedOrders = await tx
      .selectDistinct({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempt.id));

    const fulfillmentOrderIds = [...new Set(affectedOrders.map((row) => row.fulfillmentOrderId))].sort();
    // Different shipments can complete the same FO concurrently. Canonical row locks
    // ensure the waiter observes the winner's committed tracking evidence before eligibility.
    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      await tx.execute(
        sql`SELECT id FROM ${wmsTables.fulfillmentOrders} WHERE ${wmsTables.fulfillmentOrders.id} = ${fulfillmentOrderId} FOR UPDATE`,
      );
    }

    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      const v1DeliveredAt = await this.v1DeliveryTimestamp(fulfillmentOrderId, tx);
      if (!v1DeliveredAt) continue;

      const [identity] = await tx
        .select({
          salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
          channelOrderId: wmsTables.salesOrders.channelOrderId,
        })
        .from(wmsTables.fulfillmentOrders)
        .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!identity?.salesOrderId) continue;

      await this.fulfillmentsV1.enqueue(
        fulfillmentDeliveredV1OutboxEvent({
          fulfillmentId: fulfillmentOrderId,
          orderId: identity.salesOrderId,
          ...(identity.channelOrderId ? { channelOrderId: identity.channelOrderId } : {}),
          deliveredAt: v1DeliveredAt.toISOString(),
        }),
        tx,
      );
    }
  }

  /**
   * "이 FO 가 전량 출고됐는가" 를 **아웃박스 행의 존재**로 판정한다 — v1 완료 투영은 FO 당
   * 한 번이고, 그 행의 멱등 키(`${foId}:fully-shipped`)가 그 사실의 유일한 기록이다.
   *
   * **6-C-4 가 옛 갈래를 지웠다.** 배포 이전에 출고된 FO 의 표지는 옛
   * `public.outbox_events` 에만 있었으므로, 테이블을 지우기 전에
   * `scripts/events/outbox-marker-backfill.ts` 가 그 표지들을 이 테이블로 옮겼다 —
   * 그 백필이 이 메서드가 옛 테이블 없이도 참을 말할 수 있는 근거다. 백필을 건너뛰고
   * 배포하면 리드타임(며칠)만큼의 FO 가 배송완료 이벤트를 잃는다.
   */
  private async hasFullyShippedProjection(fulfillmentOrderId: string, tx: DbTx): Promise<boolean> {
    const idempotencyKey = `${fulfillmentOrderId}:fully-shipped`;

    const [shared] = await tx
      .select({ id: outbox_events.id })
      .from(outbox_events)
      .where(
        and(
          eq(outbox_events.topic, FULFILLMENT_STREAM.topic.topic),
          eq(outbox_events.eventType, FULFILLMENT_EVENTS.SHIPPED),
          eq(outbox_events.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return Boolean(shared);
  }

  private async v1DeliveryTimestamp(fulfillmentOrderId: string, tx: DbTx): Promise<Date | null> {
    if (!(await this.hasFullyShippedProjection(fulfillmentOrderId, tx))) return null;

    const attempts = await tx
      .selectDistinct({
        id: wmsTables.dispatchAttempts.id,
        status: wmsTables.dispatchAttempts.status,
      })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.dispatchAttempts,
        eq(wmsTables.dispatchAttempts.id, wmsTables.dispatchAttemptSources.dispatchAttemptId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(
        and(
          eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId),
          ne(wmsTables.dispatchAttempts.status, 'recalled'),
        ),
      );
    if (attempts.length === 0 || attempts.some((row) => row.status !== 'dispatched')) return null;

    const delivered = await tx
      .select({
        dispatchAttemptId: wmsTables.shipmentTracking.dispatchAttemptId,
        timestamp: wmsTables.shipmentTracking.timestamp,
      })
      .from(wmsTables.shipmentTracking)
      .where(
        and(
          inArray(
            wmsTables.shipmentTracking.dispatchAttemptId,
            attempts.map((row) => row.id),
          ),
          eq(wmsTables.shipmentTracking.status, 'delivered'),
        ),
      );
    const deliveredIds = new Set(delivered.map((row) => row.dispatchAttemptId));
    if (!attempts.every((row) => deliveredIds.has(row.id))) return null;
    return new Date(Math.max(...delivered.map((row) => row.timestamp.getTime())));
  }

  private async findProviderEvent(
    dispatchAttemptId: string,
    providerEventId: string,
    tx: DbTx,
  ): Promise<ExistingTracking | undefined> {
    const [row] = await tx
      .select()
      .from(wmsTables.shipmentTracking)
      .where(
        and(
          eq(wmsTables.shipmentTracking.dispatchAttemptId, dispatchAttemptId),
          eq(wmsTables.shipmentTracking.providerEventId, providerEventId),
        ),
      )
      .limit(1);
    return row;
  }

  private exactReplay(
    existing: ExistingTracking,
    dispatchAttemptId: string,
    status: 'in_transit' | 'delivered',
    occurredAt: Date,
    location: string | null,
  ): ShipmentTrackingEventResult {
    if (
      existing.dispatchAttemptId !== dispatchAttemptId ||
      existing.status !== status ||
      existing.timestamp.getTime() !== occurredAt.getTime() ||
      (existing.location ?? null) !== location
    ) {
      throw this.conflict(
        'PROVIDER_EVENT_ID_CONFLICT',
        `Provider event ${existing.providerEventId} was already recorded with a different payload`,
      );
    }
    return {
      shipmentId: existing.shipmentId,
      dispatchAttemptId,
      providerEventId: existing.providerEventId!,
      status,
      replayed: true,
    };
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
