import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';

// === 가이드 문서 준수: 단순화된 구조 ===
import { PaymentController } from './controllers/payment.controller';
import { PaymentMethodController } from './controllers/payment-method.controller';

// === 가이드 문서 준수: 4개 서비스만 유지 ===
import { PaymentService } from './services/payment.service';
import { PaymentMethodService } from './services/payment-method.service';
import { RefundService } from './services/refund.service';
import { IdempotencyService } from './services/idempotency.service';

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
    // === 가이드 문서 준수: 4개 서비스만 ===
    PaymentService,
    PaymentMethodService,
    RefundService,
    IdempotencyService,

    // === 어댑터들 ===
    TossPaymentAdapter,
    HmsCardPaymentAdapter,
    HmsBnplPaymentAdapter,
    InternalPointPaymentAdapter,
  ],
  exports: [
    // === 가이드 문서 준수: 필요한 서비스만 export ===
    PaymentService,
    PaymentMethodService,
    RefundService,
    IdempotencyService,
  ],
})
export class AppModule {}
