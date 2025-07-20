import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PgProviderModule } from '../pg-provider/pg-provider.module';

@Module({
  imports: [PgProviderModule],
  providers: [
    PaymentService,
    // DI는 PgProviderModule에서 처리
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
