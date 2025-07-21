// src/payment/payment.module.ts (최종 수정본)

import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { BatchCmsAdapter } from '../pg-provider/adapters/batch-cms.adapter';
import { PgProviderModule } from '../pg-provider/pg-provider.module';
import { PaymentController } from './payment.controller'; // ✅ Controller import

@Module({
  imports: [PgProviderModule],
  controllers: [
    PaymentController, // ✅ Controller 등록
  ],
  providers: [
    PaymentService,
    {
      provide: PaymentProcessingPort,
      useClass: BatchCmsAdapter,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
