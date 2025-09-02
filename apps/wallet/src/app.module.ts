import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ConfigModule } from '@nestjs/config';
import * as schema from './shared/database/schema';
import { PaymentSessionsController } from './controllers/payment-sessions.controller';
import { PaymentSessionsService } from './services/payment-sessions.service';
// import { PaymentsController } from './controllers/payments.controller'; // V1 컨트롤러 비활성화
// import { PaymentsService } from './services/payments.service'; // V1 서비스 비활성화
import { PaymentsV2Controller } from './controllers/payments.controller';
import { TestSetupController } from './controllers/test-setup.controller';
import { PaymentServiceV2 } from './services/payment-v2.service';
import { TossImmediateAdapter } from './adapters/toss-immediate.adapter';
import { BnplDeferredAdapter } from './adapters/bnpl-deferred.adapter';
import { PointsService } from './services/point.service';
import { RefundsService } from './services/refunds.service';

import { IdempotencyService } from './services/Idempotency.service';
import { RefundsController } from './controllers/refunds.controller';
import { SettlementController } from './controllers/settlement.controllet';
import { SettlementService } from './services/settlement.service';
import { BNPLService } from './services/bnpl.service';

import { BNPLController } from './controllers/bnpl.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { PaymentMethodService } from './services/payment-methods.service';
import { PaymentMethodFactoryService } from './services/payment-method-factory.service';
import { TossCardAdapter } from './adapters/toss-card.adapter';
import { SettlementScheduler } from './services/scheduler/settlement.scheduler';
import { BnplStatusScheduler } from './services/scheduler/bnpl-status.scheduler';
import { ScheduleModule } from '@nestjs/schedule';
import { PointAdapter } from './adapters/point.adapter';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 ConfigService를 바로 사용할 수 있도록 설정
      envFilePath: ['.env.local', '.env'], // .env.local 먼저, 그 다음 .env
    }),
    SharedModule,
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema },
    }),
  ],
  controllers: [
    PaymentSessionsController,
    // PaymentsController, // V1 컨트롤러 비활성화
    PaymentsV2Controller, // V2 컨트롤러 활성화
    TestSetupController, // 테스트용 컨트롤러 추가
    RefundsController,
    SettlementController,
    BNPLController,
    PaymentMethodsController,
  ],
  providers: [
    PaymentSessionsService,
    // PaymentsService, // V1 서비스 비활성화
    PaymentServiceV2, // V2 서비스 활성화
    RefundsService,
    IdempotencyService,
    SettlementService,
    BNPLService,
    PaymentMethodService,
    PaymentMethodFactoryService,
    PointsService, // 포인트 서비스 추가
    TossCardAdapter, // 기존 카드 어댑터 (V1용)
    TossImmediateAdapter, // 즉시결제 어댑터 (V2용)
    BnplDeferredAdapter, // 후불결제 어댑터 (V2용)
    PointAdapter, // 포인트 어댑터 (V1용)
    SettlementScheduler,
    BnplStatusScheduler,
  ],
})
export class AppModule {}
