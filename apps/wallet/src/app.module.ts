import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';

// === 표준 컨트롤러들 ===
import { PaymentMethodController } from './controllers/payment-method.controller';
import { PaymentSessionController } from './controllers/payment-session.controller';
import { PaymentController } from './controllers/payment.controller';
import { RefundController } from './controllers/refund.controller';
import { BnplController } from './controllers/bnpl.controller';

import { SettlementController } from './controllers/settlement.controller';

// === 표준 통합 서비스 (리팩토링 후) ===
import { PaymentOrchestrationService } from './services/payment-orchestration.service';
import { PaymentGatewayFactory } from './services/payment-gateway.factory';
import { IdempotencyService } from './services/idempotency.service';
import { SettlementService } from './services/settlement.service';

// === 결제수단별 전용 서비스들 ===
import { BnplMethodService } from './services/method-services/bnpl-method.service';
import { CardMethodService } from './services/method-services/card-method.service';
import { PointMethodService } from './services/method-services/point-method.service';
import { PaymentMethodService } from './services/payment-method.service';
import { PaymentSessionService } from './services/payment-session.service';

// === 표준 PaymentGateway 어댑터들 (test3.md 기준) ===
import { TossPaymentAdapter } from './adapters/toss-payment.adapter';
import { HmsCardPaymentAdapter } from './adapters/hms-card-payment.adapter';
import { HmsBnplPaymentAdapter } from './adapters/hms-bnpl-payment.adapter';
import { InternalPointPaymentAdapter } from './adapters/internal-point-payment.adapter';

// === 표준 게이트웨이 토큰들 ===
import {
  TOSS_PAYMENT_ADAPTER,
  HMS_CARD_PAYMENT_ADAPTER,
  HMS_BNPL_PAYMENT_ADAPTER,
  INTERNAL_POINT_PAYMENT_ADAPTER,
} from './shared/tokens/gateway.tokens';

// === 스케줄러 ===
import { BnplStatusScheduler } from './services/scheduler/bnpl-status.scheduler';
import { SettlementScheduler } from './services/scheduler/settlement.scheduler';

import * as schema from './shared/database/schema';
import { RefundService } from './services/refund.service';

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
    // === 표준 컨트롤러들 ===
    PaymentMethodController,
    PaymentSessionController,
    PaymentController,
    RefundController,
    BnplController,
    SettlementController,
  ],
  providers: [
    // === 표준 통합 서비스들 (리팩토링 후) ===
    PaymentOrchestrationService,
    PaymentGatewayFactory,
    IdempotencyService,
    SettlementService,
    RefundService,

    // === 결제수단별 전용 서비스들 ===
    BnplMethodService,
    CardMethodService,
    PointMethodService,
    PaymentMethodService,
    PaymentSessionService,
    PaymentOrchestrationService,
    // === 스케줄러 ===
    BnplStatusScheduler,
    SettlementScheduler,

    // === 표준 PaymentGateway 어댑터들 (Provider Token 방식) ===
    {
      provide: TOSS_PAYMENT_ADAPTER,
      useClass: TossPaymentAdapter,
    },
    {
      provide: HMS_CARD_PAYMENT_ADAPTER,
      useClass: HmsCardPaymentAdapter,
    },
    {
      provide: HMS_BNPL_PAYMENT_ADAPTER,
      useClass: HmsBnplPaymentAdapter,
    },
    {
      provide: INTERNAL_POINT_PAYMENT_ADAPTER,
      useClass: InternalPointPaymentAdapter,
    },
  ],
  exports: [
    // === 표준 통합 서비스 Export (리팩토링 후) ===
    PaymentOrchestrationService,
    PaymentGatewayFactory,
    IdempotencyService,
    SettlementService,

    // === 결제수단별 전용 서비스들 ===
    BnplMethodService,
    CardMethodService,
    PointMethodService,
    PaymentMethodService,
    PaymentSessionService,
  ],
})
export class AppModule {}
