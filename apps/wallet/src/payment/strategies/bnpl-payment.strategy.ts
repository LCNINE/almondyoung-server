import { Injectable } from '@nestjs/common';
import {
  PaymentStrategy,
  PayRequest,
  PgPayResult,
  RefundRequest,
  PgRefundResult,
} from './payment.strategy';
import { PgService } from '../pg.service';

@Injectable()
export class BnplPaymentStrategy implements PaymentStrategy {
  constructor(private readonly pgService: PgService) {}

  async pay(request: PayRequest): Promise<PgPayResult> {
    console.log('🔵 [BNPL PAYMENT] 결제 승인 시작 - 외부 PG사 통신 없음');
    console.log(
      `🔵 [BNPL PAYMENT] Invoice ID: ${request.invoice.id}, Amount: ${request.invoice.amount}`,
    );

    // BNPL 결제 승인 시에는 PG사 연동 없이 즉시 승인
    // 실제 정산은 5분 후 스케줄러에서 처리
    const result = {
      success: true,
      pgTransactionId: `BNPL_${Date.now()}`, // 임시 트랜잭션 ID
      pgResponse: JSON.stringify({
        status: 'AUTHORIZED',
        message: 'BNPL payment authorized immediately',
        method: 'BNPL',
        amount: request.invoice.amount,
      }),
    };

    console.log(
      '🔵 [BNPL PAYMENT] 결제 승인 완료 - 외부 통신 없이 내부 처리만',
    );
    console.log(
      `🔵 [BNPL PAYMENT] 임시 Transaction ID: ${result.pgTransactionId}`,
    );

    return result;
  }

  async refund(request: RefundRequest): Promise<PgRefundResult> {
    // BNPL 환불은 HMS API를 통해 처리
    if (!request.paymentEventToRefund.pgTransactionId) {
      throw new Error('PG transaction ID is required for BNPL refund');
    }
    return this.pgService.refundPayment({
      pgTransactionId: request.paymentEventToRefund.pgTransactionId,
      amount: request.amount,
      originalAmount: Number(request.paymentEventToRefund.amount),
    });
  }
}
