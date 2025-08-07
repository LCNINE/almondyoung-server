import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PolicyManagementModule } from '../policy-management/policy-management.module';
import { EntitlementService } from './entitlement.service';
import { DevAuthGuard } from '../auth/dev-auth.guard';

/**
 * 구독 관리 모듈
 */
@Module({
  imports: [EventsModule, PolicyManagementModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, EntitlementService, DevAuthGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
