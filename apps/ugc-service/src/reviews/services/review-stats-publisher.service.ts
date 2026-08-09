import { Injectable, Logger } from '@nestjs/common';
import { InjectPublisher, PublisherFor } from '@app/events';
import { UGC_EVENT_STREAM, type RatingDistribution } from '@packages/event-contracts/streams';

@Injectable()
export class ReviewStatsPublisher {
  private readonly logger = new Logger(ReviewStatsPublisher.name);

  constructor(
    @InjectPublisher(UGC_EVENT_STREAM)
    private readonly publisher: PublisherFor<typeof UGC_EVENT_STREAM>,
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
