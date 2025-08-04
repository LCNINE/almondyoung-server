import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
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
import * as schema  from './shared/schemas/entities/schema'
import { ConfigModule } from '@nestjs/config';
import { EventsModule } from '@app/events';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 ConfigService를 바로 사용할 수 있도록 설정
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    SubscriptionModule,
    PlanModule,
    AdminOperationsModule,
    PauseModule,
    RightsModule,
    PolicyManagementModule,
    RightsModule,
    EventsModule,
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL || 'postgresql://localhost:5432/almondyoung',
      },
      schema: { ...schema },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe, // 🔥 글로벌 Zod 검증 파이프
    },
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
