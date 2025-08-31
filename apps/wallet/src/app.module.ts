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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 ConfigService를 바로 사용할 수 있도록 설정
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    SharedModule,
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
  ],
  providers: [
    PaymentSessionsService,
    PaymentsService,
    RefundsService,
    IdempotencyService,
    SettlementService,
  ],
})
export class AppModule {}
