import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ConfigModule } from '@nestjs/config';
import * as schema from './shared/database/schema';
import { PaymentSessionsController } from './controllers/payment-sessions.controller';
import { PaymentSessionsService } from './services/payment-sessions.service';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentsService } from './services/payments.service';
import { RefundsService } from './services/refunds.service';
import { CheckoutController } from './controllers/checkout.controller';
import { IdempotencyService } from './services/Idempotency.service';
import { RefundsController } from './controllers/refunds.controller';
import { SettlementController } from './controllers/settlement.controllet';
import { SettlementService } from './services/settlement.service';
import { BNPLService } from './services/bnpl.service';
import { BatchCmsService } from './services/batch-cms.service';
import { BNPLController } from './controllers/bnpl.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { PaymentMethodService } from './services/payment-methods.service';
import { PaymentMethodFactoryService } from './services/payment-method-factory.service';
import { TossCardAdapter } from './adapters/toss-card.adapter';
import { RewardPointAdapter } from './adapters/reward-point.adapter';
import { SettlementScheduler } from './services/scheduler/settlement.scheduler';
import { ScheduleModule } from '@nestjs/schedule';

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
    PaymentsController,
    CheckoutController,
    RefundsController,
    SettlementController,
    BNPLController,
    PaymentMethodsController,
  ],
  providers: [
    PaymentSessionsService,
    PaymentsService,
    RefundsService,
    IdempotencyService,
    SettlementService,
    BNPLService,
    BatchCmsService,
    PaymentMethodService,
    PaymentMethodFactoryService,
    TossCardAdapter,
    RewardPointAdapter,
    SettlementScheduler,
  ],
})
export class AppModule {}
