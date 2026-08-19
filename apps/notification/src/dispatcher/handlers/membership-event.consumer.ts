// apps/notification/src/dispatcher/handlers/membership-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On, RetryPolicy } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { MEMBERSHIP_STREAM } from '@packages/event-contracts/streams/membership.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * Membership Service 이벤트 컨슈머
 *
 * - MembershipRenewalUpcoming: 자동갱신 결제 사전 고지 (전자상거래법 계속거래 고지)
 * - MembershipExpiryUpcoming: 자동갱신이 없는 이용권의 만료 사전 고지
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
  ) {}

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
        variables: {
          userName: payload.userName,
          planName: payload.planName,
          nextBillingDate: payload.nextBillingDate,
          amount: payload.amount,
          paymentMethodLabel: payload.paymentMethodLabel,
          currentPeriodEnd: payload.currentPeriodEnd,
          nextPeriodEnd: payload.nextPeriodEnd,
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
          expiresAt: payload.expiresAt,
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
}
