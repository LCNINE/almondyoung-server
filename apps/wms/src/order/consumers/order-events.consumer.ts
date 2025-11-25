import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderCancelledPayload,
  OrderModifiedPayload,
} from '@packages/event-contracts';
import { SalesOrdersService } from '../sales-orders/services/sales-orders.service';

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

  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(
    @EventPayload() payload: OrderCreatedPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[OrderCreated] Received: ${payload.orderId} from ${payload.salesChannel}`,
      { correlationId: envelope.correlationId },
    );

    try {
      // 멱등성: 이미 존재하는 주문인지 확인
      const existing = await this.salesOrdersService.findByChannelOrderId(
        payload.salesChannel,
        payload.externalOrderId ?? payload.orderId,
      );

      if (existing) {
        this.logger.log(`[OrderCreated] Order already exists: ${existing.id}`);
        return;
      }

      // TODO: Phase 1에서 createFromEvent() 구현 후 활성화
      // const salesOrder = await this.salesOrdersService.createFromEvent(payload);
      // this.logger.log(`[OrderCreated] Created SO: ${salesOrder.id}`);

      this.logger.warn(
        `[OrderCreated] createFromEvent not yet implemented - skipping`,
      );
    } catch (error) {
      this.logger.error(
        `[OrderCreated] Failed to process: ${payload.orderId}`,
        error.stack,
      );
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderConfirmed')
  async handleOrderConfirmed(
    @EventPayload() payload: OrderConfirmedPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[OrderConfirmed] Received: orderId=${payload.orderId}`,
      { correlationId: envelope.correlationId },
    );

    try {
      // TODO: Phase 1에서 구현
      // - SO 상태를 confirmed로 업데이트
      // - 매핑 스냅샷 생성
      this.logger.warn(
        `[OrderConfirmed] Handler not yet implemented - skipping`,
      );
    } catch (error) {
      this.logger.error(
        `[OrderConfirmed] Failed to process: ${payload.orderId}`,
        error.stack,
      );
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderCancelled')
  async handleOrderCancelled(
    @EventPayload() payload: OrderCancelledPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[OrderCancelled] Received: orderId=${payload.orderId}, reason=${payload.reason}`,
      { correlationId: envelope.correlationId },
    );

    try {
      // TODO: Phase 1에서 구현
      // - SO 조회
      // - SO 취소 처리 (FO 연쇄 취소 포함)
      this.logger.warn(
        `[OrderCancelled] Handler not yet implemented - skipping`,
      );
    } catch (error) {
      this.logger.error(
        `[OrderCancelled] Failed to process: ${payload.orderId}`,
        error.stack,
      );
      throw error;
    }
  }

  @OnEvent('orders.events.v1', 'OrderModified')
  async handleOrderModified(
    @EventPayload() payload: OrderModifiedPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[OrderModified] Received: orderId=${payload.orderId}`,
      { correlationId: envelope.correlationId },
    );

    try {
      // TODO: Phase 1에서 구현
      // - SO 상태 확인 (processing/shipped 상태면 변경 불가)
      // - 변경 가능하면 SO 업데이트
      this.logger.warn(
        `[OrderModified] Handler not yet implemented - skipping`,
      );
    } catch (error) {
      this.logger.error(
        `[OrderModified] Failed to process: ${payload.orderId}`,
        error.stack,
      );
      throw error;
    }
  }
}

