import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PaymentController } from './controllers/payment.controller';
import { TaxInvoiceController } from './controllers/tax-invoice.controller';

import { PaymentIntentService } from './services/intents/intent.service';
import { IntentRepository } from './services/intents/intent.repository';
import { IntentManager } from './services/intents/intent.manager';
import { PaymentProfileService } from './services/profiles/payment-profile.service';

import { walletSchema } from './shared/database/schema';
import { PaymentService } from './services/payment.service';
import { PaymentAttemptRepository } from './services/payment/payment-attempt.repository';
import { PaymentRequestBuilder } from './services/payment/payment-request.builder';
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
import { HmsCardChargeProvider } from './providers/hms-card.charge';
import { HmsBnplChargeProvider } from './providers/hms-bnpl.charge';
import { HmsBnplCashReceiptProvider } from './providers/hms-bnpl.cash-receipt';
import { HmsBnplTaxInvoiceProvider } from './providers/hms-bnpl.tax-invoice';
import { TossChargeProvider } from './providers/toss.charge';
import { HmsCardRefundProvider } from './providers/hms-card.refund';
import { TossRefundProvider } from './providers/toss.refund';
import { IdempotencyService } from './services/idempotency.service';
import { TaxInvoiceService } from './services/tax-invoice.service';
import { BnplService } from './services/bnpl/bnpl.service';
import { BnplAccountReader } from './services/bnpl/bnpl-account.reader';
import { BnplAccountCreator } from './services/bnpl/bnpl-account.creator';
import { BnplCreditManager } from './services/bnpl/bnpl-credit.manager';
import { BnplBillingScheduler } from './services/bnpl-billing.scheduler';
import { RefundService } from './services/refund.service';
import { PointService } from './services/points/point.service';
import { PointRepository } from './services/points/point.repository';
import { PaymentOrchestratorServiceImpl } from './services/payment/payment-orchestrator.service';
import { PaymentExecutorServiceImpl } from './services/payment/payment-executor.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...walletSchema },
    }),
    EventsModule,
  ],
  controllers: [
    // === 신규 아키텍처 ===
    PaymentController,
    TaxInvoiceController,
  ],
  providers: [
    PaymentService,
    PaymentIntentService,
    PaymentProfileService,
    TaxInvoiceService,
    BnplService,
    BnplSettlementService,
    BnplBillingScheduler,
    RefundService,

    // --- 포인트 시스템 ---
    PointService,
    PointRepository,
    PaymentOrchestratorServiceImpl,
    PaymentExecutorServiceImpl,

    IdempotencyService,

    // --- Implement Layer (Manager - Repository 캡슐화) ---
    IntentManager,

    PaymentRequestBuilder,

    // --- Implementation Layer ---
    BnplAccountReader,
    BnplAccountCreator,
    BnplCreditManager,
    BnplBatchCreator,
    BnplCmsManager,
    BnplRetryManager,

    // --- Data Access Layer (Repository) ---
    IntentRepository,
    PaymentAttemptRepository,
    BnplRepository,
    // --- 데이터 접근 ---
    PaymentProfilesRepository,
    CmsCardProfilesRepository,
    CmsBatchProfilesRepository,

    // --- Provider 아키텍처 ---
    ProviderRegistry,
    // 개별 Provider 구현체들
    HmsCardRegistrar,
    HmsBnplRegistrar,
    HmsCardChargeProvider,
    HmsBnplChargeProvider,
    HmsBnplCashReceiptProvider,
    HmsBnplTaxInvoiceProvider,
    TossChargeProvider,
    HmsCardRefundProvider,
    TossRefundProvider,
  ],
  exports: [
    // === v2 아키텍처 서비스들만 export ===
  ],
})
export class AppModule {}
