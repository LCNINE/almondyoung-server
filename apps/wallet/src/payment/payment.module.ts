import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { SettlementService } from './settlement.service';
import { SharedModule } from '@app/shared';

@Module({
  imports: [
    SharedModule,
  ],
  providers: [PaymentService, SettlementService],
  exports: [PaymentService, SettlementService],
})
export class PaymentModule {}