import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderCancelledPayload,
  OrderModifiedPayload,
} from '@packages/event-contracts';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { SalesOrdersService } from '../services/sales-orders.service';
import { LibraryService } from '../../library/services/library.service';
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
        const existing = await this.salesOrdersService.findByChannelOrderId(
          payload.salesChannel,
          externalOrderId,
          tx,
        );

        if (existing) {
          this.logger.log(`[OrderCreated] Order already exists: ${existing.id}`);
          return;
        }

        const salesOrder = await this.salesOrdersService.createFromEvent(payload, tx);

        await tx.insert(wmsTables.orderEvents).values({
          eventId: envelope.messageId,
          orderId: salesOrder.id,
          eventType: 'ORDER_CREATED',
          payload: payload as any,
        });

        this.logger.log(`[OrderCreated] Created SO: ${salesOrder.id}`);
      });
    } catch (error) {
      this.logger.error(`[OrderCreated] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderConfirmed')
  async handleOrderConfirmed(
    @EventPayload() payload: OrderConfirmedPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderConfirmedPayload>,
  ) {
    this.logger.log(`[OrderConfirmed] Received: orderId=${payload.orderId}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.inTx(async (tx) => {
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderConfirmed] Sales order not found, skipping: ${payload.orderId}`);
          return;
        }

        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_CONFIRMED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        if (salesOrder.status !== 'pending') {
          this.logger.log(`[OrderConfirmed] Order already in status: ${salesOrder.status}, skipping`);
          return;
        }

        await this.salesOrdersService.confirm(payload.orderId, undefined, tx);

        // ADR-0006: 디지털 ownership 발급은 SO confirmed 와 같은 트랜잭션. 부분 실패 방지.
        await this.libraryService.grantOwnershipsForOrder(payload.orderId, tx);

        this.logger.log(`[OrderConfirmed] Confirmed sales order: ${payload.orderId}`);
      });
    } catch (error) {
      this.logger.error(`[OrderConfirmed] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderCancelled')
  async handleOrderCancelled(
    @EventPayload() payload: OrderCancelledPayload,
    @EventEnvelope() envelope: MessageEnvelope<OrderCancelledPayload>,
  ) {
    this.logger.log(
      `[OrderCancelled] Received: orderId=${payload.orderId}, reason=${payload.reason}`,
      { correlationId: envelope.correlationId },
    );

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

        if (salesOrder.status === 'cancelled') {
          this.logger.log(`[OrderCancelled] Order already cancelled: ${payload.orderId}`);
          return;
        }

        await this.salesOrdersService.cancel(payload.orderId, tx);

        // ADR-0006: exercise 전 디지털 ownership 만 회수. exercise 된 것은 환불 측이 결정.
        await this.libraryService.revokeOwnershipsForOrder(payload.orderId, payload.reason, tx);

        this.logger.log(
          `[OrderCancelled] Cancelled sales order: ${payload.orderId}, reason: ${payload.reason}`,
        );
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

        const nonModifiableStatuses = ['processing', 'shipped', 'cancelled'];
        if (nonModifiableStatuses.includes(salesOrder.status)) {
          this.logger.warn(`[OrderModified] Cannot modify order in status: ${salesOrder.status}`);
          return;
        }

        await this.salesOrdersService.updateFromEvent(payload.orderId, payload.changes, tx);
        this.logger.log(`[OrderModified] Updated sales order: ${payload.orderId}`);
      });
    } catch (error) {
      this.logger.error(`[OrderModified] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }
}
