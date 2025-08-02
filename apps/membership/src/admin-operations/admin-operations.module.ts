import { Module } from '@nestjs/common';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { PlanModule } from '../plan/plan.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { EventsModule } from '@app/events';

/**
 * 관리자 운영 모듈
 * 플랜 및 티어 관리를 위한 오케스트레이션 모듈
 */
@Module({
  imports: [PlanModule, SubscriptionModule, EventsModule],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
  exports: [AdminOperationsService],
})
export class AdminOperationsModule {}
