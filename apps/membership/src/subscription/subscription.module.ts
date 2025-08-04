import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PolicyManagementModule } from '../policy-management/policy-management.module';
import * as schema from '../shared/schemas/entities/schema';

/**
 * 구독 관리 모듈
 */
@Module({
  imports: [EventsModule, PolicyManagementModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
