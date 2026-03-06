import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { ReviewEligibilityController } from './controllers/review-eligibility.controller';
import { ReviewsController } from './controllers/reviews.controller';
import { RewardPolicyController } from './controllers/reward-policy.controller';
import { ReviewEligibilityService } from './services/review-eligibility.service';
import { ReviewsService } from './services/reviews.service';
import { ReviewRewardPolicyService } from './services/review-reward-policy.service';
import { ReviewRewardPublisher } from './services/review-reward-publisher.service';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [UGC_COMMAND_STREAM],
      serviceName: 'ugc-service',
    }),
  ],
  controllers: [ReviewEligibilityController, ReviewsController, RewardPolicyController],
  providers: [ReviewEligibilityService, ReviewsService, ReviewRewardPolicyService, ReviewRewardPublisher],
})
export class ReviewsModule {}
