import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { OrderCreatedPayload, OrderCancelledPayload, OrderModifiedPayload } from '@packages/event-contracts';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { SalesOrdersService } from '../services/sales-orders.service';
import { LibraryService } from '../../library/services/library.service';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq } from 'drizzle-orm';

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
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

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

  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(
    @EventPayload() payload: OrderCreatedPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderCreatedPayload>,
  ) {
    this.logger.log(`[OrderCreated] Received: ${payload.orderId} from ${payload.salesChannel}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.inTx(async (tx) => {
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
          await this.fulfillmentBacklog.enqueueForSalesOrder(salesOrder.id, tx);
          await this.libraryService.grantOwnershipsForOrder(salesOrder.id, tx);
        }
      });
    } catch (error) {
      this.logger.error(`[OrderCreated] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderCancelled')
  async handleOrderCancelled(
    @EventPayload() payload: OrderCancelledPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderCancelledPayload>,
  ) {
    this.logger.log(`[OrderCancelled] Received: orderId=${payload.orderId}, reason=${payload.reason}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.inTx(async (tx) => {
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderCancelled] Sales order not found, skipping: ${payload.orderId}`);
          return;
        }

        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_CANCELLED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        await this.salesOrdersService.cancel(
          payload.orderId,
          {
            reasonCode: payload.reason,
            reasonDetail: payload.reasonDetail,
            cancelledBy: payload.cancelledBy,
            occurredAt: payload.cancelledAt,
            metadata: {
              refundRequired: payload.refundRequired,
              refundAmount: payload.refundAmount,
              stockRestorationResults: payload.stockRestorationResults ?? [],
              sourceEventId: envelope.messageId,
            },
          },
          tx,
        );

        this.logger.log(`[OrderCancelled] Cancelled sales order: ${payload.orderId}, reason: ${payload.reason}`);
      });
    } catch (error) {
      this.logger.error(`[OrderCancelled] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderModified')
  async handleOrderModified(
    @EventPayload() payload: OrderModifiedPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderModifiedPayload>,
  ) {
    this.logger.log(`[OrderModified] Received: orderId=${payload.orderId}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.inTx(async (tx) => {
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
}
