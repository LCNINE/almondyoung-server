import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PaymentController } from './controllers/payment.controller';
import { TaxInvoiceController } from './controllers/tax-invoice.controller';

import { PaymentIntentService } from './services/intents/intent.service';
import { PaymentProfileService } from './services/profiles/payment-profile.service';
// 신규 정책 시스템은 Provider Factory에서 직접 사용

// === 어댑터들 (기존 호환성만) ===

// ❌ import { HmsCardPaymentAdapter } from './adapters/hms-card-payment.adapter';  // Provider로 통합됨
// ❌ import { HmsBnplPaymentAdapter } from './adapters/hms-bnpl-payment.adapter'; // Provider로 통합됨

// === Provider 전략 패턴 ===

import * as schema from './shared/database/schema';
import { walletSchema } from './shared/database/schema';
import { PaymentService } from './services/payment.service';
import {
  PaymentOrchestratorService,
  PaymentExecutorService,
} from './services/payment';
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
import { CheckoutSessionService } from './services/checkout-session.service';
import { TaxInvoiceService } from './services/tax-invoice.service';
import { BnplAccountService } from './services/bnpl-account.service';
import { BnplBillingScheduler } from './services/bnpl-billing.scheduler';
import { RefundService } from './services/refund.service';
import { PointService } from './services/points/point.service';
import { PointRepository } from './services/points/point.repository';

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
    CheckoutSessionService,
    TaxInvoiceService,
    BnplAccountService,
    BnplBillingScheduler,
    RefundService,

    // --- 포인트 시스템 ---
    PointService,
    PointRepository,

    // --- 내부 흐름 제어 서비스 ---
    PaymentOrchestratorService,
    PaymentExecutorService,
    IdempotencyService,
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
