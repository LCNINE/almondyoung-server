import { Module } from '@nestjs/common';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { PlanModule } from '../plan/plan.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PolicyManagementModule } from '../policy-management/policy-management.module';

/**
 * 관리자 운영 모듈
 * 플랜, 티어, 정책 관리를 위한 통합 관리자 모듈
 */
@Module({
  imports: [PlanModule, SubscriptionModule, PolicyManagementModule],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
  exports: [AdminOperationsService],
})
export class AdminOperationsModule {}
