import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { validateWalletEnv } from './config/env.validation';
import { AuthCoreModule } from '../../../libs/auth-core/src';
import { PaymentController } from './controllers/payment.controller';
import { TaxInvoiceController } from './controllers/tax-invoice.controller';

import { IntentService } from './services/intents/intent.service';
import { IntentReader } from './services/intents/intent.reader';
import { IntentCreator } from './services/intents/intent.creator';
import { IntentManager } from './services/intents/intent.manager';
import { IntentRepository } from './services/intents/intent.repository';
import { PaymentProfileService } from './services/profiles/payment-profile.service';

import { walletSchema } from './shared/database/schema';
import { PaymentService } from './services/payment.service';
import { PaymentReader } from './services/payment/payment.reader';
import { PaymentManager } from './services/payment/payment.manager';
import { PaymentPointManager } from './services/payment/payment-point.manager';
import { PaymentProviderManager } from './services/payment/payment-provider.manager';
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
import { RefundService } from './services/refund.service';
import { PointService } from './services/points/point.service';
import { PointReader } from './services/points/point.reader';
import { PointManager } from './services/points/point.manager';
import { PointRepository } from './services/points/point.repository';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWalletEnv,
      ...(process.env.NODE_ENV !== 'production' && {
        envFilePath: ['apps/wallet/.env'],
      }),
    }),
    AuthCoreModule.forRootAsync({
      secret: process.env.AUTH_SECRET || '',
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
    IntentService,
    PaymentProfileService,
    TaxInvoiceService,
    BnplService,
    BnplSettlementService,
    RefundService,

    // --- Point 도메인 ---
    PointService,
    PointReader,
    PointManager,
    PointRepository,

    IdempotencyService,

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
    PaymentRequestBuilder,

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
