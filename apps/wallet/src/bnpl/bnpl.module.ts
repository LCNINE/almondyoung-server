import { Module } from '@nestjs/common';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import { HmsBnplService } from './services/hms-bnpl.service';
import { BatchCmsStatusTrackerService } from './services/batch-cms-status-tracker.service';

import { SharedModule } from '@app/shared';
import { PaymentModule } from '../payment/payment.module';
import { PgPort } from '../bnpl/ports/payment-ports';
import { BatchCmsAdapter } from '../bnpl/adapters/batch-cms.adapter';

@Module({
  imports: [SharedModule, PaymentModule],
  controllers: [BnplController],
  providers: [
    BnplService,
    HmsBnplService,
    BatchCmsStatusTrackerService,
    BatchCmsAdapter,
    {
      provide: PgPort,
      useClass: BatchCmsAdapter, // BNPL은 기본적으로 BatchCMS 어댑터 사용
    },
  ],
  exports: [BnplService],
})
export class BnplModule {}
