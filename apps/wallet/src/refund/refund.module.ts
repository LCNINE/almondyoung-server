import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { RefundAdminController } from './refund-admin.controller';
import { RefundAccountController } from './refund-account.controller';
import { RefundAccountService } from './services/refund-account.service';
import { RefundAdminService } from './services/refund-admin.service';
import { RefundEventHandler } from './listeners/refund-event.handler';
import { RefundGatewayFactory } from './factories/refund-gateway.factory';
import { ManualRefundAdapter } from './adapters/manual-refund.adapter';
import { PgApiRefundAdapter } from './adapters/pg-api-refund.adapter';

/**
 * 환불(Refund) 모듈 - Event Sourcing + 포트와 어댑터 패턴 적용
 * - RefundService: 환불 비즈니스 로직 및 이벤트 발행
 * - RefundEventHandler: 환불 이벤트 수신 및 DB 기록 (Event Sourcing)
 * - RefundGatewayFactory: 결제수단별 환불 어댑터 선택 (Factory Pattern)
 * - ManualRefundAdapter: BNPL 수동 환불 처리 (Port & Adapter Pattern)
 * - PgApiRefundAdapter: 카드 자동 환불 처리 (Port & Adapter Pattern)
 * - RefundController: 사용자용 환불 요청 API
 * - RefundAdminController: CS팀용 환불 관리 API (CQRS 최적화)
 * - RefundAdminService: 관리자용 조회 모델 서비스 (CQRS 패턴)
 * - UserRefundAccountService: 사용자 환불 계좌 관리
 * - UserRefundAccountController: 사용자 환불 계좌 관리 API
 */
@Module({
  providers: [
    RefundService,
    RefundAdminService,
    RefundAccountService,
    RefundEventHandler, // ✅ Event Sourcing 리스너 등록
    RefundGatewayFactory, // ✅ 환불 어댑터 팩토리 등록
    ManualRefundAdapter, // ✅ BNPL 수동 환불 어댑터 등록
    PgApiRefundAdapter, // ✅ 카드 자동 환불 어댑터 등록
  ],
  controllers: [
    RefundController,
    RefundAdminController,
    RefundAccountController,
  ],
  exports: [RefundService, RefundAdminService, RefundAccountService],
})
export class RefundModule {}
