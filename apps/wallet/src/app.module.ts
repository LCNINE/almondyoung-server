import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';

// === v2 아키텍처 컨트롤러들 (레거시 제거됨) ===
import { PaymentIntentController } from './controllers/v2/payment-intent.controller';
import { RefundController } from './controllers/v2/refund.controller';
import { CheckoutSessionController } from './controllers/v2/checkout-session.controller';
import { BnplProfileController } from './controllers/v2/bnpl-profile.controller';

// === 유지되는 서비스들 ===
import { IdempotencyService } from './services/idempotency.service';
// import { RecurringPaymentScheduler } from './services/recurring-payment.scheduler'; // 임시 비활성화
import { BnplBillingScheduler } from './services/bnpl-billing.scheduler';

// === v2 아키텍처 서비스들 ===
import { PaymentIntentService } from './services/v2/payment-intent.service';
import { RefundService as V2RefundService } from './services/v2/refund.service';
import { CheckoutSessionService } from './services/v2/checkout-session.service';
import {
  PaymentPolicyValidator,
  loadPaymentPolicy,
} from './shared/policies/payment-policy';

// === 어댑터들 (기존 호환성만) ===

// ❌ import { HmsCardPaymentAdapter } from './adapters/hms-card-payment.adapter';  // Provider로 통합됨
// ❌ import { HmsBnplPaymentAdapter } from './adapters/hms-bnpl-payment.adapter'; // Provider로 통합됨

// === Provider 전략 패턴 ===
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { HmsCardProvider } from './providers/hms-card.provider';
import { HmsCmsProvider } from './providers/hms-cms.provider';
import { HmsBnplProvider } from './providers/hms-bnpl.provider';
import { TossProvider } from './providers/toss.provider';
import { KakaopayProvider } from './providers/kakaopay.provider';
import { PointsProvider } from './providers/points.provider';

import * as schema from './shared/database/schema';

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
      schema: { ...schema },
    }),
    EventsModule,
  ],
  controllers: [
    // === v2 아키텍처 컨트롤러들만 (레거시 제거됨) ===
    PaymentIntentController,
    RefundController,
    CheckoutSessionController,
    BnplProfileController,
  ],
  providers: [
    // === 유지되는 서비스들 ===
    IdempotencyService,
    // RecurringPaymentScheduler, // 임시 비활성화
    BnplBillingScheduler,

    // === v2 아키텍처 서비스들 ===
    PaymentIntentService,
    V2RefundService,
    CheckoutSessionService,
    {
      provide: PaymentPolicyValidator,
      useFactory: () => new PaymentPolicyValidator(loadPaymentPolicy()),
    },

    // === 어댑터들 (기존 호환성) ===

    // === Provider 전략 패턴 (PG 직접 통신) ===
    PaymentProviderFactory,
    HmsCardProvider, // HMS 카드 API 직접 호출
    HmsCmsProvider, // HMS CMS API 직접 호출 (스텁)
    HmsBnplProvider, // HMS BNPL API 직접 호출
    TossProvider, // 토스 API 직접 호출 (스텁)
    KakaopayProvider, // 카카오페이 API 직접 호출 (스텁)
    PointsProvider, // 내부 포인트 원장
  ],
  exports: [
    // === v2 아키텍처 서비스들만 export ===
    PaymentIntentService,
    V2RefundService,
    CheckoutSessionService,
    IdempotencyService,
  ],
})
export class AppModule {}
