import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentClientService } from './payment-client.service';
import { RecurringBillingService } from './recurring-billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    SubscriptionModule,
    PlanModule,
  ],
  providers: [PaymentClientService, RecurringBillingService],
  controllers: [BillingController],
  exports: [PaymentClientService, RecurringBillingService],
})
export class BillingModule {}
