import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams';
// import { validateWalletEnv } from './config/env.validation';
import { AuthorizationModule, authorizationSchema, JwtAuthGuard } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { PaymentController } from './controllers/payment.controller';
import { BnplWithdrawalController } from './controllers/bnpl-withdrawal.controller';
import { PointController } from './controllers/point.controller';
import { PointAdminController } from './controllers/point-admin.controller';

import { IntentService } from './services/intents/intent.service';
import { IntentReader } from './services/intents/intent.reader';
import { IntentCreator } from './services/intents/intent.creator';
import { IntentManager } from './services/intents/intent.manager';
import { IntentRepository } from './services/intents/intent.repository';
import { PaymentProfileService } from './services/profiles/payment-profile.service';

import { walletSchema } from './shared/database/schema';

const combinedSchema = { ...walletSchema, ...authorizationSchema };
import { PaymentService } from './services/payment.service';
import { PaymentReader } from './services/payment/payment.reader';
import { PaymentManager } from './services/payment/payment.manager';
import { PaymentPointManager } from './services/payment/payment-point.manager';
import { PaymentProviderManager } from './services/payment/payment-provider.manager';
import { PaymentAttemptRepository } from './services/payment/payment-attempt.repository';
import { EphemeralPaymentStrategy } from './services/payment/strategies/ephemeral-payment.strategy';
import { StoredProfilePaymentStrategy } from './services/payment/strategies/stored-profile-payment.strategy';
import { PaymentStrategyFactory } from './services/payment/strategies/payment-strategy.factory';
import { BnplRepository } from './services/bnpl/bnpl.repository';
import { BnplSettlementService } from './services/bnpl/bnpl-settlement.service';
import { BnplBatchCreator } from './services/bnpl/bnpl-batch.creator';
import { BnplCmsManager } from './services/bnpl/bnpl-cms.manager';
import { BnplRetryManager } from './services/bnpl/bnpl-retry.manager';
import {
  CmsBatchProfilesRepository,
  CmsCardProfilesRepository,
  PaymentProfilesRepository,
} from './services/profiles/payment-profile.repository';
import { ProviderRegistry } from './providers/provider-registry';
import { HmsCardRegistrar } from './providers/hms-card.registrar';
import { HmsBnplRegistrar } from './providers/hms-bnpl.registrar';
import { HmsBatchCmsService } from './services/hms-batch-cms.service';
import { HmsCardChargeProvider } from './providers/hms-card.charge';
import { HmsBnplChargeProvider } from './providers/hms-bnpl.charge';
import { HmsBnplCashReceiptProvider } from './providers/hms-bnpl.cash-receipt';

import { TossChargeProvider } from './providers/toss.charge';
import { HmsCardRefundProvider } from './providers/hms-card.refund';
import { TossRefundProvider } from './providers/toss.refund';
import { IdempotencyService } from './services/idempotency.service';
import { BnplService } from './services/bnpl/bnpl.service';
import { BnplWithdrawalService } from './services/bnpl/bnpl-withdrawal.service';
import { BnplAccountReader } from './services/bnpl/bnpl-account.reader';
import { BnplAccountCreator } from './services/bnpl/bnpl-account.creator';
import { BnplCreditManager } from './services/bnpl/bnpl-credit.manager';
import { RefundService } from './services/refund.service';
import { PointService } from './services/points/point.service';
import { PointReader } from './services/points/point.reader';
import { PointManager } from './services/points/point.manager';
import { PointRepository } from './services/points/point.repository';
import { TaxInvoiceService } from './services/tax/tax-invoice.service';
import { TaxInvoiceAdminService } from './services/tax/tax-invoice-admin.service';
import { TaxInvoicePreferenceService } from './services/tax/tax-invoice-preference.service';
import { TaxInvoiceReader } from './services/tax/tax-invoice.reader';
import { TaxInvoiceCreator } from './services/tax/tax-invoice.creator';
import { TaxInvoiceManager } from './services/tax/tax-invoice.manager';
import { TaxInvoiceRepository } from './services/tax/tax-invoice.repository';
import { OmsClientMock } from './services/tax/oms-client.mock';
import { TaxInvoiceController } from './controllers/tax-invoice.controller';
import { TaxInvoiceAdminController } from './controllers/tax-invoice-admin.controller';
import { OutboxService } from './services/outbox/outbox.service';
import { OutboxDispatcherService } from './services/outbox/outbox-dispatcher.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/wallet/.env'],
      ignoreEnvFile: false,
      expandVariables: true,
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'wallet',
      scopes: [], // 필요시 실제 scopes 추가
    }),
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL || '',
      },
      schema: combinedSchema,
    }),
    EventsModule.forRoot({
      streams: [PAYMENT_STREAM],
      serviceName: process.env.SERVICE_NAME || 'wallet',
      enableDLQ: true,
      validation: {
        validateOnPublish: true,
        throwOnValidationError: true,
      },
    }),
  ],
  controllers: [
    // === 신규 아키텍처 ===
    PaymentController,
    BnplWithdrawalController,
    PointController,
    PointAdminController,
    TaxInvoiceController,

    TaxInvoiceAdminController,
  ],
  providers: [
    PaymentService,
    IntentService,
    PaymentProfileService,

    BnplService,
    BnplWithdrawalService,
    BnplSettlementService,
    RefundService,

    // --- Point 도메인 ---
    PointService,
    PointReader,
    PointManager,
    PointRepository,

    IdempotencyService,

    // --- Outbox Pattern ---
    OutboxService,
    OutboxDispatcherService,
    // --- Intent Implementation Layer ---
    IntentReader,
    IntentCreator,
    IntentManager,
    IntentRepository,

    // --- Payment Implementation Layer ---
    PaymentReader,
    PaymentManager,
    PaymentPointManager,
    PaymentProviderManager,
    PaymentAttemptRepository,

    // --- Payment Strategies ---
    EphemeralPaymentStrategy,
    StoredProfilePaymentStrategy,
    PaymentStrategyFactory,

    // --- BNPL Implementation Layer ---
    BnplAccountReader,
    BnplAccountCreator,
    BnplCreditManager,
    BnplBatchCreator,
    BnplCmsManager,
    BnplRetryManager,
    BnplRepository,
    // --- 데이터 접근 ---
    PaymentProfilesRepository,
    CmsCardProfilesRepository,
    CmsBatchProfilesRepository,

    // --- Provider 아키텍처 ---
    ProviderRegistry,
    // HMS Batch CMS 서비스 (직접 HTTP 요청)
    HmsBatchCmsService,
    // 개별 Provider 구현체들
    HmsCardRegistrar,
    HmsBnplRegistrar,
    HmsCardChargeProvider,
    HmsBnplChargeProvider,
    HmsBnplCashReceiptProvider,

    TossChargeProvider,
    HmsCardRefundProvider,
    TossRefundProvider,

    //

    // Main Services
    TaxInvoiceService,
    TaxInvoiceAdminService,
    TaxInvoicePreferenceService,

    // Implementation Layer
    TaxInvoiceReader,
    TaxInvoiceCreator,
    TaxInvoiceManager,

    // Data Access Layer (Unified Repository)
    TaxInvoiceRepository,

    // OMS Client (Mock - OMS는 다른 팀 담당)
    {
      provide: 'OMS_CLIENT',
      useClass: OmsClientMock,
    },
  ],
  exports: [
    // === v2 아키텍처 서비스들만 export ===
  ],
})
export class AppModule { }
