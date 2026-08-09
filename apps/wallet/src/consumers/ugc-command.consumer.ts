import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { PointsAdminService } from '../admin/points-admin.service';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams/ugc.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

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

    const idempotencyKey = `review:${payload.reviewId}`;

    try {
      const result = await this.pointsAdminService.earn(
        payload.userId,
        payload.amount,
        payload.reasonCode,
        idempotencyKey,
      );

      this.logger.log(
        `[Event] Points earned: eventId=${result.eventId}, reviewId=${payload.reviewId}, amount=${payload.amount}`,
      );
    } catch (error) {
      // unique constraint violation → 이미 처리된 리뷰, 정상 ack
      if (error?.code === '23505') {
        this.logger.warn(`[Event] Duplicate EarnPointsRequested ignored: reviewId=${payload.reviewId}`);
        return;
      }

      this.logger.error(`[Event] Failed to process EarnPointsRequested: reviewId=${payload.reviewId}`, error.stack);
      throw error;
    }
  }
}
