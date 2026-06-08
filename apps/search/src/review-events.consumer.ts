import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, OnEvent } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { ProductReviewStatsChangedPayload } from '@packages/event-contracts/streams/ugc.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { ProductIndexService } from './product-index.service';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ReviewEventsConsumer {
  private readonly logger = new Logger(ReviewEventsConsumer.name);

  constructor(private readonly productIndexService: ProductIndexService) {}

  @OnEvent('ugc.events.v1', 'ProductReviewStatsChanged')
  async onProductReviewStatsChanged(
    @EventEnvelope() envelope: DomainEvent<ProductReviewStatsChangedPayload>,
    @EventPayload() payload: ProductReviewStatsChangedPayload,
  ): Promise<void> {
    this.logger.log(
      `ProductReviewStatsChanged: productId=${payload.productId} reviewCount=${payload.reviewCount} bayesianScore=${payload.bayesianReviewScore} (${envelope.messageId})`,
    );

    try {
      await this.productIndexService.updateProductReviewStats(payload.productId, {
        review_count: payload.reviewCount,
        average_rating: payload.averageRating,
        bayesian_review_score: payload.bayesianReviewScore,
        review_stats_updated_at: payload.changedAt,
      });
      this.logger.debug(`Review stats indexed: productId=${payload.productId} (${envelope.messageId})`);
    } catch (error) {
      this.logger.error(
        `Failed to index review stats for productId=${payload.productId} (${envelope.messageId}): ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
