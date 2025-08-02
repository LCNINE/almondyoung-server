import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SubscriptionModule } from './subscription/subscription.module';
import { PlanModule } from './plan/plan.module';
import { AdminOperationsModule } from './admin-operations/admin-operations.module';
import { PauseModule } from './pause-resume/pause.module';
import { RightsModule } from './rights/rights.module';
import { PolicyManagementModule } from './policy-management/policy-management.module';
import {
  SubscriptionExceptionFilter,
  HttpExceptionFilter,
  GlobalExceptionFilter,
} from './shared/filters/subscription-exception.filter';
import { DbModule } from '@app/db';

@Module({
  imports: [
    SubscriptionModule,
    PlanModule,
    AdminOperationsModule,
    PauseModule,
    RightsModule,
    PolicyManagementModule,
    DbModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: SubscriptionExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
