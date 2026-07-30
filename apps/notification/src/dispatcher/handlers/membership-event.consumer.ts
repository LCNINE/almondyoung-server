// apps/notification/src/dispatcher/handlers/membership-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';

/**
 * 멤버십 이벤트 컨슈머 — 해지 확인 안내.
 *
 * `MembershipStatusChanged` 는 status 로 구분되는 단일 이벤트라, 상태별로 다른 eventKey 에 매핑한다.
 * 알림 대상은 해지 관련 상태뿐이다 — 가입/갱신(ACTIVE)은 결제 알림과 중복이고, 일시정지/만료는
 * 별도 정책이 정해지기 전까지 보내지 않는다.
 *
 * 수신자 주소는 **이벤트 payload 의 email** 로만 해결된다(디스패처가 사용자 조회를 하지 않는다).
 * email 이 없으면 발송을 시도하지 않고 스킵한다 — 시도하면 알림 행만 FAILED 로 쌓인다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipEventConsumer {
  private readonly logger = new Logger(MembershipEventConsumer.name);

  /** 해지 관련 상태 → 알림 eventKey. 여기 없는 상태는 알림 대상이 아니다. */
  private static readonly EVENT_KEY_BY_STATUS: Partial<Record<MembershipStatusChangedPayload['status'], string>> = {
    CANCELLED: 'MEMBERSHIP_CANCELLED',
    RECURRING_CANCELLED: 'MEMBERSHIP_RECURRING_CANCELLED',
  };

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @OnEvent('membership.events.v1', 'MembershipStatusChanged')
  async onMembershipStatusChanged(
    @EventEnvelope() envelope: DomainEvent<MembershipStatusChangedPayload>,
    @EventPayload() payload: MembershipStatusChangedPayload,
  ) {
    const eventKey = MembershipEventConsumer.EVENT_KEY_BY_STATUS[payload.status];
    if (!eventKey) return;

    this.logger.log(
      `[Event] MembershipStatusChanged: ${payload.userId} → ${payload.status} (correlationId: ${envelope.correlationId})`,
    );

    if (!payload.email) {
      this.logger.warn(`Skipping ${eventKey} notification: no email in payload (userId=${payload.userId})`);
      return;
    }

    try {
      const eventMapping = await this.eventMappingService.getEventMapping(eventKey);
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for ${eventKey} not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as SendNotificationDto['channels'],
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as SendNotificationDto['priority'],
        variables: {
          email: payload.email,
          // 즉시해지는 종료일이 없다(오늘 종료) — 문구에서 분기하지 않게 빈 값 대신 안내 문장을 넣는다.
          endsAt: payload.periodEndsAt ?? '즉시 종료',
          refundAmount: (payload.refundAmount ?? 0).toLocaleString('ko-KR'),
          refundNotice: this.buildRefundNotice(payload),
        },
      };

      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched ${eventKey} notification for ${payload.userId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Event] Failed to process ${eventKey} notification: ${message}`);
      throw error; // DLQ 로 보낸다
    }
  }

  /** 환불 상태별 안내 문구. PENDING 은 계좌 송금 대기(효성 CMS 등)라 "처리 중"으로 안내해야 한다. */
  private buildRefundNotice(payload: MembershipStatusChangedPayload): string {
    const amount = payload.refundAmount ?? 0;
    if (amount <= 0) return '환불 대상 금액은 없습니다.';

    const formatted = `${amount.toLocaleString('ko-KR')}원`;
    switch (payload.refundStatus) {
      case 'COMPLETED':
        return `${formatted}이 환불 처리되었습니다. 결제 수단에 따라 반영까지 영업일이 소요될 수 있습니다.`;
      case 'PENDING':
        return `${formatted} 환불이 접수되었습니다. 확인 후 등록해 주신 계좌로 입금해 드립니다.`;
      case 'FAILED':
        return `${formatted} 환불 처리 중 문제가 발생했습니다. 고객센터에서 확인 후 연락드리겠습니다.`;
      default:
        return `${formatted} 환불이 접수되었습니다.`;
    }
  }
}
