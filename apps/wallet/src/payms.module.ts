import { Module } from '@nestjs/common';
import { PaymsService } from './payms.service';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { InvoiceModule } from './invoice/invoice.module';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentModule } from './payment/payment.module';
import * as paymentMethodSchema from './payment-method/schema';
import * as invoiceSchema from './invoice/schema';
import * as paymentSchema from './payment/schema';
import { ConfigModule } from '@nestjs/config';

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
      schema: { ...paymentMethodSchema, ...invoiceSchema, ...paymentSchema },
    }),
    PaymentMethodModule,
    InvoiceModule,
    PaymentModule,
  ],
  controllers: [],
  providers: [PaymsService],
})
export class PaymsModule {}
