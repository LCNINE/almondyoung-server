import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { SubscriptionModule } from '../src/subscription/subscription.module';
import { PlanModule } from '../src/plan/plan.module';
import { AdminOperationsModule } from '../src/admin-operations/admin-operations.module';
import { PauseModule } from '../src/pause-resume/pause.module';
import { PolicyManagementModule } from '../src/policy-management/policy-management.module';
import { DbModule } from '@app/db';
import * as schema from '../src/shared/schemas/entities/schema';
import { DevAuthModule } from '../src/auth/dev-auth-module';

// 테스트용 AppModule - 스케줄러 제외
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'test'}`,
    }),
    DevAuthModule,
    SubscriptionModule,
    PlanModule,
    AdminOperationsModule,
    PauseModule,
    PolicyManagementModule,
    DbModule.forRoot({
      config: {
        connectionString:
          'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class TestAppModule {}
