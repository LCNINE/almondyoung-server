import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { DbModule } from '@app/db';
import * as schema from './shared/schemas/entities/schema';
import { ConfigModule } from '@nestjs/config';
import { DevAuthModule } from './auth/dev-auth-module';
import { PlanService } from './services/plan.service';
import { AdminOperationsService } from './services/admin-operations.service';
import { PauseService } from './services/pause.service';
import { EntitlementService } from './services/entitlement.service';
import { PolicyValidationService } from './services/policy-validation.service';
import { PolicyGuard } from './services/policy/policy.guard';
import { SubscriptionService } from './services/subscription.service';
import { PaymentClientService } from './services/billing/payment-client.service';
import { RecurringBillingService } from './services/billing/recurring-billing.service';
import { BillingController } from './controllers/billing.controller';
import { AdminOperationsController } from './controllers/admin-operations.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { PlanController } from './controllers/plan.controller';
import { PauseController } from './controllers/pause.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    HttpModule,
    DevAuthModule,
    DbModule.forRoot({
      config: {
        connectionString:
          'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema }, // 여기도 원래 의도한 spread로 수정 필요. :contentReference[oaicite:13]{index=13}
    }),
  ],
  controllers: [
    BillingController,
    AdminOperationsController,
    SubscriptionController,
    PlanController,
    PauseController,
  ],
  providers: [
    PlanService,
    AdminOperationsService,
    PauseService,
    EntitlementService,
    PolicyValidationService,
    PolicyGuard,
    SubscriptionService,
    PaymentClientService,
    RecurringBillingService,
  ],
})
export class AppModule {}
