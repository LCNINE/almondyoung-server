import { Module } from '@nestjs/common';
import { PaymsController } from './payms.controller';
import { PaymsService } from './payms.service';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { InvoiceModule } from './invoice/invoice.module';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentModule } from './payment/payment.module';
import * as paymentMethodSchema from './payment-method/schema';
import * as invoiceSchema from './invoice/schema';

@Module({
  imports: [
    SharedModule,
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://payms_owner:npg_8KxncIF7qoyH@ep-fancy-bonus-a1iiaieh-pooler.ap-southeast-1.aws.neon.tech/payms?sslmode=require&channel_binding=require',
      },
      schema: { ...paymentMethodSchema, ...invoiceSchema },
    }),
    PaymentMethodModule,
    InvoiceModule,
    PaymentModule,
  ],
  controllers: [PaymsController],
  providers: [PaymsService],
})
export class PaymsModule {}
