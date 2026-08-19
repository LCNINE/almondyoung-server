import { Controller, Logger, NotFoundException, BadRequestException, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { EventPayload, EventEnvelope, RetryPolicy, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { SalesOrdersService } from '../services/sales-orders.service';
import { LibraryService } from '../../library/services/library.service';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentWorkflowGate } from '../../fulfillment/services/fulfillment-workflow-gate.service';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { and, eq } from 'drizzle-orm';
import { ORDER_STREAM, SalesChannel } from '@packages/event-contracts/streams/orders.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * Order 이벤트 컨슈머
 *
 * orders.events.v1 토픽을 소비하여 Sales Order BC의 판매 주문을 관리합니다.
 * 외부 소스(Medusa, Naver, Coupang)로부터 오는 주문 이벤트를 처리합니다.
 *
 * Consumer group: almondyoung-order-consumer
 * (WMS의 wms-consumer와 분리되어 동일 이벤트를 독립적으로 소비)
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    private readonly salesOrdersService: SalesOrdersService,
    private readonly libraryService: LibraryService,
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
    private readonly fulfillmentWorkflowGate: FulfillmentWorkflowGate,
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private async checkAndRecordEvent(
    eventId: string,
    orderId: string,
    eventType: string,
    payload: unknown,
    tx: DbTx,
  ): Promise<boolean> {
    const existing = await tx.query.orderEvents.findFirst({
      where: eq(wmsTables.orderEvents.eventId, eventId),
    });

    if (existing) {
      this.logger.log(`Event already processed: ${eventId}`);
      return true;
    }

    await tx.insert(wmsTables.orderEvents).values({
      eventId,
      orderId,
      eventType: eventType as any,
      payload: payload as any,
    });

    return false;
  }

  /**
   * lifecycle 이벤트(`OrderCancelled`/`OrderRefundCreated`)가 가리키는 판매주문의 **core PK** 를 찾는다 (#656).
   *
   * `payload.orderId` 를 PK 로 조회하면 안 된다. 채널 수집 경로에서 그 값은 channel-adapter 가
   * 만든 id 이고, core 는 `handleOrderCreated` 에서 SO 를 만들 때 `defaultRandom()` PK 를 새로
   * 발급한다 — **두 id 공간이 겹치지 않는다.** 그래서 PK 조회는 구조적으로 항상 실패했고,
   * 라이브에서 lifecycle 이벤트가 전량 NotFound 로 DLQ 에 쌓였다.
   *
   * `handleOrderCreated` 가 이미 쓰는 채널 키(`salesChannel` + `externalOrderId`)가 정본이다.
   * 채널 키가 없는 **옛 메시지**(계약에 필드가 생기기 전 발행분, DLQ 재처리분 포함)는 종전대로
   * PK 로 찾는다 — 자체 발행 주문처럼 두 id 가 같은 경우가 여기 해당한다.
   */
  private async resolveSalesOrderId(
    payload: { orderId: string; salesChannel?: SalesChannel; externalOrderId?: string },
    tx: DbTx,
  ): Promise<string | null> {
    if (payload.salesChannel && payload.externalOrderId) {
      const byChannelKey = await this.salesOrdersService.findByChannelOrderId(
        payload.salesChannel,
        payload.externalOrderId,
        tx,
      );
      return byChannelKey?.id ?? null;
    }

    const byPrimaryKey = await this.salesOrdersService.getOne(payload.orderId, tx);
    return byPrimaryKey?.id ?? null;
  }

  /**
   * 채널 라인 범위를 Core 라인 범위로 옮긴다.
   *
   * **없으면 `undefined` 를 돌려준다** — Core 는 `lines` 유무로 전체/부분을 가르므로
   * 빈 배열을 넘기면 `BadRequestException` 이 된다 (`sales-orders.service.ts:436`).
   *
   * **해석되지 않는 라인은 skip 하지 throw 하지 않는다.** 판매주문의 계약은 수락(accept) 이후
   * 불변이라, 그 주문에 라인이 없다는 것은 애초 수락된 적이 없다는 뜻이다 — 취소할 대상 자체가
   * 없다. 대표 사례: 최초 수집 시점에 이미 취소된 라인은 번역기가 `items` 에서 빼버려 Core 가
   * 그 라인을 만든 적이 없는데, source 는 그 라인을 지목하는 부분취소 관측을 그대로 낸다.
   * 여기서 NotFound 로 throw 하면 non-retryable 이라 즉시 DLQ 로 가고, 재시도해도 영원히
   * 같은 결과다 — 조용히 넘기는 것이 맞다.
   *
   * `cancelledLines` 가 있는데 **단 하나도 해석되지 않으면** `null` 을 돌려준다 — 이걸
   * `undefined`(= 필드 자체가 없어 전체취소) 로 착각하면 안 되므로 구분한다. 호출부는 `null` 을
   * "취소할 것이 없는 no-op" 으로 다뤄야 하고, 이때 전체취소로 대체 처리해서는 안 된다.
   */
  private async resolveCancelledLines(
    salesOrderId: string,
    cancelledLines: Array<{ channelOrderItemId: string; quantity: number }> | undefined,
    tx: DbTx,
  ): Promise<Array<{ salesOrderLineId: string; quantity: number }> | undefined | null> {
    if (!cancelledLines || cancelledLines.length === 0) return undefined;

    const channelOrderItemIds = cancelledLines.map((line) => line.channelOrderItemId);
    const idByChannelItem = await this.salesOrdersService.findLineIdsByChannelOrderItemIds(
      salesOrderId,
      channelOrderItemIds,
      tx,
    );

    const resolvedLines: Array<{ salesOrderLineId: string; quantity: number }> = [];
    const unresolved: string[] = [];
    for (const line of cancelledLines) {
      const salesOrderLineId = idByChannelItem.get(line.channelOrderItemId);
      if (!salesOrderLineId) {
        unresolved.push(line.channelOrderItemId);
        continue;
      }
      resolvedLines.push({ salesOrderLineId, quantity: line.quantity });
    }

    if (unresolved.length > 0) {
      this.logger.warn(
        `[OrderCancelled] Skipping unresolved cancelled lines for salesOrder=${salesOrderId}: ${unresolved.join(', ')}`,
      );
    }

    if (resolvedLines.length === 0) return null;
    return resolvedLines;
  }

  @On(ORDER_STREAM, 'OrderCreated')
  @RetryPolicy({ maxRetries: 5, backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 15000 })
  async handleOrderCreated(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderCreated'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderCreated'>,
  ) {
    this.logger.log(`[OrderCreated] Received: ${payload.orderId} from ${payload.salesChannel}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.dbService.run(async (tx) => {
        const externalOrderId = payload.externalOrderId ?? payload.orderId;
        const existing = await this.salesOrdersService.findByChannelOrderId(payload.salesChannel, externalOrderId, tx);

        // ADR-0010: existing SO 라도 grant 누락 가능성을 메우기 위해 한 번 더 시도.
        // grantOwnershipsForOrder 는 (customerId, assetId, salesOrderId) unique index 로 idempotent —
        // 배포 윈도우 안의 Kafka redelivery race / 외부 데이터 import 같은 경위로 SO 가 grant 없이
        // 존재하는 시나리오를 자가치유.
        const salesOrder = existing ?? (await this.salesOrdersService.createFromEvent(payload, tx));

        if (!existing) {
          await tx.insert(wmsTables.orderEvents).values({
            eventId: envelope.messageId,
            orderId: salesOrder.id,
            eventType: 'ORDER_CREATED',
            payload: payload as any,
          });
          this.logger.log(`[OrderCreated] Created SO: ${salesOrder.id}`);
        } else {
          this.logger.log(`[OrderCreated] Order already exists: ${existing.id}, retrying grant`);
        }

        // ADR-0010: 채널이 payment-confirmed 주문만 넘기는 것이 현재 invariant 지만,
        // grant 는 fail-closed 로 명시 가드 (미래의 미결제 채널 도입 대비).
        const isPaymentConfirmed = payload.status === 'confirmed';
        if (isPaymentConfirmed) {
          const shouldEnqueueFo = this.fulfillmentWorkflowGate.shouldEnqueueFo(payload.createdAt, !existing);
          if (shouldEnqueueFo) {
            await this.fulfillmentBacklog.enqueueForSalesOrder(
              salesOrder.id,
              { eventOccurredAt: payload.createdAt, isNewSalesOrder: !existing },
              tx,
            );
          }
          await this.libraryService.grantOwnershipsForOrder(salesOrder.id, tx);
        }
      });
    } catch (error) {
      this.logger.error(`[OrderCreated] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @On(ORDER_STREAM, 'OrderCancelled')
  @RetryPolicy({ nonRetryableErrors: [NotFoundException, BadRequestException] })
  async handleOrderCancelled(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderCancelled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderCancelled'>,
  ) {
    this.logger.log(`[OrderCancelled] Received: orderId=${payload.orderId}, reason=${payload.reason}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.dbService.run(async (tx) => {
        const salesOrderId = await this.resolveSalesOrderId(payload, tx);
        if (!salesOrderId) {
          throw new NotFoundException(`Sales order ${payload.orderId} not found for OrderCancelled`);
        }

        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          salesOrderId,
          'ORDER_CANCELLED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        const lines = await this.resolveCancelledLines(salesOrderId, payload.cancelledLines, tx);
        if (lines === null) {
          this.logger.log(
            `[OrderCancelled] No resolvable cancelled lines for salesOrder=${salesOrderId}, skipping as no-op`,
          );
          return;
        }

        await this.salesOrdersService.cancel(
          salesOrderId,
          {
            reasonCode: payload.reason,
            reasonDetail: payload.reasonDetail,
            cancelledBy: payload.cancelledBy,
            occurredAt: payload.cancelledAt,
            ...(lines ? { lines } : {}),
            metadata: {
              refundRequired: payload.refundRequired,
              refundAmount: payload.refundAmount,
              stockRestorationResults: payload.stockRestorationResults ?? [],
              sourceEventId: envelope.messageId,
            },
          },
          tx,
        );

        this.logger.log(`[OrderCancelled] Cancelled sales order: ${salesOrderId}, reason: ${payload.reason}`);
      });
    } catch (error) {
      this.logger.error(`[OrderCancelled] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @On(ORDER_STREAM, 'OrderModified')
  async handleOrderModified(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderModified'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderModified'>,
  ) {
    this.logger.log(`[OrderModified] Received: orderId=${payload.orderId}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.dbService.run(async (tx) => {
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderModified] Sales order not found, skipping: ${payload.orderId}`);
          return;
        }

        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_MODIFIED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        this.logger.warn(
          `[OrderModified] Ignored post-acceptance contract mutation for sales order: ${payload.orderId}`,
        );
      });
    } catch (error) {
      this.logger.error(`[OrderModified] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @On(ORDER_STREAM, 'OrderRefundCreated')
  @RetryPolicy({ nonRetryableErrors: [NotFoundException] })
  async handleOrderRefundCreated(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderRefundCreated'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderRefundCreated'>,
  ) {
    this.logger.log(`[OrderRefundCreated] Received: orderId=${payload.orderId}, refundId=${payload.refundId}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.dbService.run(async (tx) => {
        const salesOrderId = await this.resolveSalesOrderId(payload, tx);
        if (!salesOrderId) {
          throw new NotFoundException(`Sales order ${payload.orderId} not found for OrderRefundCreated`);
        }

        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          salesOrderId,
          'ORDER_REFUND_CREATED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        const refundExternalRef = `medusa:refund:${payload.refundId}`;
        const [existingLink] = await tx
          .select({ id: wmsTables.businessLinks.id })
          .from(wmsTables.businessLinks)
          .where(
            and(
              eq(wmsTables.businessLinks.sourceType, 'sales_order'),
              eq(wmsTables.businessLinks.sourceId, salesOrderId),
              eq(wmsTables.businessLinks.relationName, 'order_lifecycle_refund_collected'),
              eq(wmsTables.businessLinks.targetExternalRef, refundExternalRef),
            ),
          )
          .limit(1);
        if (existingLink) {
          this.logger.log(
            `[OrderRefundCreated] Refund link already recorded for ${payload.refundId}, skipping duplicate`,
          );
          return;
        }

        await tx.insert(wmsTables.businessLinks).values({
          sourceType: 'sales_order',
          sourceId: salesOrderId,
          sourceExternalRef: null,
          targetType: 'wallet_refund',
          targetId: null,
          targetExternalRef: refundExternalRef,
          relationName: 'order_lifecycle_refund_collected',
          metadata: {
            paymentId: payload.paymentId,
            amount: payload.amount,
            currency: payload.currency,
            reason: payload.reason,
            note: payload.note,
            refundStatus: 'collected',
            sourceEventId: envelope.messageId,
          },
          occurredAt: new Date(payload.createdAt),
        });

        this.logger.log(`[OrderRefundCreated] Linked refund ${payload.refundId} to sales order ${salesOrderId}`);
      });
    } catch (error) {
      this.logger.error(`[OrderRefundCreated] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }
}
