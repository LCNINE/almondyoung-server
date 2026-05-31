// apps/notification/src/dispatcher/handlers/order-event.consumer.ts
import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { OrderCreatedPayload, OrderPaymentCompletedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';

/**
 * Order Service 이벤트 컨슈머
 *
 * order/medusa 서비스가 발행한 이벤트를 수신하여 알림을 발송합니다.
 * - OrderCreated: 주문 생성
 * - OrderPaymentCompleted: 결제 완료
 */
@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class OrderEventConsumer {
  private readonly logger = new Logger(OrderEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @OnEvent('orders.events.v1', 'OrderCreated')
  async onOrderCreated(
    @EventEnvelope() envelope: DomainEvent<OrderCreatedPayload>,
    @EventPayload() payload: OrderCreatedPayload,
  ) {
    this.logger.log(`[Event] Received OrderCreated: ${payload.orderId} (correlationId: ${envelope.correlationId})`);
    try {
      // 비-로그인 채널/미링크 고객 주문은 내부 user(=customerId)가 없어 알림 대상이 없다. 스킵.
      if (!payload.customerId) {
        this.logger.warn(`Skipping ORDER_CREATED notification: no customerId (order ${payload.orderId})`);
        return;
      }

      const eventMapping = await this.eventMappingService.getEventMapping('ORDER_CREATED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for ORDER_CREATED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.customerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          orderId: payload.orderId,
          totalAmount: payload.totalAmount,
          currency: payload.currency,
          customerEmail: payload.customerId, // TODO: 실제 email 조회 필요
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched ORDER_CREATED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process ORDER_CREATED notification: ${error.message}`, error.stack);
      throw error; // Re-throw to send to DLQ
    }
  }

  @OnEvent('orders.events.v1', 'OrderPaymentCompleted')
  async onPaymentCompleted(
    @EventEnvelope() envelope: DomainEvent<OrderPaymentCompletedPayload>,
    @EventPayload() payload: OrderPaymentCompletedPayload,
  ) {
    this.logger.log(
      `[Event] Received OrderPaymentCompleted: ${payload.orderId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_COMPLETED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_COMPLETED not found or inactive.`);
        return;
      }

      // TODO: orderId로 order 조회하여 userId 가져오기
      const sendDto: SendNotificationDto = {
        userId: payload.orderId, // 임시
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          orderId: payload.orderId,
          paymentAmount: payload.amount,
          currency: payload.currency,
          customerEmail: payload.orderId, // 임시
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_COMPLETED notification for ${payload.orderId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_COMPLETED notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}
