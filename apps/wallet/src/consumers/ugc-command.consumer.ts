import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { PointsAdminService } from '../admin/points-admin.service';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams/ugc.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * ugc 의 지급 원장 행 id 로 멱등키를 만든다. 리뷰 한 건이 작성 보상과 주간 베스트 보상을
 * 각각 받을 수 있어 reviewId 만으로는 두 지급이 같은 키로 충돌한다.
 *
 * grantId 가 없는 명령은 원장이 생기기 전(구 계약)의 것이라 reviewId 로 되돌아간다.
 */
function idempotencyKeyFor(params: { grantId?: string; reviewId: string }): string {
  return params.grantId ? `review-grant:${params.grantId}` : `review:${params.reviewId}`;
}

@Controller()
@UseInterceptors(EventTypeGuard)
export class UgcCommandConsumer {
  private readonly logger = new Logger(UgcCommandConsumer.name);

  constructor(private readonly pointsAdminService: PointsAdminService) {}

  @On(UGC_COMMAND_STREAM, 'EarnPointsRequested')
  async onEarnPointsRequested(
    @EventEnvelope() envelope: EnvelopeOf<typeof UGC_COMMAND_STREAM, 'EarnPointsRequested'>,
    @EventPayload() payload: EventPayloadOf<typeof UGC_COMMAND_STREAM, 'EarnPointsRequested'>,
  ) {
    this.logger.log(
      `[Event] Received EarnPointsRequested: reviewId=${payload.reviewId}, userId=${payload.userId}, amount=${payload.amount} (correlationId: ${envelope.correlationId})`,
    );

    const idempotencyKey = idempotencyKeyFor(payload);
    // 만료가 붙어 오면 그대로 적립 행에 싣는다 — 만료 없는 적립은 영구 부채로 남는다.
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : undefined;

    try {
      const result = await this.pointsAdminService.earn(
        payload.userId,
        payload.amount,
        payload.reasonCode,
        idempotencyKey,
        expiresAt,
      );

      this.logger.log(
        `[Event] Points earned: eventId=${result.eventId}, reviewId=${payload.reviewId}, amount=${payload.amount}, expiresAt=${payload.expiresAt ?? 'none'}`,
      );
    } catch (error) {
      // unique constraint violation → 이미 처리된 지급, 정상 ack
      if (error?.code === '23505') {
        this.logger.warn(`[Event] Duplicate EarnPointsRequested ignored: reviewId=${payload.reviewId}`);
        return;
      }

      this.logger.error(`[Event] Failed to process EarnPointsRequested: reviewId=${payload.reviewId}`, error.stack);
      throw error;
    }
  }

  @On(UGC_COMMAND_STREAM, 'CancelReviewPointsRequested')
  async onCancelReviewPointsRequested(
    @EventEnvelope() envelope: EnvelopeOf<typeof UGC_COMMAND_STREAM, 'CancelReviewPointsRequested'>,
    @EventPayload() payload: EventPayloadOf<typeof UGC_COMMAND_STREAM, 'CancelReviewPointsRequested'>,
  ) {
    this.logger.log(
      `[Event] Received CancelReviewPointsRequested: grantId=${payload.grantId}, reviewId=${payload.reviewId} (correlationId: ${envelope.correlationId})`,
    );

    const result = await this.pointsAdminService.earnCancelByIdempotencyKey(
      payload.userId,
      idempotencyKeyFor(payload),
      payload.reasonCode,
    );

    if (!result) {
      // 되돌릴 적립이 없다 — 지급이 없었거나 이미 취소된 건이다. 정상 종료.
      this.logger.warn(`[Event] No earn to cancel: grantId=${payload.grantId}, reviewId=${payload.reviewId}`);
      return;
    }

    this.logger.log(`[Event] Points earn cancelled: eventId=${result.eventId}, grantId=${payload.grantId}`);
  }
}
