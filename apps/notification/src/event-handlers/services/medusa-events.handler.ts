// apps/notification/src/event-handlers/services/medusa-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';

// Medusa 이벤트 타입 정의 (예시)
interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  email: string;
  name: string;
  orderNumber: string;
  total: number;
  timestamp: string;
  correlationId: string;
  source: string;
}

interface PaymentCompletedPayload {
  orderId: string;
  userId: string;
  email: string;
  name: string;
  paymentId: string;
  amount: number;
  timestamp: string;
  correlationId: string;
  source: string;
}

@Injectable()
export class MedusaEventsHandler {
  private readonly logger = new Logger(MedusaEventsHandler.name);

  constructor(
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @TypedEventPattern<any, 'ORDER_CREATED'>('ORDER_CREATED')
  async onOrderCreated(payload: OrderCreatedPayload) {
    this.logger.log(`[MEDUSA] Received ORDER_CREATED event for order: ${payload.orderId}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('ORDER_CREATED');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for ORDER_CREATED');
        return;
      }

      // 주문 생성 알림 발송 (정보성 알림이므로 동의 불필요)
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: eventMapping.templateKey,
        eventKey: 'ORDER_CREATED',
        payload: {
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
          total: payload.total,
          email: payload.email,
          name: payload.name,
        },
        correlationId: payload.correlationId,
        priority: 'NORMAL',
      });

      this.logger.log(`[MEDUSA] Order created notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[MEDUSA] Failed to send order created notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<any, 'PAYMENT_COMPLETED'>('PAYMENT_COMPLETED')
  async onPaymentCompleted(payload: PaymentCompletedPayload) {
    this.logger.log(`[MEDUSA] Received PAYMENT_COMPLETED event for order: ${payload.orderId}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_COMPLETED');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for PAYMENT_COMPLETED');
        return;
      }

      // 결제 완료 알림 발송 (정보성 알림이므로 동의 불필요)
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: eventMapping.templateKey,
        eventKey: 'PAYMENT_COMPLETED',
        payload: {
          orderId: payload.orderId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          email: payload.email,
          name: payload.name,
        },
        correlationId: payload.correlationId,
        priority: 'NORMAL',
      });

      this.logger.log(`[MEDUSA] Payment completed notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[MEDUSA] Failed to send payment completed notification: ${error.message}`, error.stack);
    }
  }
}
