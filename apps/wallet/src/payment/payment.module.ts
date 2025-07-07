import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { PaymentMethodModule } from '../payment-method/payment-method.module';
import { HmsApiProvider } from '../payment-method/hms-provider';
import { SharedModule } from '@app/shared';
import { InvoiceService } from '../invoice/invoice.service';

@Module({
  imports: [
    InvoiceModule,
    PaymentMethodModule,
    SharedModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    HmsApiProvider,
    InvoiceService
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
