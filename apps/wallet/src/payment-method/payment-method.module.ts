import { Module } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { PaymentMethodController } from './payment-method.controller';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { HmsApiProvider, BatchCmsMockHmsApiProvider } from './hms-provider';
import { SharedModule } from '@app/shared';
import { BnplService } from './bnpl.service';
import { PAYMENT_STRATEGY_REGISTRY } from './strategies/payment.strategy';
import { PaymentMethodStrategy } from './strategies/payment.strategy';

@Module({
  imports: [SharedModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    BnplService,
    CardPaymentStrategy,
    HmsApiProvider,
    BatchCmsMockHmsApiProvider,
    {
      provide: PAYMENT_STRATEGY_REGISTRY,
      useFactory: (...strategies: PaymentMethodStrategy[]) => {
        const registry = new Map<string, PaymentMethodStrategy>();
        strategies.forEach((strategy) => {
          strategy.supportedTypes().forEach((type) => {
            registry.set(type, strategy);
          });
        });
        return registry;
      },
      inject: [CardPaymentStrategy], // 추후 전략 추가 시 여기에 추가
    },
  ],
  exports: [PaymentMethodService, BnplService],
})
export class PaymentMethodModule {}
