import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SubscriptionModule } from './subscription/subscription.module';
import { PlanModule } from './plan/plan.module';
import { AdminOperationsModule } from './admin-operations/admin-operations.module';
import { PauseModule } from './pause-resume/pause.module';
import { BillingModule } from './billing/billing.module';
import { PolicyManagementModule } from './policy-management/policy-management.module';
// import { APP_FILTER } from '@nestjs/core';
// import {
//   // SubscriptionExceptionFilter,og
//   HttpExceptionFilter,
//   GlobalExceptionFilter,
// } from './shared/filters/subscription-exception.filter';
import { DbModule } from '@app/db';
import * as schema from './shared/schemas/entities/schema';
import { ConfigModule } from '@nestjs/config';

import { DevAuthModule } from './auth/dev-auth-module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    DevAuthModule,
    SubscriptionModule,
    PlanModule,
    AdminOperationsModule,
    PauseModule,
    BillingModule,
    PolicyManagementModule,

    DbModule.forRoot({
      config: {
        connectionString:
          'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema }, // 여기도 원래 의도한 spread로 수정 필요. :contentReference[oaicite:13]{index=13}
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // {
    //   provide: APP_FILTER,
    //   useClass: SubscriptionExceptionFilter,
    // },
    // {
    //   provide: APP_FILTER,
    //   useClass: HttpExceptionFilter,
    // },
    // {
    //   provide: APP_FILTER,
    //   useClass: GlobalExceptionFilter,
    // },
  ],
})
export class AppModule {}
