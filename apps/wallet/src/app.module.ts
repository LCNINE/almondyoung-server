import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';

// === v2 아키텍처 컨트롤러들 (레거시 제거됨) ===
import { PaymentIntentController } from './controllers/payment-intent.controller';
import { RefundController } from './controllers/refund.controller';
import { CheckoutSessionController } from './controllers/checkout-session.controller';
import { BnplPaymentProfilesController } from './controllers/bnpl-payment-profiles.controller';
import { PaymentProfileV2Controller } from './controllers/payment-profile-v2.controller';

// === 유지되는 서비스들 ===
import { IdempotencyService } from './services/idempotency.service';
// import { RecurringPaymentScheduler } from './services/recurring-payment.scheduler'; // 임시 비활성화
import { BnplBillingScheduler } from './services/bnpl-billing.scheduler';

// === v2 아키텍처 서비스들 ===
import { PaymentIntentService } from './services/v2/payment-intent.service';
import { RefundService as V2RefundService } from './services/v2/refund.service';
import { CheckoutSessionService } from './services/v2/checkout-session.service';
import { PaymentProfileService } from './services/v2/payment-profile.service';
import { PaymentProfileV2Service } from './services/v2/payment-profile-v2.service';
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
    BnplPaymentProfilesController,
    PaymentProfileV2Controller, // 정규화된 스키마용
  ],
  providers: [
    // === 유지되는 서비스들 ===
    IdempotencyService,
    // RecurringPaymentScheduler, // 임시 비활성화
    BnplBillingScheduler,

    // === v2 아키텍처 서비스들 ===
    PaymentProfileService,
    PaymentProfileV2Service,
    PaymentIntentService,
    V2RefundService,
    CheckoutSessionService,
    // PaymentProfileService, // 임시 비활성화 (스키마 변경으로 인한 에러)
    PaymentProfileV2Service, // 정규화된 스키마용
    {
      provide: PaymentPolicyValidator,
      useFactory: () => new PaymentPolicyValidator(loadPaymentPolicy()),
    },

    // === 어댑터들 (기존 호환성) ===

    // === Provider 전략 패턴 (PG 직접 통신) ===
    PaymentProviderFactory,
    HmsCardProvider, // HMS 카드 API 직접 호출

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
