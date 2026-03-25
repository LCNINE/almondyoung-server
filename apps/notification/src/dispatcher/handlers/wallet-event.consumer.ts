// apps/notification/src/dispatcher/handlers/wallet-event.consumer.ts
import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  PaymentAuthorizedPayload,
  PaymentCapturedPayload,
  PaymentFailedPayload,
  PaymentCancelledPayload,
  PaymentRefundRequestPayload,
  PaymentRefundCompletedPayload,
  RefundApprovedPayload,
  RefundRejectedPayload,
  RefundFailedPayload,
  PointsEarnedPayload,
  PointsRedeemedPayload,
  PointsCancelledPayload,
  PointsExpiredPayload,
  TaxInvoiceIssuedPayload,
  TaxInvoiceFailedPayload,
  TaxInvoiceCancelledPayload,
} from '@packages/event-contracts/streams';
import { DomainEvent } from '@packages/event-contracts/types';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';

/**
 * Payment Service 이벤트 컨슈머
 *
 * payment/wallet 서비스가 발행한 이벤트를 수신하여 알림을 발송합니다.
 *
 * ⚠️ Outbox 패턴 참고:
 * - 각 MSA 서비스는 `publishEvent`를 직접 호출하지 않고 `outbox.service.enqueue()`를 사용합니다.
 * - Outbox에 저장된 이벤트는 OutboxDispatcher가 주기적으로 폴링하여 Kafka로 발행합니다.
 * - Outbox에 기록이 있으면 중복 발행을 방지합니다.
 * - 이 컨슈머는 소비자(consumer)이므로 Outbox 패턴과 직접 관련 없지만, 참고용으로 명시합니다.
 *
 * Payment 이벤트:
 * - PaymentAuthorized: 결제 승인
 * - PaymentCaptured: 결제 완료
 * - PaymentFailed: 결제 실패
 * - PaymentCancelled: 결제 취소
 *
 * Refund 이벤트:
 * - PaymentRefundRequest: 환불 요청 (SoT)
 * - PaymentRefundCompleted: 환불 완료 (SoT)
 * - RefundApproved: 환불 승인
 * - RefundRejected: 환불 거부
 * - RefundFailed: 환불 실패
 *
 * Point 이벤트:
 * - PointsEarned: 포인트 적립
 * - PointsRedeemed: 포인트 사용
 * - PointsCancelled: 포인트 취소
 * - PointsExpired: 포인트 만료
 *
 * Tax Invoice 이벤트:
 * - TaxInvoiceIssued: 세금계산서 발행
 * - TaxInvoiceFailed: 세금계산서 발행 실패
 * - TaxInvoiceCancelled: 세금계산서 취소
 */
@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class WalletEventConsumer {
  private readonly logger = new Logger(WalletEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  // ===== Payment 이벤트 =====

  @OnEvent('payments.events.v1', 'PaymentAuthorized')
  async onPaymentAuthorized(
    @EventEnvelope() envelope: DomainEvent<PaymentAuthorizedPayload>,
    @EventPayload() payload: PaymentAuthorizedPayload,
  ) {
    this.logger.log(
      `[Event] Received PaymentAuthorized: ${payload.intentId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_AUTHORIZED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_AUTHORIZED not found or inactive.`);
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
          intentId: payload.intentId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          currency: payload.currency,
          providerType: payload.providerType,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_AUTHORIZED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_AUTHORIZED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PaymentCaptured')
  async onPaymentCaptured(
    @EventEnvelope() envelope: DomainEvent<PaymentCapturedPayload>,
    @EventPayload() payload: PaymentCapturedPayload,
  ) {
    this.logger.log(
      `[Event] Received PaymentCaptured: ${payload.paymentId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_CAPTURED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_CAPTURED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.orderId, // PaymentCaptured는 orderId만 있음, TODO: orderId로 userId 조회 필요
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          orderId: payload.orderId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          currency: payload.currencyCode,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_CAPTURED notification for ${payload.orderId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_CAPTURED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PaymentFailed')
  async onPaymentFailed(
    @EventEnvelope() envelope: DomainEvent<PaymentFailedPayload>,
    @EventPayload() payload: PaymentFailedPayload,
  ) {
    this.logger.log(`[Event] Received PaymentFailed: ${payload.intentId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_FAILED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_FAILED not found or inactive.`);
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
          intentId: payload.intentId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          currency: payload.currency,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_FAILED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_FAILED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PaymentCancelled')
  async onPaymentCancelled(
    @EventEnvelope() envelope: DomainEvent<PaymentCancelledPayload>,
    @EventPayload() payload: PaymentCancelledPayload,
  ) {
    this.logger.log(
      `[Event] Received PaymentCancelled: ${payload.intentId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_CANCELLED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_CANCELLED not found or inactive.`);
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
          intentId: payload.intentId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_CANCELLED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_CANCELLED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ===== Refund 이벤트 =====

  @OnEvent('payments.events.v1', 'PaymentRefundRequest')
  async onPaymentRefundRequest(
    @EventEnvelope() envelope: DomainEvent<PaymentRefundRequestPayload>,
    @EventPayload() payload: PaymentRefundRequestPayload,
  ) {
    this.logger.log(
      `[Event] Received PaymentRefundRequest: ${payload.refundId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('REFUND_REQUESTED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for REFUND_REQUESTED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          refundId: payload.refundId,
          paymentEventId: payload.paymentEventId,
          amount: payload.amount,
          reason: payload.reason,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched REFUND_REQUESTED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process REFUND_REQUESTED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PaymentRefundCompleted')
  async onPaymentRefundCompleted(
    @EventEnvelope() envelope: DomainEvent<PaymentRefundCompletedPayload>,
    @EventPayload() payload: PaymentRefundCompletedPayload,
  ) {
    this.logger.log(
      `[Event] Received PaymentRefundCompleted: ${payload.refundId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('REFUND_COMPLETED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for REFUND_COMPLETED not found or inactive.`);
        return;
      }

      // PaymentRefundCompleted는 userId가 없으므로 paymentId로 조회하거나 metadata에서 추출 필요
      // TODO: paymentId로 userId 조회
      const sendDto: SendNotificationDto = {
        userId: payload.paymentId, // 임시: paymentId로 userId 조회 필요
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          orderId: payload.orderId,
          amount: payload.amount,
          currency: payload.currency,
          status: payload.status,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched REFUND_COMPLETED notification for ${payload.paymentId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process REFUND_COMPLETED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'RefundApproved')
  async onRefundApproved(
    @EventEnvelope() envelope: DomainEvent<RefundApprovedPayload>,
    @EventPayload() payload: RefundApprovedPayload,
  ) {
    this.logger.log(`[Event] Received RefundApproved: ${payload.refundId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('REFUND_APPROVED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for REFUND_APPROVED not found or inactive.`);
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
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          intentId: payload.intentId,
          amount: payload.amount,
          currency: payload.currency,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched REFUND_APPROVED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process REFUND_APPROVED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'RefundRejected')
  async onRefundRejected(
    @EventEnvelope() envelope: DomainEvent<RefundRejectedPayload>,
    @EventPayload() payload: RefundRejectedPayload,
  ) {
    this.logger.log(`[Event] Received RefundRejected: ${payload.refundId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('REFUND_REJECTED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for REFUND_REJECTED not found or inactive.`);
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
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          intentId: payload.intentId,
          amount: payload.amount,
          currency: payload.currency,
          rejectionReason: payload.rejectionReason,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched REFUND_REJECTED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process REFUND_REJECTED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'RefundFailed')
  async onRefundFailed(
    @EventEnvelope() envelope: DomainEvent<RefundFailedPayload>,
    @EventPayload() payload: RefundFailedPayload,
  ) {
    this.logger.log(`[Event] Received RefundFailed: ${payload.refundId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('REFUND_FAILED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for REFUND_FAILED not found or inactive.`);
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
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          intentId: payload.intentId,
          amount: payload.amount,
          currency: payload.currency,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched REFUND_FAILED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process REFUND_FAILED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ===== Point 이벤트 =====

  @OnEvent('payments.events.v1', 'PointsEarned')
  async onPointsEarned(
    @EventEnvelope() envelope: DomainEvent<PointsEarnedPayload>,
    @EventPayload() payload: PointsEarnedPayload,
  ) {
    this.logger.log(`[Event] Received PointsEarned: ${payload.pointId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('POINTS_EARNED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for POINTS_EARNED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId || payload.partnerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          pointId: payload.pointId,
          amount: payload.amount,
          reason: payload.reason,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched POINTS_EARNED notification for ${payload.userId || payload.partnerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process POINTS_EARNED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PointsRedeemed')
  async onPointsRedeemed(
    @EventEnvelope() envelope: DomainEvent<PointsRedeemedPayload>,
    @EventPayload() payload: PointsRedeemedPayload,
  ) {
    this.logger.log(`[Event] Received PointsRedeemed: ${payload.pointId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('POINTS_REDEEMED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for POINTS_REDEEMED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId || payload.partnerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          pointId: payload.pointId,
          amount: payload.amount,
          reason: payload.reason,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched POINTS_REDEEMED notification for ${payload.userId || payload.partnerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process POINTS_REDEEMED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PointsCancelled')
  async onPointsCancelled(
    @EventEnvelope() envelope: DomainEvent<PointsCancelledPayload>,
    @EventPayload() payload: PointsCancelledPayload,
  ) {
    this.logger.log(`[Event] Received PointsCancelled: ${payload.pointId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('POINTS_CANCELLED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for POINTS_CANCELLED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId || payload.partnerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          pointId: payload.pointId,
          amount: payload.amount,
          reason: payload.reason,
          orderId: payload.orderId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched POINTS_CANCELLED notification for ${payload.userId || payload.partnerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process POINTS_CANCELLED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'PointsExpired')
  async onPointsExpired(
    @EventEnvelope() envelope: DomainEvent<PointsExpiredPayload>,
    @EventPayload() payload: PointsExpiredPayload,
  ) {
    this.logger.log(`[Event] Received PointsExpired: ${payload.pointId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('POINTS_EXPIRED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for POINTS_EXPIRED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId || payload.partnerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          pointId: payload.pointId,
          amount: payload.amount,
          earnedAt: payload.earnedAt,
          expiredAt: payload.expiredAt,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched POINTS_EXPIRED notification for ${payload.userId || payload.partnerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process POINTS_EXPIRED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ===== Tax Invoice 이벤트 =====

  @OnEvent('payments.events.v1', 'TaxInvoiceIssued')
  async onTaxInvoiceIssued(
    @EventEnvelope() envelope: DomainEvent<TaxInvoiceIssuedPayload>,
    @EventPayload() payload: TaxInvoiceIssuedPayload,
  ) {
    this.logger.log(
      `[Event] Received TaxInvoiceIssued: ${payload.invoiceId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('TAX_INVOICE_ISSUED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for TAX_INVOICE_ISSUED not found or inactive.`);
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
          invoiceId: payload.invoiceId,
          orderId: payload.orderId,
          paymentId: payload.paymentId,
          totalAmount: payload.totalAmount,
          taxAmount: payload.taxAmount,
          businessNumber: payload.businessNumber,
          email: payload.email,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched TAX_INVOICE_ISSUED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process TAX_INVOICE_ISSUED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'TaxInvoiceFailed')
  async onTaxInvoiceFailed(
    @EventEnvelope() envelope: DomainEvent<TaxInvoiceFailedPayload>,
    @EventPayload() payload: TaxInvoiceFailedPayload,
  ) {
    this.logger.log(
      `[Event] Received TaxInvoiceFailed: ${payload.invoiceId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('TAX_INVOICE_FAILED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for TAX_INVOICE_FAILED not found or inactive.`);
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
          invoiceId: payload.invoiceId,
          orderId: payload.orderId,
          paymentId: payload.paymentId,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched TAX_INVOICE_FAILED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process TAX_INVOICE_FAILED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('payments.events.v1', 'TaxInvoiceCancelled')
  async onTaxInvoiceCancelled(
    @EventEnvelope() envelope: DomainEvent<TaxInvoiceCancelledPayload>,
    @EventPayload() payload: TaxInvoiceCancelledPayload,
  ) {
    this.logger.log(
      `[Event] Received TaxInvoiceCancelled: ${payload.invoiceId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('TAX_INVOICE_CANCELLED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for TAX_INVOICE_CANCELLED not found or inactive.`);
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
          invoiceId: payload.invoiceId,
          orderId: payload.orderId,
          reason: payload.reason,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched TAX_INVOICE_CANCELLED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process TAX_INVOICE_CANCELLED notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}
