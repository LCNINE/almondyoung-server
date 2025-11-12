import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DbModule } from '@app/db';
import { membershipSchema } from './shared/schemas/entities/schema';
import { ConfigModule } from '@nestjs/config';
import { validateMembershipEnv } from './config/env.validation';
import { PlanService } from './services/plan.service';
import { AdminOperationsService } from './services/admin-operations.service';
import { PauseService } from './services/pause.service';
import { EntitlementService } from './services/entitlement.service';
import { SubscriptionService } from './services/subscription.service';
import { PaymentClientService } from './services/billing/payment-client.service';
import { RecurringBillingService } from './services/billing/recurring-billing.service';
import { BenefitTrackingService } from './services/benefit-tracking.service';
import { ContractEventManager } from './services/subscription/contract-event.manager';
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
import { BenefitReader } from './services/benefit/benefit.reader';
import { BenefitManager } from './services/benefit/benefit.manager';
import { BillingController } from './controllers/billing.controller';
import { AdminOperationsController } from './controllers/admin-operations.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { PlanController } from './controllers/plan.controller';
import { PauseController } from './controllers/pause.controller';
import { BenefitTrackingController } from './controllers/benefit-tracking.controller';
import { BillingManager } from './services/billing/billing.manager';
import { BillingReader } from './services/billing/billing.reader';
import { MembershipPolicyService } from './services/membership-policy.service';
import { AuthCoreModule } from '../../../libs/auth-core/src';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateMembershipEnv,
      envFilePath: ['apps/membership/.env', '.env'], // membership .env 우선, 루트 .env는 fallback
      expandVariables: true,
    }),
    AuthCoreModule.forRootAsync(),
    HttpModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL || '',
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
    // Auth
    // Business Layer (Services)
    PlanService,
    AdminOperationsService,
    PauseService,
    SubscriptionService,
    RecurringBillingService,
    BenefitTrackingService,
    SubscriptionCancellationService,
    EntitlementService,
    // Implementation Layer (Readers & Managers)
    EntitlementReader,
    EntitlementManager,
    ContractEventManager,
    SubscriptionContractReader,
    SubscriptionCreator,
    SubscriptionManager,
    SubscriptionCancellationManager,
    CancellationReasonReader,

    PauseReader,
    PauseManager,
    PlanReader,
    PlanManager,
    BenefitReader,
    BenefitManager,
    BillingManager,
    RecurringBillingService,
    BillingReader,
    // Policy Layer (하드코딩 테이블)
    MembershipPolicyService,
    // Infrastructure
    PaymentClientService,
  ],
})
export class AppModule { }
