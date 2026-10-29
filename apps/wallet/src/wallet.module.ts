import { Module } from '@nestjs/common';
import {
  AUTH_CONFIG,
  AuthenticationService,
  JwtAccessStrategy,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
  piiMaskingProviders,
} from '@app/authorization';
import { OutboxPiiAccessRecorder } from '@app/authorization/recorders/outbox-pii-access.recorder';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { UserContactClient } from '@app/shared';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { EventsModule, EventTraceApiModule } from '@app/events';
import { PAYMENT_STREAM, IAM_STREAM } from '@packages/event-contracts/streams';
import { WALLET_OUTBOX_CONFIG } from './messaging/wallet-outbox.config';
import { validateWalletEnv } from './config/env';
import { HealthController } from './health.controller';
import { walletSchema } from './schema';

// Domain
import { StateTransitionService } from './domain/state-transition/state-transition.service';
import { DrizzleIdempotencyRepository, IDEMPOTENCY_REPOSITORY } from './domain/idempotency/idempotency.repository';
import { IdempotencyService } from './domain/idempotency/idempotency.service';
import { HttpIdempotencyInterceptor } from './domain/idempotency/http-idempotency.interceptor';

// Providers
import { PointsPaymentProvider } from './providers/points/points.provider';
import { PointsLedgerService } from './providers/points/points-ledger.service';
import { TossApiClient } from './providers/toss/toss-api.client';
import { TossPaymentProvider } from './providers/toss/toss.provider';
import { BankTransferPaymentProvider } from './providers/bank-transfer/bank-transfer.provider';
import { ProviderRegistry } from './providers/provider.registry';

// Methods
import { PaymentMethodsService } from './payment-methods/payment-methods.service';
import { PaymentMethodsController } from './payment-methods/payment-methods.controller';

// Charges
import { ChargesService } from './charges/charges.service';

// Intents
import { PaymentIntentsService } from './payment-intents/payment-intents.service';
import { PaymentIntentsController } from './payment-intents/payment-intents.controller';
import { ConfirmService } from './payment-intents/confirm.service';
import { CaptureService } from './payment-intents/capture.service';
import { AutoCaptureService } from './payment-intents/auto-capture.service';
import { CancelService } from './payment-intents/cancel.service';
import { ChargeReleaseService } from './payment-intents/charge-release.service';
import { AbandonService } from './payment-intents/abandon.service';
import { TossApproveService } from './payment-intents/toss-approve.service';
import { DeferredApprovalService } from './payment-intents/deferred-approval.service';

// Refunds
import { RefundsService } from './refunds/refunds.service';
import { RefundsController } from './refunds/refunds.controller';
import { RefundRequestsService } from './refunds/refund-requests.service';
import { CoreDigitalGuardClient } from './refunds/core-digital-guard.client';
import { RefundRequestsController } from './refunds/refund-requests.controller';
import { RefundRequestsAdminController } from './admin/refund-requests-admin.controller';

// Cash receipts (현금영수증)
import { CashReceiptsService } from './cash-receipts/cash-receipts.service';
import { CashReceiptsController } from './cash-receipts/cash-receipts.controller';
import { CashReceiptsAdminController } from './admin/cash-receipts-admin.controller';

// Admin
import { PointsAdminService } from './admin/points-admin.service';
import { PointsAdminController } from './admin/points-admin.controller';
import { PaymentIntentAdminService } from './admin/payment-intent-admin.service';
import { PaymentIntentAdminController } from './admin/payment-intent-admin.controller';
import { RefundAdminController } from './admin/refund-admin.controller';

// Payment config (catalog + regions)
import { PaymentConfigService } from './payment-config/payment-config.service';
import { PaymentConfigAdminController } from './payment-config/payment-config-admin.controller';
import { PaymentConfigController } from './payment-config/payment-config.controller';

// Points (user-facing)
import { PointsController } from './points/points.controller';
import { BankTransferAdminService } from './admin/bank-transfer-admin.service';
import { RecurringBillingAdminService } from './admin/recurring-billing-admin.service';
import { RecurringBillingFinanceReader } from './admin/recurring-billing-finance.reader';
import { RecurringBillingAdminController } from './admin/recurring-billing-admin.controller';
import { StatisticsAdminService } from './admin/statistics-admin.service';
import { StatisticsAdminController } from './admin/statistics-admin.controller';

// Messaging + Jobs
import { ExpirationJob } from './jobs/expiration.job';
import { TossActionExpirationJob } from './jobs/toss-action-expiration.job';
import { PointsExpirationJob } from './jobs/points-expiration.job';
import { RefundResendJob } from './refunds/refund-resend.job';

// Webhooks
import { TossWebhookController } from './webhooks/toss-webhook.controller';
import { TossWebhookService } from './webhooks/toss-webhook.service';
import { TossWebhookRepository } from './webhooks/toss-webhook.repository';

// Billing
import { BillingMethodService } from './billing/billing-method.service';
import { BillingMethodController } from './billing/billing-method.controller';
import { BillingAgreementService } from './billing/billing-agreement.service';
import { BillingAgreementController } from './billing/billing-agreement.controller';
import { DirectBillingChargeService } from './billing/direct-billing-charge.service';
import { DirectBillingChargeController } from './billing/direct-billing-charge.controller';

// Checkout
import { CheckoutSessionService } from './checkout/checkout-session.service';
import { CheckoutSessionController } from './checkout/checkout-session.controller';
import { CheckoutSessionExpirationService } from './checkout/checkout-session-expiration.service';

// CMS
import { CmsApiClient } from './cms/cms-api.client';
import { CmsMemberService } from './cms/cms-member.service';
import { CmsMemberPollerService } from './cms/cms-member-poller.service';
import { CmsAgreementService } from './cms/cms-agreement.service';
import { CmsAgreementController } from './cms/cms-agreement.controller';
import { CmsRegistrationService } from './cms/cms-registration.service';
import { CmsAccountCheckService } from './cms/cms-account-check.service';
import { CmsBatchProvider } from './cms/cms-batch.provider';
import { CmsSettlementPollerService } from './cms/cms-settlement-poller.service';

// Invoices (ADR-0027 — 인보이스 기반 정기결제)
import { InvoiceOutcomeService } from './invoices/invoice-outcome.service';
import { InvoiceExecutorService } from './invoices/invoice-executor.service';
import { InvoiceCommandConsumer } from './invoices/invoice-command.consumer';
import { InvoiceController } from './invoices/invoice.controller';
import { MyInvoiceController } from './invoices/my-invoice.controller';
import { InvoiceQueryService } from './invoices/invoice-query.service';

// Dev helpers (dev/test only — ENABLE_DEV_CMS_HELPERS=true + NODE_ENV !== 'production')
import { CmsDevController } from './dev/cms-dev.controller';
import { CmsDevStateService } from './dev/cms-dev-state.service';

const devHelpersEnabled = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_CMS_HELPERS === 'true';

// Consumers
import { UgcCommandConsumer } from './consumers/ugc-command.consumer';
import { BillingChargeConsumer } from './consumers/billing-charge.consumer';
import { EventTraceController } from './admin/event-trace.controller';
import { WalletAuthGuard } from './wallet-auth.guard';
import { TenancyModule } from '@app/tenancy';

export { WALLET_JWT_AUTH_KEY, WalletJwtAuth } from './wallet-auth.decorator';

export { AuthenticatedRequest, WalletAuthGuard } from './wallet-auth.guard';

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWalletEnv,
      envFilePath: ['.env', 'apps/wallet/.env'],
    }),
    // 테넌트 목록·전환 모드. 틀리면 여기서 기동 거부 (@app/tenancy).
    TenancyModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    PermissionModule.forRoot({ service: 'wallet' }),
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: walletSchema,
    }),
    SCHEDULE_ROOT,
    CronOnceModule,
    // 발행 능력 + 소비 정책을 한 자리에서. 옛 `forRoot`+`forConsumerModule` 두 벌에서
    // 합쳤다 — 소비 스트림 목록과 groupId 는 쓰이지 않던 선언이라 사라졌다 (ADR-0029 §1).
    EventsModule.forApp({
      publishes: [PAYMENT_STREAM, IAM_STREAM],
      // 공용 아웃박스를 켠다 (ADR-0029 §5-1, Task 6-C-3). `OutboxPublisher`(적재기)와
      // `OutboxDispatcher`(발행기)가 등록되고, `PAYMENT_STREAM` 이 위 목록에 있으므로
      // 디스패처의 publisherMap 이 회수 대상 토픽을 처음부터 안다.
      enableOutbox: true,
      outbox: WALLET_OUTBOX_CONFIG,
      policy: { validateOnConsume: true },
    }),
    EventTraceApiModule,
    // CMS 심사 거절 통지가 user-service 에서 수신자 이메일을 조회한다.
    HttpModule,
  ],
  controllers: [
    HealthController,
    EventTraceController,
    PaymentIntentsController,
    PaymentMethodsController,
    RefundsController,
    RefundRequestsController,
    RefundRequestsAdminController,
    CashReceiptsController,
    CashReceiptsAdminController,
    PointsAdminController,
    PaymentIntentAdminController,
    RefundAdminController,
    PaymentConfigAdminController,
    PaymentConfigController,
    PointsController,
    TossWebhookController,
    BillingMethodController,
    BillingAgreementController,
    DirectBillingChargeController,
    CheckoutSessionController,
    CmsAgreementController,
    RecurringBillingAdminController,
    StatisticsAdminController,
    InvoiceController,
    MyInvoiceController,
    UgcCommandConsumer,
    BillingChargeConsumer,
    InvoiceCommandConsumer,
    ...(devHelpersEnabled ? [CmsDevController] : []),
  ],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => {
        // dual-mode 지원: USER_JWT_SECRET (HS256 legacy) 또는 OIDC_ISSUER_URL (RS256/OIDC).
        // 둘 중 하나는 반드시 있어야 한다. 공용 라이브러리(libs/authorization) 의 provider 와 동일 정책.
        const secret = process.env.USER_JWT_SECRET;
        const issuerUrl = process.env.OIDC_ISSUER_URL;
        const allowedAud = process.env.ALLOWED_AUDIENCES;

        if (!secret && !issuerUrl) {
          throw new Error(
            'Either USER_JWT_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be defined in environment variables',
          );
        }

        const normalizedIssuer = issuerUrl?.replace(/\/$/, '');

        return {
          secret,
          issuer: process.env.JWT_ISSUER ?? 'almondyoung-auth',
          audience: process.env.JWT_AUDIENCE ?? 'almondyoung',
          jwksUri: normalizedIssuer ? `${normalizedIssuer}/.well-known/jwks.json` : undefined,
          oidcIssuer: normalizedIssuer,
          allowedAudiences: allowedAud
            ? allowedAud
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        };
      },
    },
    AuthenticationService,
    JwtAccessStrategy,
    JwtAuthGuard,

    // Guards & interceptors
    { provide: APP_GUARD, useClass: WalletAuthGuard },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 개인정보 표시 제한 — 다른 응답 인터셉터보다 바깥에서 최종 본문을 본다.
    ...piiMaskingProviders({ service: 'wallet', recorder: OutboxPiiAccessRecorder }),
    { provide: APP_INTERCEPTOR, useClass: HttpIdempotencyInterceptor },

    // Domain
    StateTransitionService,
    IdempotencyService,
    { provide: IDEMPOTENCY_REPOSITORY, useClass: DrizzleIdempotencyRepository },

    // Providers
    PointsLedgerService,
    PointsPaymentProvider,
    TossApiClient,
    TossPaymentProvider,
    BankTransferPaymentProvider,
    ProviderRegistry,

    // Methods / Charges
    PaymentMethodsService,
    PaymentConfigService,
    ChargesService,

    // Intents
    PaymentIntentsService,
    ConfirmService,
    CaptureService,
    AutoCaptureService,
    CancelService,
    ChargeReleaseService,
    AbandonService,
    TossApproveService,
    DeferredApprovalService,

    // Refunds
    RefundsService,
    RefundRequestsService,
    CoreDigitalGuardClient,

    // Cash receipts (현금영수증)
    CashReceiptsService,

    // Admin
    PointsAdminService,
    BankTransferAdminService,
    PaymentIntentAdminService,
    RecurringBillingAdminService,
    RecurringBillingFinanceReader,
    StatisticsAdminService,

    // Billing
    BillingMethodService,
    BillingAgreementService,
    DirectBillingChargeService,

    // Checkout
    CheckoutSessionService,
    CheckoutSessionExpirationService,

    // CMS
    CmsApiClient,
    CmsMemberService,
    CmsMemberPollerService,
    CmsAgreementService,
    CmsRegistrationService,
    CmsAccountCheckService,
    CmsBatchProvider,
    CmsSettlementPollerService,
    UserContactClient,

    // Invoices (ADR-0027)
    InvoiceOutcomeService,
    InvoiceQueryService,
    InvoiceExecutorService,

    // Dev helpers (conditional — only when ENABLE_DEV_CMS_HELPERS=true + non-production)
    ...(devHelpersEnabled ? [CmsDevStateService] : []),

    // Webhooks
    TossWebhookService,
    TossWebhookRepository,

    // Messaging + Jobs
    ExpirationJob,
    TossActionExpirationJob,
    PointsExpirationJob,
    RefundResendJob,
  ],
})
export class WalletModule {}
