import { Module } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { PaymentMethodController } from './payment-method.controller';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { HmsApiProvider } from './hms-provider';
import { SharedModule } from '@app/shared';

@Module({
  imports: [SharedModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    CardPaymentStrategy,
    HmsApiProvider,
    {
      provide: 'PAYMENT_STRATEGIES',
      useFactory: (cardStrategy: CardPaymentStrategy) => [cardStrategy],
      inject: [CardPaymentStrategy],
    },
  ],
  exports: [PaymentMethodService, HmsApiProvider],
})
export class PaymentMethodModule {}
