import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher } from '@app/events';
import { StreamPublisher } from '@app/events';
import type { UgcCommandEvents } from '@packages/event-contracts/streams';

@Injectable()
export class ReviewRewardPublisher {
  private readonly logger = new Logger(ReviewRewardPublisher.name);

  constructor(
    @InjectStreamPublisher('ugc.commands.v1')
    private readonly publisher: StreamPublisher<UgcCommandEvents>,
  ) {}

  async publishEarnPointsCommand(params: {
    reviewId: string;
    userId: string;
    reviewType: 'TEXT' | 'PHOTO';
    amount: number;
    productId: string;
  }): Promise<void> {
    await this.publisher.publishCommand({
      commandType: 'EarnPointsRequested',
      aggregateId: params.reviewId,
      payload: {
        reviewId: params.reviewId,
        userId: params.userId,
        reviewType: params.reviewType,
        amount: params.amount,
        reasonCode: `review-reward:${params.reviewType.toLowerCase()}`,
        productId: params.productId,
        requestedAt: new Date().toISOString(),
      },
    });

    this.logger.log(
      `EarnPointsRequested published: reviewId=${params.reviewId}, type=${params.reviewType}, amount=${params.amount}`,
    );
  }
}
