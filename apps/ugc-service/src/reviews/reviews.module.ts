import { Module } from '@nestjs/common';
import { ReviewsController } from './controllers/reviews.controller';
import { ReviewStatisticsController } from './controllers/review-statistics.controller';
import { RewardPolicyController } from './controllers/reward-policy.controller';
import { ReviewStatisticsService } from './services/review-statistics.service';
import { ReviewsService } from './services/reviews.service';
import { ReviewRewardGrantService } from './rewards/review-reward-grant.service';
import { ReviewRewardRuleService } from './rewards/review-reward-rule.service';
import { ReviewBestSelectionService } from './rewards/review-best-selection.service';
import { ReviewBestSelectionCron } from './rewards/review-best-selection.cron';
import { AdminRewardController } from './rewards/admin-reward.controller';
import { ReviewRewardPublisher } from './services/review-reward-publisher.service';
import { ReviewRewardManager } from './rewards/review-reward.manager';
import { OrderCancellationConsumer } from './rewards/order-cancellation.consumer';
import { ReviewStatsPublisher } from './services/review-stats-publisher.service';
import { ReviewPermissionsModule } from '../review-permissions/review-permissions.module';
import { UgcEventsModule } from '../ugc-events.module';

@Module({
  imports: [UgcEventsModule, ReviewPermissionsModule],
  controllers: [
    ReviewsController,
    ReviewStatisticsController,
    RewardPolicyController,
    AdminRewardController,
    OrderCancellationConsumer,
  ],
  providers: [
    ReviewStatisticsService,
    ReviewsService,
    ReviewRewardRuleService,
    ReviewRewardGrantService,
    ReviewRewardManager,
    ReviewBestSelectionService,
    ReviewBestSelectionCron,
    ReviewRewardPublisher,
    ReviewStatsPublisher,
  ],
})
export class ReviewsModule {}
