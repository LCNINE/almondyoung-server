import { Module } from '@nestjs/common';
import { APP_PIPE, APP_FILTER } from '@nestjs/core';
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
import * as schema from './shared/schemas/entities/schema';
import { ConfigModule } from '@nestjs/config';
import { EventsModule } from '@app/events';
import { GlobalZodPipe } from './shared/pipes/global-zod.pipe';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    SubscriptionModule,
    PlanModule,
    AdminOperationsModule,
    PauseModule,
    RightsModule,
    PolicyManagementModule,
    EventsModule,
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
    {
      provide: APP_PIPE,
      useClass: GlobalZodPipe, // 기존 ZodValidationPipe 대신 이걸로
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
