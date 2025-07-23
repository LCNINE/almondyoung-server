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
import { PointService } from '../point/point.service';
// CQRS 패턴 - 조회 전담 서비스 및 컨트롤러
import { PaymentHistoryService } from './services/payment-history.service';
import { PaymentHistoryController } from './controllers/payment-history.controller';

/**
 * Payment 모듈 - Event Sourcing Pattern + CQRS 적용
 * - PaymentService: 결제 비즈니스 로직 및 이벤트 발행 (Command)
 * - PaymentHistoryService: 결제 내역 조회 전담 (Query)
 * - PaymentEventHandler: 결제 이벤트 수신 및 DB 기록 (Event Sourcing)
 * - SettlementService: 정산 처리 및 이벤트 발행
 */
@Module({
  imports: [PgProviderModule],
  controllers: [
    PaymentController, // ✅ 결제 명령 처리 Controller
    PaymentHistoryController, // ✅ 결제 조회 전담 Controller (CQRS)
  ],
  providers: [
    PaymentService,
    PaymentHistoryService, // ✅ 조회 전담 서비스 (CQRS)
    PointService,
    BnplAccountService,
    SettlementService,
    PaymentEventHandler, // ✅ Event Sourcing 리스너 등록
    SettlementEventHandler, // ✅ Settlement Event Sourcing 리스너 등록
    {
      provide: PaymentProcessingPort,
      useClass: BatchCmsAdapter,
    },
  ],
  exports: [PaymentService, PaymentHistoryService], // ✅ 조회 서비스도 export
})
export class PaymentModule {}
