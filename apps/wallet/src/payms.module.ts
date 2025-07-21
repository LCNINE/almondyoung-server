import { Module } from '@nestjs/common';
import { PaymsService } from './payms.service';
import { InvoiceModule } from './invoice/invoice.module';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
// import { PaymentModule } from './payment/payment.module';
import { BnplModule } from './bnpl/bnpl.module';
import { ConfigModule } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import { APP_PIPE } from '@nestjs/core';
import * as schema from './shared/schemas/schema';
// import { PaymentModule } from './payment/payment.module';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { EventsModule } from './shared/events/events.module';
import { PaymentModule } from './payment/payment.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 ConfigService를 바로 사용할 수 있도록 설정
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    EventEmitterModule.forRoot({
      // 이벤트 처리 설정
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
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
    EventsModule,
    InvoiceModule,
    BnplModule,
    // PaymentModule,
    PaymentModule,
    PaymentMethodModule,
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
