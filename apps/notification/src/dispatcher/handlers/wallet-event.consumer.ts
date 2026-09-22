// apps/notification/src/dispatcher/handlers/wallet-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On, RetryPolicy } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';
import { UserContactClient } from '@app/shared';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { formatAmount, formatDueDate } from '../../shared/utils/template-helpers';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

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
 *
 * Refund 이벤트:
 * - gateway.refund.succeeded: 환불 완료 (상품 주문만)
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
 *
 * CMS(자동이체) 이벤트:
 * - cms.member.rejected: 계좌 등록 심사 거절
 */
@Controller()
@UseInterceptors(EventTypeGuard)
// 재시도 금지 — NotificationDispatcherService.send 는 채널마다 notifications 행을 INSERT 하고
// 큐에 적재하므로, 루프 중간에 throw 하면 재시도가 앞 채널을 재발송한다(고객이 보는 중복).
// maxRetries:0 은 시도 횟수를 지금과 동일하게 1회로 유지하면서, 실패를 조용한 소실이 아니라
// DLQ 로 보이게 한다 — 오늘보다 순수 개선이다. 멱등 키 도입은 ADR-0029 Follow-up 11.
@RetryPolicy({ maxRetries: 0 })
export class WalletEventConsumer {
  private readonly logger = new Logger(WalletEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
    private readonly userContactClient: UserContactClient,
  ) {}

  // ===== Payment 이벤트 =====

  @On(PAYMENT_STREAM, 'PaymentAuthorized')
  async onPaymentAuthorized(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentAuthorized'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentAuthorized'>,
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

  @On(PAYMENT_STREAM, 'PaymentCaptured')
  async onPaymentCaptured(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentCaptured'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentCaptured'>,
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

  @On(PAYMENT_STREAM, 'PaymentFailed')
  async onPaymentFailed(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentFailed'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentFailed'>,
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

  @On(PAYMENT_STREAM, 'gateway.refund.succeeded')
  async onRefundSucceeded(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'gateway.refund.succeeded'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'gateway.refund.succeeded'>,
  ) {
    if (
      (payload.purpose && payload.purpose !== 'PURCHASE') ||
      payload.intentType === 'MEMBERSHIP_FEE' ||
      !payload.userId
    ) {
      return;
    }

    const mapping = await this.eventMappingService.getEventMapping('REFUND_COMPLETED');
    if (!mapping || !mapping.isActive) {
      this.logger.warn('Event mapping for REFUND_COMPLETED not found or inactive.');
      return;
    }

    const contact = (await this.userContactClient.findContacts([payload.userId])).get(payload.userId);
    const email = contact?.email;
    if (!email) {
      this.logger.warn(`Skipping REFUND_COMPLETED: no email (refund ${payload.refundId})`);
      return;
    }

    await this.notificationDispatcherService.send({
      userId: payload.userId,
      channels: mapping.defaultChannels as Channel[],
      category: mapping.category as NotificationCategory,
      templateKey: mapping.templateKey,
      eventKey: mapping.eventKey,
      payload: { ...payload, email },
      correlationId: envelope.correlationId,
      priority: mapping.priority as NotificationPriority,
      variables: {
        name: (typeof payload.customerName === 'string' ? payload.customerName : contact?.username) ?? '고객',
        amount: formatAmount(payload.amount),
        orderName: typeof payload.orderName === 'string' ? payload.orderName : '주문 상품',
      },
    });
  }

  // ===== Point 이벤트 =====

  @On(PAYMENT_STREAM, 'PointsEarned')
  async onPointsEarned(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PointsEarned'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PointsEarned'>,
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

  @On(PAYMENT_STREAM, 'PointsRedeemed')
  async onPointsRedeemed(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PointsRedeemed'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PointsRedeemed'>,
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

  @On(PAYMENT_STREAM, 'PointsCancelled')
  async onPointsCancelled(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PointsCancelled'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PointsCancelled'>,
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

  @On(PAYMENT_STREAM, 'PointsExpired')
  async onPointsExpired(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PointsExpired'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PointsExpired'>,
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

  @On(PAYMENT_STREAM, 'TaxInvoiceIssued')
  async onTaxInvoiceIssued(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'TaxInvoiceIssued'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'TaxInvoiceIssued'>,
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

  @On(PAYMENT_STREAM, 'TaxInvoiceFailed')
  async onTaxInvoiceFailed(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'TaxInvoiceFailed'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'TaxInvoiceFailed'>,
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

  @On(PAYMENT_STREAM, 'TaxInvoiceCancelled')
  async onTaxInvoiceCancelled(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'TaxInvoiceCancelled'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'TaxInvoiceCancelled'>,
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

  /**
   * 무통장(가상계좌) 발급 직후 입금 안내 메일.
   *
   * wallet 이 intent 를 AWAITING_DEPOSIT 으로 전이하면서 발행한다(confirm.service).
   * 이 메일이 없으면 고객이 결제창을 닫는 순간 입금할 계좌를 다시 볼 방법이 없다.
   *
   * 수신자(email)와 계좌 정보는 반드시 이벤트 payload 로 와야 한다 —
   * notification 에는 wallet intent 조회 경로가 없다.
   */
  @On(PAYMENT_STREAM, 'payment.intent.awaiting_deposit')
  async onIntentAwaitingDeposit(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.awaiting_deposit'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.awaiting_deposit'>,
  ) {
    this.logger.log(
      `[Event] Received IntentAwaitingDeposit: ${payload.intentId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      // 이메일이 없는 결제 경로(카드 즉시결제 등 일부)는 보낼 대상이 없다. 조용히 스킵.
      if (!payload.email) {
        this.logger.warn(`Skipping BANK_TRANSFER_ISSUED: no email (intent ${payload.intentId})`);
        return;
      }

      // `userId` 는 계약상 **선택**이다 (2026-08-09 정정). 스키마는 처음부터 optional 이었고,
      // 인텐트 생성 전 실패처럼 값이 없는 발행 경로가 실재한다 — 인터페이스만 필수라고 적혀
      // 있어서 이 자리가 `undefined` 를 그대로 DTO 에 실을 수 있었다. 이 경로(무통장 발급)는
      // 인텐트가 이미 있어 값이 오지만, 없으면 수신자를 알 수 없으므로 보내지 않는다.
      if (!payload.userId) {
        this.logger.warn(`Skipping BANK_TRANSFER_ISSUED: no userId (intent ${payload.intentId})`);
        return;
      }

      const eventMapping = await this.eventMappingService.getEventMapping('BANK_TRANSFER_ISSUED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for BANK_TRANSFER_ISSUED not found or inactive.`);
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
        // 키 이름은 BANK_TRANSFER_ISSUED_EMAIL 템플릿의 {{...}} 와 정확히 일치해야 한다.
        variables: {
          name: payload.customerName ?? '고객',
          bankName: payload.bankName ?? '-',
          accountNumber: payload.accountNumber ?? '-',
          accountHolder: payload.accountHolder ?? '-',
          // depositAmount = 실제 입금할 금액(포인트 차감 후). 구 이벤트엔 없어 총액으로 폴백.
          amount: formatAmount(payload.depositAmount ?? payload.payableAmount),
          dueDate: formatDueDate(payload.dueDate),
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched BANK_TRANSFER_ISSUED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process BANK_TRANSFER_ISSUED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * CMS 자동이체 계좌 등록 심사 거절 안내.
   *
   * 효성이 보내는 문자는 "신청 접수" 확인일 뿐 심사 결과가 아니다. 이 메일이 없으면 고객은
   * 마이페이지를 직접 열어보기 전까지 거절 사실을 모르고, 정기결제가 조용히 멈춘다.
   */
  /**
   * 계좌 심사 통과. 거절만 알리면 「조용한데 된 건가?」가 되어 결제수단 화면을 다시 열거나
   * 문의가 온다 — 승인도 같은 무게로 알린다.
   */
  /**
   * getEventMapping 은 DB 조회 예외까지 null 로 바꾼다 — 「매핑이 없다」와 「못 읽었다」가
   * 구분되지 않는다. 그대로 return 하면 이벤트가 소비 완료로 ack 되어, 배포 직후 시드가
   * 아직 안 돌았거나 DB 가 잠깐 흔들린 순간의 승인·거절 메일이 영영 사라진다.
   * 못 읽은 것은 끊어서 재시도에 맡기고, 비활성은 «꺼두기로 한 것»이라 그대로 넘긴다.
   */
  private async requireEventMapping(eventKey: string) {
    const mapping = await this.eventMappingService.getEventMapping(eventKey);
    if (!mapping) throw new Error(`Event mapping not found or unreadable: ${eventKey}`);
    if (!mapping.isActive) {
      this.logger.warn(`Event mapping for ${eventKey} is inactive — skipped.`);
      return null;
    }
    return mapping;
  }

  @On(PAYMENT_STREAM, 'cms.member.registered')
  async onCmsMemberRegistered(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'cms.member.registered'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'cms.member.registered'>,
  ) {
    this.logger.log(
      `[Event] Received CmsMemberRegistered: ${payload.cmsMemberId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.requireEventMapping('CMS_MEMBER_REGISTERED');
      if (!eventMapping) return;

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        // 키 이름은 CMS_MEMBER_REGISTERED_EMAIL 템플릿의 {{...}} 와 정확히 일치해야 한다.
        variables: {
          name: payload.userName,
          bankName: payload.bankName,
          payerName: payload.payerName,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched CMS_MEMBER_REGISTERED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process CMS_MEMBER_REGISTERED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 선적용 가입 — 심사 중 계좌로 구독이 시작된 순간. 승인 메일은 1~2 영업일 뒤라
   * 그 사이 "가입했는데 왜 출금이 없지" 를 이 메일이 막는다.
   */
  @On(PAYMENT_STREAM, 'mandate.pending')
  async onMandatePending(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'mandate.pending'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'mandate.pending'>,
  ) {
    this.logger.log(
      `[Event] Received MandatePending: ${payload.subscriberRef} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.requireEventMapping('MANDATE_PENDING');
      if (!eventMapping) return;

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        // 키 이름은 MANDATE_PENDING_EMAIL 템플릿의 {{...}} 와 정확히 일치해야 한다.
        variables: {
          name: payload.userName,
          membershipUrl: this.membershipUrl(),
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched MANDATE_PENDING notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process MANDATE_PENDING notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @On(PAYMENT_STREAM, 'cms.member.rejected')
  async onCmsMemberRejected(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'cms.member.rejected'>,
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'cms.member.rejected'>,
  ) {
    this.logger.log(
      `[Event] Received CmsMemberRejected: ${payload.cmsMemberId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.requireEventMapping('CMS_MEMBER_REJECTED');
      if (!eventMapping) return;

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        // 키 이름은 CMS_MEMBER_REJECTED_EMAIL 템플릿의 {{...}} 와 정확히 일치해야 한다.
        variables: {
          name: payload.userName,
          ...this.cmsRejectCopy(payload.reasonCode),
          registerUrl: this.cmsRegisterUrl(),
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched CMS_MEMBER_REJECTED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process CMS_MEMBER_REJECTED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 거절 사유 → 본문에 끼울 연결형 문구 + 그 사유에 맞는 조치 안내.
   *
   * 효성 원문("생년월일/사업자번호 불일치")은 종결형 명사구라 문장에 그대로 못 넣는다. 또
   * 코드마다 고쳐야 할 것이 다르다 — 계좌번호 오류(Q101)에 "생년월일을 확인하세요"라고 보내면
   * 고객이 못 고치고 CS 로 되돌아온다. 아래 5개는 라이브에서 실제로 관측된 전체 집합이다
   * (2026-08 기준 Q201 33 / Q101 11 / Q108 2 / Q121 2 / Q122 1).
   */
  private cmsRejectCopy(reasonCode: string | null): { reason: string; action: string } {
    switch (reasonCode) {
      case 'Q201':
        return {
          reason: '입력하신 생년월일(사업자번호)과 은행에 등록된 예금주 정보가 일치하지 않아',
          action: '예금주명과 생년월일(사업자번호)을 은행에 등록된 정보와 동일하게 입력하신 후',
        };
      case 'Q101':
        return {
          reason: '입력하신 계좌번호를 확인할 수 없어',
          action: '계좌번호를 다시 확인하신 후',
        };
      case 'Q122':
        return {
          reason: '입력하신 은행 또는 계좌번호를 확인할 수 없어',
          action: '은행과 계좌번호를 다시 확인하신 후',
        };
      case 'Q108':
        return {
          reason: '해당 계좌가 출금이 불가능한 상태로 확인되어',
          action: '출금이 가능한 다른 계좌로',
        };
      case 'Q121':
        return {
          reason: '해당 계좌가 자동이체 출금이 가능한 계좌로 등록되어 있지 않아',
          action: '거래하시는 은행에 자동이체 가능 여부를 확인하시거나 다른 계좌로',
        };
      default:
        return {
          reason: '은행 확인 절차를 통과하지 못해',
          action: '입력하신 계좌 정보를 다시 확인하신 후',
        };
    }
  }

  private storefrontBase(): string {
    return process.env.STOREFRONT_URL ?? 'https://almondyoung.com';
  }

  /** 계좌 등록 진입점. 여기서 wallet-web /billing-change 로 넘어간다. */
  private cmsRegisterUrl(): string {
    return `${this.storefrontBase()}/kr/mypage/membership/payment-method`;
  }

  /** 심사 진행 상태 배너가 상시로 떠 있는 곳 — 메일을 지워도 여기서 다시 볼 수 있다. */
  private membershipUrl(): string {
    return `${this.storefrontBase()}/kr/mypage/membership`;
  }
}
