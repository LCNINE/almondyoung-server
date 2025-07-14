import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { PaymentMethodModule } from '../payment-method/payment-method.module';
import { SharedModule } from '@app/shared';
import { InvoiceService } from '../invoice/invoice.service';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { BnplPaymentStrategy } from './strategies/bnpl-payment.strategy';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentEventListener } from './listeners/payment.listener';
import { PgService } from './pg.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    InvoiceModule,
    PaymentMethodModule,
    SharedModule,
    ScheduleModule, // forRoot() 제거
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PgService,
    InvoiceService,
    CardPaymentStrategy,
    BnplPaymentStrategy,
    PaymentEventListener,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
