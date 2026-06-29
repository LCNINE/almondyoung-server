import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { HttpModule } from '@nestjs/axios';
import { DbModule } from '@app/db';
import { EventsModule, EventTraceApiModule } from '@app/events';
import { MEMBERSHIP_STREAM, PAYMENT_STREAM } from '@packages/event-contracts/streams';
import { WALLET_COMMAND_STREAM } from '@packages/event-contracts/streams/wallet-command.stream';
import { BillingResultConsumer } from './consumers/billing-result.consumer';
import { MembershipCheckoutConsumer } from './consumers/membership-checkout.consumer';
import { MembershipRefundConsumer } from './consumers/membership-refund.consumer';
import { WalletCommandPublisher } from './services/billing/wallet-command.publisher';
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
import { AdminMembersReader } from './services/admin/admin-members.reader';
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
import { SavingsController } from './controllers/savings.controller';
import { WelcomeMembershipController } from './controllers/welcome-membership.controller';
import { HealthController } from './controllers/health.controller';
import { InternalMembershipController } from './controllers/internal-membership.controller';
import { WelcomeMembershipService } from './services/welcome-membership.service';
import { BillingManager } from './services/billing/billing.manager';
import { BillingReader } from './services/billing/billing.reader';
import { BillingOutcomeHandler } from './services/billing/billing-outcome.handler';
import { MembershipPolicyService } from './services/membership-policy.service';
import { SavingsService } from './services/savings/savings.service';
import { SavingsReader } from './services/savings/savings.reader';
import { MembershipEventPublisher } from './services/membership-event.publisher';
import { AuthorizationModule } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '@app/authorization';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateMembershipEnv,
      envFilePath: ['.env', 'apps/membership/.env'],
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'membership',
      scopes: [],
    }),
    HttpModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL || '',
      },
      schema: membershipSchema,
    }),
    EventsModule.forRoot({
      streams: [MEMBERSHIP_STREAM, WALLET_COMMAND_STREAM, PAYMENT_STREAM],
      serviceName: 'membership',
      enableDLQ: true,
    }),
    EventTraceApiModule,
  ],
  controllers: [
    BillingResultConsumer,
    MembershipCheckoutConsumer,
    MembershipRefundConsumer,
    BillingController,
    AdminOperationsController,
    SubscriptionController,
    PlanController,
    PauseController,
    BenefitTrackingController,
    SavingsController,
    WelcomeMembershipController,
    HealthController,
    InternalMembershipController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Business Layer (Services)
    PlanService,
    AdminOperationsService,
    PauseService,
    SubscriptionService,
    RecurringBillingService,
    BenefitTrackingService,
    SubscriptionCancellationService,
    EntitlementService,
    SavingsService,

    // Implementation Layer (Readers & Managers)
    EntitlementReader,
    EntitlementManager,
    AdminMembersReader,
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
    SavingsReader,
    BillingManager,
    BillingOutcomeHandler,
    RecurringBillingService,
    BillingReader,
    // Policy Layer (하드코딩 테이블)
    MembershipPolicyService,
    // Infrastructure
    PaymentClientService,
    MembershipEventPublisher,
    WalletCommandPublisher,
    WelcomeMembershipService,
  ],
})
export class AppModule {}
