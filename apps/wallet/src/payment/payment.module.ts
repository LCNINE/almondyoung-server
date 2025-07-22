// src/payment/payment.module.ts (최종 수정본)

import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { SettlementService } from './settlement.service';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { BatchCmsAdapter } from '../pg-provider/adapters/batch-cms.adapter';
import { PgProviderModule } from '../pg-provider/pg-provider.module';
import { PaymentController } from './payment.controller';
import { BnplAccountService } from '../bnpl/services/bnpl-account.service';
import { PaymentEventHandler } from './events/payment-event.handler';
import { SettlementEventHandler } from './listeners/settlement-event.handler';

/**
 * Payment 모듈 - Event Sourcing Pattern 적용
 * - PaymentService: 결제 비즈니스 로직 및 이벤트 발행
 * - PaymentEventHandler: 결제 이벤트 수신 및 DB 기록 (Event Sourcing)
 * - SettlementService: 정산 처리 및 이벤트 발행
 */
@Module({
  imports: [PgProviderModule],
  controllers: [
    PaymentController, // ✅ Controller 등록
  ],
  providers: [
    PaymentService,
    BnplAccountService,
    SettlementService,
    PaymentEventHandler, // ✅ Event Sourcing 리스너 등록
    SettlementEventHandler, // ✅ Settlement Event Sourcing 리스너 등록
    {
      provide: PaymentProcessingPort,
      useClass: BatchCmsAdapter,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
