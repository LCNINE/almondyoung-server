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
import { ReviewRewardGrantService } from './rewards/review-reward-grant.service';
import { ReviewRewardRuleService } from './rewards/review-reward-rule.service';
import { ReviewBestSelectionService } from './rewards/review-best-selection.service';
import { ReviewBestSelectionCron } from './rewards/review-best-selection.cron';
import { AdminRewardController } from './rewards/admin-reward.controller';
import { ReviewRewardPublisher } from './services/review-reward-publisher.service';
import { ReviewRewardReader } from './rewards/review-reward.reader';
import { ReviewRewardManager } from './rewards/review-reward.manager';
import { OrderCancellationConsumer } from './rewards/order-cancellation.consumer';
import { ReviewStatsPublisher } from './services/review-stats-publisher.service';

@Module({
  imports: [
    EventsModule.forApp({
      publishes: [UGC_COMMAND_STREAM, UGC_EVENT_STREAM],
      serviceName: 'ugc-service',
      // 소비 검증 정책은 앱 전체에 하나. 다른 소비 앱과 같은 값이다.
      policy: { validateOnConsume: true },
      // 적립 명령은 리뷰 트랜잭션과 같이 커밋돼야 한다 — 원장엔 지급인데 명령만 사라지는 창을 없앤다.
      enableOutbox: true,
    }),
  ],
  controllers: [
    ReviewEligibilityController,
    ReviewsController,
    ReviewStatisticsController,
    RewardPolicyController,
    AdminRewardController,
    OrderCancellationConsumer,
  ],
  providers: [
    ReviewEligibilityService,
    ReviewStatisticsService,
    ReviewsService,
    ReviewRewardRuleService,
    ReviewRewardGrantService,
    ReviewRewardReader,
    ReviewRewardManager,
    ReviewBestSelectionService,
    ReviewBestSelectionCron,
    ReviewRewardPublisher,
    ReviewStatsPublisher,
  ],
})
export class ReviewsModule {}
