// apps/notification/src/event-handlers/services/wallet-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';

// Wallet 이벤트 타입 정의 (예시)
interface PaymentRefundCompletedPayload {
  refundId: string;
  userId: string;
  email: string;
  name: string;
  amount: number;
  reason: string;
  timestamp: string;
  correlationId: string;
  source: string;
}

interface BnplBillingCreatedPayload {
  billingId: string;
  userId: string;
  email: string;
  name: string;
  amount: number;
  dueDate: string;
  timestamp: string;
  correlationId: string;
  source: string;
}

@Injectable()
export class WalletEventsHandler {
  private readonly logger = new Logger(WalletEventsHandler.name);

  constructor(
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @TypedEventPattern<any, 'PAYMENT_REFUND_COMPLETED'>('PAYMENT_REFUND_COMPLETED')
  async onPaymentRefundCompleted(payload: PaymentRefundCompletedPayload) {
    this.logger.log(`[WALLET] Received PAYMENT_REFUND_COMPLETED event for refund: ${payload.refundId}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_REFUND_COMPLETED');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for PAYMENT_REFUND_COMPLETED');
        return;
      }

      // 환불 완료 알림 발송 (정보성 알림이므로 동의 불필요)
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: eventMapping.templateKey,
        eventKey: 'PAYMENT_REFUND_COMPLETED',
        payload: {
          refundId: payload.refundId,
          amount: payload.amount,
          reason: payload.reason,
          email: payload.email,
          name: payload.name,
        },
        correlationId: payload.correlationId,
        priority: 'NORMAL',
      });

      this.logger.log(`[WALLET] Payment refund completed notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[WALLET] Failed to send payment refund completed notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<any, 'BNPL_BILLING_CREATED'>('BNPL_BILLING_CREATED')
  async onBnplBillingCreated(payload: BnplBillingCreatedPayload) {
    this.logger.log(`[WALLET] Received BNPL_BILLING_CREATED event for billing: ${payload.billingId}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('BNPL_BILLING_CREATED');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for BNPL_BILLING_CREATED');
        return;
      }

      // BNPL 청구서 생성 알림 발송 (정보성 알림이므로 동의 불필요)
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: eventMapping.templateKey,
        eventKey: 'BNPL_BILLING_CREATED',
        payload: {
          billingId: payload.billingId,
          amount: payload.amount,
          dueDate: payload.dueDate,
          email: payload.email,
          name: payload.name,
        },
        correlationId: payload.correlationId,
        priority: 'NORMAL',
      });

      this.logger.log(`[WALLET] BNPL billing created notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[WALLET] Failed to send BNPL billing created notification: ${error.message}`, error.stack);
    }
  }
}
