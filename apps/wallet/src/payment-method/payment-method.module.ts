import { Module } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { PaymentMethodController } from './payment-method.controller';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { HmsApiProvider } from './hms-provider';
import { SharedModule } from '@app/shared';
import { BnplPaymentStrategy } from './strategies/bnpl-payment.strategy';

@Module({
  imports: [SharedModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    CardPaymentStrategy,
    BnplPaymentStrategy,
    HmsApiProvider,
    {
      provide: 'PAYMENT_STRATEGIES',
      useFactory: (
        cardStrategy: CardPaymentStrategy,
        bnplStrategy: BnplPaymentStrategy,
      ) => [cardStrategy, bnplStrategy],
      inject: [CardPaymentStrategy, BnplPaymentStrategy],
    },
  ],
  exports: [PaymentMethodService, HmsApiProvider],
})
export class PaymentMethodModule {}
