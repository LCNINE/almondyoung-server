import { Module } from '@nestjs/common';
import { PaymentMethodController } from './payment-method.controller';
import { PaymentMethodService } from './services/payment-method.service';
import { PgProviderModule } from '../pg-provider/pg-provider.module';
import { DbModule } from '@app/db';
import { MethodManagementPort } from './port/method-management.port';
import { BatchCmsAdapter } from '../pg-provider/adapters/batch-cms.adapter';

@Module({
  imports: [DbModule, PgProviderModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    { provide: MethodManagementPort, useClass: BatchCmsAdapter },
  ],
  exports: [PaymentMethodService],
})
export class PaymentMethodModule {}
