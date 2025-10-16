import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { DbModule } from '@app/db';
import { membershipSchema } from './shared/schemas/entities/schema';
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
import { BenefitTrackingService } from './services/benefit-tracking.service';
import { ContractEventService } from './services/contract-event.service';
import { SubscriptionCancellationService } from './services/subscription-cancellation.service';
import { SubscriptionContractReader } from './services/subscription/subscription-contract.reader';
import { SubscriptionCancellationManager } from './services/subscription/subscription-cancellation.manager';
import { CancellationReasonReader } from './services/subscription/cancellation-reason.reader';
import { SubscriptionCreator } from './services/subscription/subscription.creator';
import { SubscriptionManager } from './services/subscription/subscription.manager';
import { EntitlementReader } from './services/entitlement/entitlement.reader';
import { EntitlementManager } from './services/entitlement/entitlement.manager';
import { PauseReader } from './services/pause/pause.reader';
import { PauseManager } from './services/pause/pause.manager';
import { PlanReader } from './services/plan/plan.reader';
import { PlanManager } from './services/plan/plan.manager';
import { BillingController } from './controllers/billing.controller';
import { AdminOperationsController } from './controllers/admin-operations.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { PlanController } from './controllers/plan.controller';
import { PauseController } from './controllers/pause.controller';
import { BenefitTrackingController } from './controllers/benefit-tracking.controller';

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
      schema: { ...membershipSchema },
    }),
  ],
  controllers: [
    BillingController,
    AdminOperationsController,
    SubscriptionController,
    PlanController,
    PauseController,
    BenefitTrackingController,
  ],
  providers: [
    // Business Layer (Services)
    PlanService,
    AdminOperationsService,
    PauseService,
    SubscriptionService,
    RecurringBillingService,
    BenefitTrackingService,
    SubscriptionCancellationService,

    // Implementation Layer (Readers & Managers)
    EntitlementReader,
    EntitlementManager,
    PolicyValidationService,
    ContractEventService,
    SubscriptionContractReader,
    SubscriptionCreator,
    SubscriptionManager,
    SubscriptionCancellationManager,
    CancellationReasonReader,
    PauseReader,
    PauseManager,
    PlanReader,
    PlanManager,

    // Infrastructure
    PolicyGuard,
    PaymentClientService,
  ],
})
export class AppModule {}
