import { Module } from '@nestjs/common';

import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { EntitlementService } from './entitlement.service';
import { DevAuthGuard } from '../auth/dev-auth.guard';
import { PolicyManagementModule } from '../policy-management/policy-management.module';
import { PlanModule } from '../plan/plan.module';

/**
 * 구독 관리 모듈
 */
@Module({
  imports: [ PolicyManagementModule, PlanModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, EntitlementService, DevAuthGuard],
  exports: [SubscriptionService, EntitlementService],
})
export class SubscriptionModule {}
