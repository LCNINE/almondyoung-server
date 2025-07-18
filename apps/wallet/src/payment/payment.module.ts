import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { SettlementService } from './settlement.service';
import { SharedModule } from '@app/shared';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [SharedModule, EventEmitterModule.forRoot()],
  providers: [PaymentService, SettlementService],
  exports: [PaymentService, SettlementService],
})
export class PaymentModule {}
