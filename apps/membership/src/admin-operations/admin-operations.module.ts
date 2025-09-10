import { Module } from '@nestjs/common';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { PlanModule } from '../plan/plan.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PolicyManagementModule } from '../policy-management/policy-management.module';
import { BillingModule } from '../billing/billing.module';

/**
 * 관리자 운영 모듈
 * 각 기능별 모듈을 import하여 AdminOperationsService가
 * 모든 하위 서비스를 사용할 수 있도록 구성합니다.
 */
@Module({
  imports: [PlanModule, SubscriptionModule, PolicyManagementModule, BillingModule],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
  exports: [AdminOperationsService],
})
export class AdminOperationsModule {}
