// apps/notification/src/dispatcher/handlers/membership-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On, RetryPolicy } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { UserContactClient } from '@app/shared';
import { NotifyMemberDeps, notifyMember } from './notify-member';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { formatAmount, formatDate } from '../../shared/utils/template-helpers';
import { formatBillingPeriod, formatKstMonthDay, nextSendableAt, nhnRequestDateIfQuiet } from './billing-notice.format';
import { MEMBERSHIP_STREAM } from '@packages/event-contracts/streams/membership.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * Membership Service 이벤트 컨슈머
 *
 * - MembershipRenewalUpcoming: 자동갱신 결제 사전 고지 (전자상거래법 계속거래 고지)
 * - MembershipExpiryUpcoming: 자동갱신이 없는 이용권의 만료 사전 고지
 * - MembershipBillingAttemptFailed / MembershipTerminatedForNonPayment: 정기결제 출금 실패·미납 해지 알림톡
 *
 * 수신자 이메일은 membership 이 payload 에 실어 보낸다 — 이 서비스는 사용자 조회를 하지 않는다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
// 다른 컨슈머와 같은 이유로 재시도 금지 — 재시도가 앞 채널을 재발송한다(고객이 보는 중복).
@RetryPolicy({ maxRetries: 0 })
export class MembershipEventConsumer {
  private readonly logger = new Logger(MembershipEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
    private readonly userContactClient: UserContactClient,
  ) {}

  private get notifyDeps(): NotifyMemberDeps {
    return {
      dispatcher: this.notificationDispatcherService,
      eventMappings: this.eventMappingService,
      contacts: this.userContactClient,
      logger: this.logger,
    };
  }

  @On(MEMBERSHIP_STREAM, 'MembershipRenewalUpcoming')
  async onRenewalUpcoming(
    @EventEnvelope() envelope: EnvelopeOf<typeof MEMBERSHIP_STREAM, 'MembershipRenewalUpcoming'>,
    @EventPayload() payload: EventPayloadOf<typeof MEMBERSHIP_STREAM, 'MembershipRenewalUpcoming'>,
  ) {
    this.logger.log(
      `[Event] Received MembershipRenewalUpcoming: ${payload.contractId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('MEMBERSHIP_RENEWAL_UPCOMING');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for MEMBERSHIP_RENEWAL_UPCOMING not found or inactive.`);
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
        // 날짜·금액은 여기서 포맷을 끝낸다 — 렌더러는 `{{var}}` 단순 치환이라
        // 템플릿 안의 `{{formatDate x}}` 는 치환되지 않고 리터럴로 남는다.
        variables: {
          userName: payload.userName,
          planName: payload.planName,
          nextBillingDate: formatDate(payload.nextBillingDate),
          amount: formatAmount(payload.amount),
          paymentMethodLabel: payload.paymentMethodLabel,
          currentPeriodEnd: formatDate(payload.currentPeriodEnd),
          nextPeriodEnd: formatDate(payload.nextPeriodEnd),
          noticeDaysBefore: payload.noticeDaysBefore,
          manageUrl: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/kr/mypage/membership`
            : 'https://almondyoung.com/kr/mypage/membership',
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched MEMBERSHIP_RENEWAL_UPCOMING notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(
        `[Event] Failed to process MEMBERSHIP_RENEWAL_UPCOMING notification: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  @On(MEMBERSHIP_STREAM, 'MembershipExpiryUpcoming')
  async onExpiryUpcoming(
    @EventEnvelope() envelope: EnvelopeOf<typeof MEMBERSHIP_STREAM, 'MembershipExpiryUpcoming'>,
    @EventPayload() payload: EventPayloadOf<typeof MEMBERSHIP_STREAM, 'MembershipExpiryUpcoming'>,
  ) {
    this.logger.log(
      `[Event] Received MembershipExpiryUpcoming: ${payload.entitlementId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('MEMBERSHIP_EXPIRY_UPCOMING');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for MEMBERSHIP_EXPIRY_UPCOMING not found or inactive.`);
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
          userName: payload.userName,
          planName: payload.planName,
          expiresAt: formatDate(payload.expiresAt),
          noticeDaysBefore: payload.noticeDaysBefore,
          manageUrl: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/kr/mypage/membership`
            : 'https://almondyoung.com/kr/mypage/membership',
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched MEMBERSHIP_EXPIRY_UPCOMING notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(
        `[Event] Failed to process MEMBERSHIP_EXPIRY_UPCOMING notification: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  @On(MEMBERSHIP_STREAM, 'MembershipStatusChanged')
  async onStatusChanged(
    @EventEnvelope() envelope: EnvelopeOf<typeof MEMBERSHIP_STREAM, 'MembershipStatusChanged'>,
    @EventPayload() payload: EventPayloadOf<typeof MEMBERSHIP_STREAM, 'MembershipStatusChanged'>,
  ) {
    // RECURRING_CANCELLED 는 자동갱신만 끈 «해지 예약» 이다 — 종료일까지는 그대로 쓴다.
    // 같은 메일로 묶으면 「해지되었습니다」가 아직 쓰는 사람에게 간다.
    const eventKey =
      payload.status === 'ACTIVE' && payload.reasonCode === 'SUBSCRIBED'
        ? 'MEMBERSHIP_JOINED'
        : payload.status === 'RECURRING_CANCELLED'
          ? 'MEMBERSHIP_CANCEL_SCHEDULED'
          : payload.status === 'CANCELLED'
            ? 'MEMBERSHIP_CANCELLED'
            : null;
    if (!eventKey) return;

    await notifyMember(this.notifyDeps, {
      eventKey,
      userId: payload.userId,
      correlationId: envelope.correlationId,
      payload,
      variables: (contact) => ({
        name: contact.username || '고객',
        endsAt: payload.periodEndsAt ? formatDate(payload.periodEndsAt) : '',
      }),
    });
  }

  @On(MEMBERSHIP_STREAM, 'MembershipBillingAttemptFailed')
  async onBillingAttemptFailed(
    @EventEnvelope() envelope: EnvelopeOf<typeof MEMBERSHIP_STREAM, 'MembershipBillingAttemptFailed'>,
    @EventPayload() payload: EventPayloadOf<typeof MEMBERSHIP_STREAM, 'MembershipBillingAttemptFailed'>,
  ) {
    await this.sendBillingNotice({
      eventKey: 'MEMBERSHIP_BILLING_ATTEMPT_FAILED',
      idempotencyKey: `membership:billing-failed:${payload.invoiceId}:${payload.attemptCount}`,
      correlationId: envelope.correlationId,
      payload,
      variables: {
        name: payload.userName || '고객',
        period: formatBillingPeriod(payload.periodStart, payload.periodEnd),
        amount: payload.amount != null ? `${formatAmount(payload.amount)}원` : '',
        attempt: payload.attemptCount,
        reason: payload.reasonText ?? '은행에서 출금이 거절됐어요',
        nextDate: formatKstMonthDay(payload.nextAttemptRequestAt),
        remaining: payload.remainingAttempts,
      },
    });
  }

  @On(MEMBERSHIP_STREAM, 'MembershipTerminatedForNonPayment')
  async onTerminatedForNonPayment(
    @EventEnvelope() envelope: EnvelopeOf<typeof MEMBERSHIP_STREAM, 'MembershipTerminatedForNonPayment'>,
    @EventPayload() payload: EventPayloadOf<typeof MEMBERSHIP_STREAM, 'MembershipTerminatedForNonPayment'>,
  ) {
    const withArrears = payload.arrearsAmount != null;
    await this.sendBillingNotice({
      eventKey: withArrears ? 'MEMBERSHIP_TERMINATED_WITH_ARREARS' : 'MEMBERSHIP_TERMINATED_NO_ARREARS',
      idempotencyKey: `membership:terminated-notice:${payload.contractId}`,
      correlationId: envelope.correlationId,
      payload,
      variables: {
        name: payload.userName || '고객',
        period: formatBillingPeriod(payload.periodStart, payload.periodEnd),
        ...(withArrears && { arrearsAmount: `${formatAmount(payload.arrearsAmount)}원` }),
      },
    });
  }

  /**
   * 출금 실패·미납 해지 알림톡. 알림톡이 안 닿으면 NHN 이 같은 본문으로 문자를 대신 보낸다(smsFallback).
   * 같은 사건이 다시 와도 멱등키가 한 번만 보내게 하고, 한밤중에 생긴 알림은 아침 8시에 보낸다.
   */
  private async sendBillingNotice(input: {
    eventKey: string;
    idempotencyKey: string;
    correlationId?: string;
    payload: { userId: string; userName: string; phoneNumber: string };
    variables: Record<string, string | number>;
  }): Promise<void> {
    const mapping = await this.eventMappingService.getEventMapping(input.eventKey);
    if (!mapping || !mapping.isActive) {
      this.logger.warn(`Event mapping for ${input.eventKey} not found or inactive.`);
      return;
    }

    const now = new Date();
    const sendAt = nextSendableAt(now);
    const requestDate = nhnRequestDateIfQuiet(now);
    await this.notificationDispatcherService.send({
      userId: input.payload.userId,
      channels: mapping.defaultChannels as Channel[],
      category: mapping.category as NotificationCategory,
      templateKey: mapping.templateKey,
      eventKey: mapping.eventKey,
      payload: { name: input.payload.userName, phoneNumber: input.payload.phoneNumber },
      correlationId: input.correlationId,
      priority: mapping.priority as NotificationPriority,
      variables: input.variables,
      // 직접 발송 경로는 sendAt 을 보지 않는다 — 밤 시간 이연은 NHN 예약 발송(requestDate)에 맡긴다.
      metadata: { smsFallback: true, ...(requestDate && { requestDate }) },
      sendAt: sendAt.toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    this.logger.log(`[Event] Dispatched ${input.eventKey} for ${input.payload.userId}`);
  }
}
