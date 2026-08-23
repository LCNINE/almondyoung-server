import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { HttpModule } from '@nestjs/axios';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
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
import { CancellationContextReader } from './services/subscription/cancellation-context.reader';
import { AgreementCleanupService } from './services/subscription/agreement-cleanup.service';
import { RefundPolicyService } from './services/subscription/refund-policy.service';
import { RefundEventHandler } from './services/refund-event-handler.service';
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
import { InvoiceBillingManager } from './services/billing/invoice-billing.manager';
import { InvoiceOutcomeHandler } from './services/billing/invoice-outcome.handler';
import { InvoiceResultConsumer } from './consumers/invoice-result.consumer';
import { MembershipPolicyService } from './services/membership-policy.service';
import { SavingsService } from './services/savings/savings.service';
import { SavingsReader } from './services/savings/savings.reader';
import { MembershipEventPublisher } from './services/membership-event.publisher';
import { ExpiryNoticeService } from './services/renewal-notice/expiry-notice.service';
import { RenewalNoticeService } from './services/renewal-notice/renewal-notice.service';
import { UserContactClient } from './services/renewal-notice/user-contact.client';
import { AdminIdempotencyService } from './shared/idempotency/admin-idempotency.service';
import { AdminIdempotencyInterceptor } from './shared/idempotency/admin-idempotency.interceptor';
import { AuthorizationModule } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { MEMBERSHIP_ROLE_MAPPINGS, MEMBERSHIP_SCOPES } from './shared/auth/membership-scopes';
import { JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { InternalApiKeyGuard } from './shared/guards/internal-api-key.guard';
import { EventTraceController } from './controllers/event-trace.controller';

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
      // 부팅 시 auth.scopes / auth.role_scope_mapping 을 이 선언에 맞춰 정합화한다.
      scopes: MEMBERSHIP_SCOPES,
      roleMappings: MEMBERSHIP_ROLE_MAPPINGS,
    }),
    HttpModule,
    SCHEDULE_ROOT,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL || '',
      },
      schema: membershipSchema,
    }),
    // 발행 능력 + 소비 정책을 한 자리에서 선언한다. 옛 `forRoot`+`forConsumerModule`
    // 두 벌에서 합쳤다 — 소비 스트림 목록(`[PAYMENT_STREAM]`)과 groupId 는 쓰이지 않던
    // 선언이라 함께 사라졌다 (ADR-0029 §1·§3).
    EventsModule.forApp({
      publishes: [MEMBERSHIP_STREAM, WALLET_COMMAND_STREAM, PAYMENT_STREAM],
      serviceName: 'membership',
      enableDLQ: true,
      // 트랜잭셔널 아웃박스: 신규 구독 생성 시 MembershipStatusChanged 를 엔타이틀먼트와
      // 같은 트랜잭션에 기록하고, 디스패처가 재시도하며 Kafka 로 발행 — 실시간 발행 유실 방지.
      enableOutbox: true,
      // 소비 스키마 검증 ON (플랜 Task 5-C, 2026-08-10).
      //
      // 여기 `false` 는 이 앱의 의도가 아니라 #501 이 `forConsumerModule` 을 처음 붙이며 같이
      // 들어온 값이었다(근거 주석 없음 — notification 의 "HTTP 요청과 충돌 방지" 같은 판단이
      // 아니다). 5-C 논의에서 한동안 빠져 있었던 것도 그래서다.
      //
      // 이 앱을 막던 UNVERIFIED 5건은 원인이 달랐다 — core 카탈로그의 `saveEvent` 가 아니라
      // wallet 이 자기 아웃박스에 직접 insert 하던 `invoice.*`/`mandate.rejected` 행이었고,
      // 6-A 의 `publishStoredEnvelope` 문이 닫았다. 지금 10/10 (SAFE 5 · PROVEN 5).
      //
      // DLQ 메트릭은 스크레이프되지 않는다(`dlq.metrics.ts:10`) — 관측은 로그다.
      //
      // 되돌리기는 이 한 줄을 `false` 로 바꾸는 것이다.
      // 현황: `npm run audit:consume-validation -- membership`
      policy: { validateOnConsume: true },
    }),
    EventTraceApiModule,
  ],
  controllers: [
    EventTraceController,
    BillingResultConsumer,
    InvoiceResultConsumer,
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
    // @RequireScopes 가 붙은 라우트만 검사한다(메타데이터 없으면 통과).
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,
    },
    InternalApiKeyGuard,
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
    // 자동갱신 결제 사전 고지 (전자상거래법 계속거래 고지)
    RenewalNoticeService,
    ExpiryNoticeService,
    UserContactClient,

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
    CancellationContextReader,
    // 해지 시 실패한 자동이체 약정 종료를 이어서 끝낸다(은행에 약정이 남지 않게).
    AgreementCleanupService,

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
    // ADR-0027 인보이스(선적용) 경로
    InvoiceBillingManager,
    InvoiceOutcomeHandler,
    // Policy Layer (하드코딩 테이블)
    MembershipPolicyService,
    // 해지·환불 정책 (연간 정산 / 청약철회 창)
    RefundPolicyService,
    RefundEventHandler,
    // Infrastructure
    PaymentClientService,
    MembershipEventPublisher,
    WalletCommandPublisher,
    WelcomeMembershipService,
    // 관리자 운영 액션 멱등성
    AdminIdempotencyService,
    AdminIdempotencyInterceptor,
  ],
})
export class AppModule {}
