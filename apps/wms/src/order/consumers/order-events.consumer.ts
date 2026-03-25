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
import { SalesOrdersService } from '../sales-orders/services/sales-orders.service';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

/**
 * Order 이벤트 컨슈머
 *
 * orders.events.v1 토픽의 주문 이벤트를 처리하여 WMS의 Sales Order를 관리합니다.
 * - OrderCreated: 새 주문 생성
 * - OrderConfirmed: 주문 확정 (결제 완료)
 * - OrderCancelled: 주문 취소
 * - OrderModified: 주문 정보 변경
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    private readonly salesOrdersService: SalesOrdersService,
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * 이벤트 멱등성 체크 및 기록
   * @returns true - 이미 처리된 이벤트, false - 새 이벤트
   */
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
        // 1. 멱등성 체크: 채널+채널주문ID로 이미 존재하는 주문인지 확인
        const externalOrderId = payload.externalOrderId ?? payload.orderId;
        const existing = await this.salesOrdersService.findByChannelOrderId(payload.salesChannel, externalOrderId, tx);

        if (existing) {
          this.logger.log(`[OrderCreated] Order already exists: ${existing.id}`);
          return;
        }

        // 2. SO 생성
        const salesOrder = await this.salesOrdersService.createFromEvent(payload, tx);

        // 3. 이벤트 기록
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
    this.logger.log(`[OrderConfirmed] Received: orderId=${payload.orderId}`, { correlationId: envelope.correlationId });

    try {
      await this.inTx(async (tx) => {
        // 1. 멱등성 체크: 이미 처리된 이벤트면 스킵
        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_CONFIRMED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        // 2. SO 조회
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderConfirmed] Sales order not found: ${payload.orderId}`);
          return;
        }

        // 3. 상태 확인 - 이미 confirmed 이상이면 스킵
        if (salesOrder.status !== 'pending') {
          this.logger.log(`[OrderConfirmed] Order already in status: ${salesOrder.status}, skipping`);
          return;
        }

        // 4. SO 확정 (warehouseId 없이 호출 - 스냅샷은 FO 생성 시점에 생성)
        await this.salesOrdersService.confirm(payload.orderId, undefined, tx);

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
    this.logger.log(`[OrderCancelled] Received: orderId=${payload.orderId}, reason=${payload.reason}`, {
      correlationId: envelope.correlationId,
    });

    try {
      await this.inTx(async (tx) => {
        // 1. 멱등성 체크
        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_CANCELLED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        // 2. SO 조회
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderCancelled] Sales order not found: ${payload.orderId}`);
          return;
        }

        // 3. 이미 취소된 상태면 스킵
        if (salesOrder.status === 'cancelled') {
          this.logger.log(`[OrderCancelled] Order already cancelled: ${payload.orderId}`);
          return;
        }

        // 4. SO 취소 (연관된 FO들도 함께 취소됨)
        await this.salesOrdersService.cancel(payload.orderId, tx);

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
    this.logger.log(`[OrderModified] Received: orderId=${payload.orderId}`, { correlationId: envelope.correlationId });

    try {
      await this.inTx(async (tx) => {
        // 1. 멱등성 체크
        const alreadyProcessed = await this.checkAndRecordEvent(
          envelope.messageId,
          payload.orderId,
          'ORDER_MODIFIED',
          payload,
          tx,
        );
        if (alreadyProcessed) return;

        // 2. SO 조회
        const salesOrder = await this.salesOrdersService.getOne(payload.orderId, tx);
        if (!salesOrder) {
          this.logger.warn(`[OrderModified] Sales order not found: ${payload.orderId}`);
          return;
        }

        // 3. 수정 불가 상태 확인 (processing, shipped, cancelled는 수정 불가)
        const nonModifiableStatuses = ['processing', 'shipped', 'cancelled'];
        if (nonModifiableStatuses.includes(salesOrder.status)) {
          this.logger.warn(`[OrderModified] Cannot modify order in status: ${salesOrder.status}`);
          return;
        }

        // 4. 변경 사항 적용
        await this.salesOrdersService.updateFromEvent(payload.orderId, payload.changes, tx);

        this.logger.log(`[OrderModified] Updated sales order: ${payload.orderId}`);
      });
    } catch (error) {
      this.logger.error(`[OrderModified] Failed to process: ${payload.orderId}`, error.stack);
      throw error;
    }
  }
}
