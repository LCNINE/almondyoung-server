import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import type { RatingDistribution, UgcDomainEvents } from '@packages/event-contracts/streams';

@Injectable()
export class ReviewStatsPublisher {
  private readonly logger = new Logger(ReviewStatsPublisher.name);

  constructor(
    @InjectStreamPublisher('ugc.events.v1')
    private readonly publisher: StreamPublisher<UgcDomainEvents>,
  ) {}

  async publishProductReviewStatsChanged(params: {
    productId: string;
    reviewCount: number;
    ratingSum: number;
    averageRating: number;
    bayesianReviewScore: number;
    ratingDistribution: RatingDistribution;
  }): Promise<void> {
    await this.publisher.publishEvent({
      eventType: 'ProductReviewStatsChanged',
      aggregateId: params.productId,
      payload: {
        ...params,
        changedAt: new Date().toISOString(),
      },
    });

    this.logger.log(
      `ProductReviewStatsChanged published: productId=${params.productId}, count=${params.reviewCount}, bayesian=${params.bayesianReviewScore}`,
    );
  }
}
