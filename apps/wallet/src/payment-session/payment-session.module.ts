import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';


import { PaymentSessionController } from './controllers';
import {
  PaymentSessionService,
  PaymentLockService,
  PaymentSessionEventService,
} from './services';

@Module({
  imports: [

    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
  ],
  controllers: [PaymentSessionController],
  providers: [
    PaymentSessionService,
    PaymentLockService,
    PaymentSessionEventService,
  ],
  exports: [
    PaymentSessionService,
    PaymentLockService,
    PaymentSessionEventService,
  ],
})
export class PaymentSessionModule {}