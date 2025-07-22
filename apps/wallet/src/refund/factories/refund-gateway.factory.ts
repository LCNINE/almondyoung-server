import { Injectable, Logger } from '@nestjs/common';
import { RefundProcessingPort } from '../port/refund-processing.port';
import { ManualRefundAdapter } from '../adapters/manual-refund.adapter';
import { PgApiRefundAdapter } from '../adapters/pg-api-refund.adapter';

/**
 * 환불 게이트웨이 팩토리 (Refund Gateway Factory)
 * 결제수단 종류에 따라 적절한 환불 어댑터를 선택하는 스마트 분배기
 */
@Injectable()
export class RefundGatewayFactory {
  private readonly logger = new Logger(RefundGatewayFactory.name);

  constructor(
    private readonly manualRefundAdapter: ManualRefundAdapter,
    private readonly pgApiRefundAdapter: PgApiRefundAdapter,
  ) {}

  /**
   * 결제수단에 따라 적절한 환불 어댑터를 반환
   * @param paymentMethod 원본 결제에 사용된 결제수단
   * @returns 해당 결제수단에 맞는 환불 처리 어댑터
   */
  getAdapterFor(paymentMethod: any): RefundProcessingPort {
    this.logger.log(`환불 어댑터 선택: 결제수단=${paymentMethod.methodType}`);

    switch (paymentMethod.methodType) {
      case 'BNPL':
        // BNPL(효성 CMS): CS팀 수동 처리
        this.logger.log('BNPL 환불 → ManualRefundAdapter 선택');
        return this.manualRefundAdapter;

      case 'CARD':
        // 신용카드: PG사 API 자동 처리
        this.logger.log('신용카드 환불 → PgApiRefundAdapter 선택');
        return this.pgApiRefundAdapter;

      case 'BANK_ACCOUNT':
        // 계좌이체: 현재는 수동 처리 (향후 확장 가능)
        this.logger.log('계좌이체 환불 → ManualRefundAdapter 선택');
        return this.manualRefundAdapter;

      case 'REWARD_POINT':
        // 적립금: 즉시 복원 가능 (향후 별도 어댑터 구현)
        this.logger.log('적립금 환불 → PgApiRefundAdapter 선택 (즉시 처리)');
        return this.pgApiRefundAdapter;

      default:
        this.logger.warn(`알 수 없는 결제수단: ${paymentMethod.methodType}, 기본값으로 수동 처리 선택`);
        return this.manualRefundAdapter;
    }
  }

  /**
   * 지원되는 환불 방식 목록 반환
   */
  getSupportedRefundMethods(): Record<string, string> {
    return {
      BNPL: 'CS팀 수동 처리 (사전 등록 계좌 필요)',
      CARD: 'PG사 API 자동 처리 (원거래 취소)',
      BANK_ACCOUNT: 'CS팀 수동 처리 (사전 등록 계좌 필요)',
      REWARD_POINT: '즉시 적립금 복원',
    };
  }
}