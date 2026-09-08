import { Injectable, Logger } from '@nestjs/common';
import { InjectPublisher, PublisherFor } from '@app/events';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams';
import type { UgcTx } from '../rewards/review-reward-rule.service';

/**
 * 적립 명령 발행. 즉시 Kafka 로 보내지 않고 **호출자의 트랜잭션에 아웃박스 행으로 적재**한다 —
 * 지급 원장에는 「지급했다」고 남았는데 명령만 유실되는 창을 없애기 위해서다.
 */
@Injectable()
export class ReviewRewardPublisher {
  private readonly logger = new Logger(ReviewRewardPublisher.name);

  constructor(
    @InjectPublisher(UGC_COMMAND_STREAM)
    private readonly publisher: PublisherFor<typeof UGC_COMMAND_STREAM>,
  ) {}

  async enqueueEarnPointsCommand(
    params: {
      grantId: string;
      reviewId: string;
      userId: string;
      reviewType: 'TEXT' | 'PHOTO';
      amount: number;
      reasonCode: string;
      productId: string;
      expiresAt: Date | null;
    },
    tx: UgcTx,
  ): Promise<void> {
    await this.publisher.enqueue(
      {
        eventType: 'EarnPointsRequested',
        aggregateId: params.reviewId,
        idempotencyKey: `review-grant:${params.grantId}`,
        payload: {
          grantId: params.grantId,
          reviewId: params.reviewId,
          userId: params.userId,
          reviewType: params.reviewType,
          amount: params.amount,
          reasonCode: params.reasonCode,
          productId: params.productId,
          expiresAt: params.expiresAt ? params.expiresAt.toISOString() : null,
          requestedAt: new Date().toISOString(),
        },
      },
      tx,
    );

    this.logger.log(
      `EarnPointsRequested enqueued: grantId=${params.grantId}, reviewId=${params.reviewId}, amount=${params.amount}`,
    );
  }

  async enqueueCancelPointsCommand(
    params: { grantId: string; reviewId: string; userId: string; reasonCode: string },
    tx: UgcTx,
  ): Promise<void> {
    await this.publisher.enqueue(
      {
        eventType: 'CancelReviewPointsRequested',
        aggregateId: params.reviewId,
        idempotencyKey: `review-grant-cancel:${params.grantId}`,
        payload: {
          grantId: params.grantId,
          reviewId: params.reviewId,
          userId: params.userId,
          reasonCode: params.reasonCode,
          requestedAt: new Date().toISOString(),
        },
      },
      tx,
    );

    this.logger.log(`CancelReviewPointsRequested enqueued: grantId=${params.grantId}, reviewId=${params.reviewId}`);
  }
}
