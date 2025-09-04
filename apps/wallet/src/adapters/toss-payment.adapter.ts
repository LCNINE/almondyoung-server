// adapters/toss-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentGateway,
  PaymentMetadata,
  PaymentResult,
  RefundResult,
} from '../interfaces/payment-gateway.interface';
import { Money } from '../shared/utils/money.util';

/**
 * 토스 결제 어댑터 (표준 간소화)
 * - processPayment(): 즉시 승인+확정
 * - refundPayment(): 결제 환불
 */
@Injectable()
export class TossPaymentAdapter implements PaymentGateway {
  private readonly logger = new Logger(TossPaymentAdapter.name);

  async processPayment(
    amount: number,
    currency: string = 'KRW',
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `토스 결제 처리: ${metadata?.paymentMethodId}, 금액: ${amountKRW}KRW`,
    );

    try {
      // 토스 페이먼츠 API 모킹 (실제로는 SDK 사용)
      const mockResponse = this.createMockTossResponse(amountKRW, metadata);

      this.logger.log(`토스 결제 성공: ${mockResponse.transactionId}`);

      return {
        success: true,
        transactionId: mockResponse.transactionId,
        captureId: mockResponse.transactionId, // 즉시결제는 승인=확정
        metadata: {
          provider: 'toss',
          method: metadata?.isRecurring ? 'billing_key' : 'ui_redirect',
          approvalNumber: mockResponse.approvalNumber,
          paymentDate: mockResponse.paymentDate,
          cardInfo: mockResponse.cardInfo,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: `토스 결제 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(`토스 환불: ${transactionId}, 금액: ${amountKRW}KRW`);

    try {
      // 토스 환불 API 모킹
      const mockRefund = this.createMockTossRefund(transactionId, amountKRW);

      return {
        success: true,
        refundId: mockRefund.refundId,
        refundedAmount: amountKRW,
        metadata: {
          provider: 'toss',
          originalTransactionId: transactionId,
          refundDate: mockRefund.refundDate,
          reason: reason || '고객 요청',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: `토스 환불 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  // === Private Helper Methods ===

  private createMockTossResponse(
    amountKRW: number,
    metadata?: PaymentMetadata,
  ) {
    return {
      transactionId: `TOSS_${Date.now()}`,
      approvalNumber: `TOSS_${Math.random().toString(36).substring(7)}`,
      paymentDate: new Date().toISOString(),
      cardInfo: {
        maskedNumber: '1234-****-****-5678',
        cardCompany: 'TOSS_CARD',
        cardType: 'CREDIT',
      },
    };
  }

  private createMockTossRefund(transactionId: string, amountKRW: number) {
    return {
      refundId: `REFUND_TOSS_${Date.now()}`,
      refundDate: new Date().toISOString(),
      originalTransactionId: transactionId,
      refundedAmount: amountKRW,
    };
  }
}
