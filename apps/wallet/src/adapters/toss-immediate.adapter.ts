// adapters/toss-immediate.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  ImmediatePaymentAdapter,
  ImmediatePaymentRequest,
  ImmediatePaymentResponse,
  RefundRequest,
  RefundResponse,
} from '../ports/immediate-payment.port';

/**
 * 토스 즉시결제 어댑터
 * - 카드 결제를 승인+확정 동시 처리
 * - 기존 TossCardAdapter에서 간소화
 */
@Injectable()
export class TossImmediateAdapter implements ImmediatePaymentAdapter {
  private readonly logger = new Logger(TossImmediateAdapter.name);

  // TODO: 실제 구현 시 TossApiService 주입
  // constructor(private readonly tossApi: TossApiService) {}

  async process(
    request: ImmediatePaymentRequest,
  ): Promise<ImmediatePaymentResponse> {
    this.logger.log(
      `토스 즉시결제: ${request.paymentMethodId}, 금액: ${request.amount}`,
    );

    try {
      // Mock 지연
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: 실제 토스 API 호출 (승인+확정 동시)
      /*
      const cardMethod = await this.getCardMethod(request.paymentMethodId);
      const chargeResult = await this.tossApi.charge({
        billingKey: cardMethod.billingKey,
        amount: request.amount,
        currency: request.currency,
        orderName: request.orderName || '결제',
      });

      if (chargeResult.success) {
        return {
          success: true,
          transactionId: chargeResult.transactionId,
          metadata: {
            approvalNumber: chargeResult.approvalNumber,
            cardNumber: chargeResult.maskedCardNumber,
          }
        };
      }

      return {
        success: false,
        transactionId: '',
        error: chargeResult.errorMessage || '카드 결제에 실패했습니다',
      };
      */

      // MVP: Mock 응답 (즉시결제 시뮬레이션)
      const transactionId = `toss_charge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      return {
        success: true,
        transactionId,
        metadata: {
          approvalNumber: `${Math.floor(Math.random() * 100000000)}`,
          cardNumber: '**** **** **** 1234',
          chargedAt: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 즉시결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: '카드 결제 처리 중 오류가 발생했습니다',
      };
    }
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `토스 환불: ${request.transactionId}, 금액: ${request.amount}`,
    );

    try {
      // Mock 지연
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: 실제 토스 API 호출
      /*
      const refundResult = await this.tossApi.refund({
        transactionId: request.transactionId,
        amount: request.amount,
        reason: request.reason || '고객 요청',
      });

      if (refundResult.success) {
        return {
          success: true,
          refundId: refundResult.refundId,
          metadata: {
            refundedAt: refundResult.refundedAt,
            reason: request.reason,
          }
        };
      }

      return {
        success: false,
        refundId: '',
        error: refundResult.errorMessage || '카드 환불에 실패했습니다',
      };
      */

      // MVP: Mock 응답
      const refundId = `toss_refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      return {
        success: true,
        refundId,
        metadata: {
          refundedAt: new Date().toISOString(),
          reason: request.reason || '고객 요청',
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        error: '카드 환불 처리 중 오류가 발생했습니다',
      };
    }
  }
}
