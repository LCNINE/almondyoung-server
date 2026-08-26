import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { UGC_COMMAND_STREAM, UGC_EVENT_STREAM } from '@packages/event-contracts/streams';
import { ReviewEligibilityController } from './controllers/review-eligibility.controller';
import { ReviewsController } from './controllers/reviews.controller';
import { ReviewStatisticsController } from './controllers/review-statistics.controller';
import { RewardPolicyController } from './controllers/reward-policy.controller';
import { ReviewEligibilityService } from './services/review-eligibility.service';
import { ReviewStatisticsService } from './services/review-statistics.service';
import { ReviewsService } from './services/reviews.service';
import { ReviewRewardPolicyService } from './services/review-reward-policy.service';
import { ReviewRewardPublisher } from './services/review-reward-publisher.service';
import { ReviewStatsPublisher } from './services/review-stats-publisher.service';

@Module({
  imports: [
    EventsModule.forApp({
      publishes: [UGC_COMMAND_STREAM, UGC_EVENT_STREAM],
      serviceName: 'ugc-service',
    }),
  ],
  controllers: [ReviewEligibilityController, ReviewsController, ReviewStatisticsController, RewardPolicyController],
  providers: [
    ReviewEligibilityService,
    ReviewStatisticsService,
    ReviewsService,
    ReviewRewardPolicyService,
    ReviewRewardPublisher,
    ReviewStatsPublisher,
  ],
})
export class ReviewsModule {}
