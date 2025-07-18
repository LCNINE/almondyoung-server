import { Module } from '@nestjs/common';
import { PaymsService } from './payms.service';
import { InvoiceModule } from './invoice/invoice.module';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ScheduleModule } from '@nestjs/schedule';
// import { PaymentModule } from './payment/payment.module';
import { BnplModule } from './bnpl/bnpl.module';
import { ConfigModule } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import { APP_PIPE } from '@nestjs/core';
import * as schema from './shared/schemas/schema';
import { PaymentModule } from './payment/payment.module';
import { PaymentMethodModule } from './payment-method/payment-method.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 ConfigService를 바로 사용할 수 있도록 설정
      envFilePath: `.env.${process.env.NODE_ENV}` || '.env',
    }),
    SharedModule,
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://payms_owner:npg_8KxncIF7qoyH@ep-fancy-bonus-a1iiaieh-pooler.ap-southeast-1.aws.neon.tech/payms?sslmode=require&channel_binding=require',
      },
      schema: { ...schema },
    }),
    InvoiceModule,
    // PaymentModule,
    PaymentModule,
    PaymentMethodModule,
    BnplModule,
  ],
  controllers: [],
  providers: [
    PaymsService,
    {
      provide: APP_PIPE, // 전역 파이프로 등록
      useClass: ZodValidationPipe, // ZodValidationPipe 사용
    },
  ],
})
export class PaymsModule {}
