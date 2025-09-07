import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';

// === 가이드 문서 준수: 단순화된 구조 ===
import { PaymentController } from './controllers/payment.controller';
import { PaymentMethodController } from './controllers/payment-method.controller';

// === 가이드 문서 준수: 세션 기반 서비스 추가 ===
import { PaymentService } from './services/payment.service';
import { PaymentSessionService } from './services/payment-session.service';
import { PaymentMethodService } from './services/payment-method.service';
import { RefundService } from './services/refund.service';
import { IdempotencyService } from './services/idempotency.service';
import { RecurringPaymentScheduler } from './services/recurring-payment.scheduler';

// === 어댑터들 (가이드 문서 준수) ===
import { TossPaymentAdapter } from './adapters/toss-payment.adapter';
import { HmsCardPaymentAdapter } from './adapters/hms-card-payment.adapter';
import { HmsBnplPaymentAdapter } from './adapters/hms-bnpl-payment.adapter';
import { InternalPointPaymentAdapter } from './adapters/internal-point-payment.adapter';

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
    // === 가이드 문서 준수: 통합 컨트롤러만 ===
    PaymentController,
    PaymentMethodController,
  ],
  providers: [
    // === 가이드 문서 준수: 세션 기반 서비스 ===
    PaymentService,
    PaymentSessionService,
    PaymentMethodService,
    RefundService,
    IdempotencyService,
    RecurringPaymentScheduler,

    // === 어댑터들 ===
    TossPaymentAdapter,
    HmsCardPaymentAdapter,
    HmsBnplPaymentAdapter,
    InternalPointPaymentAdapter,
  ],
  exports: [
    // === 가이드 문서 준수: 필요한 서비스만 export ===
    PaymentService,
    PaymentSessionService,
    PaymentMethodService,
    RefundService,
    IdempotencyService,
  ],
})
export class AppModule {}
