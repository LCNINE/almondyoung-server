import { Injectable, Logger } from '@nestjs/common';
import {
  CancelPort,
  CancelResult,
  CancelRequest,
  RefundPort,
  RefundResult,
  RefundRequest,
  PaymentError,
} from './payment-provider.interface';

@Injectable()
export class TossRefundProvider implements RefundPort, CancelPort {
  private readonly logger = new Logger(TossRefundProvider.name);

  /**
   * ✨ [CTO 스타일] 공통 RefundRequest를 받아서 Toss 전용 DTO로 변환
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    // Toss는 paymentKey가 필수
    if (!request.paymentKey) {
      throw new PaymentError(
        'INVALID_REFUND_REQUEST',
        'Toss refund requires paymentKey.',
      );
    }

    this.logger.log(
      `➡️ 토스 환불 처리 시작 - PaymentKey: ${request.paymentKey}`,
    );
    const response = await this.callTossCancelAPI(
      request.paymentKey,
      request.reason,
      {
        cancelAmount: request.amount,
      },
    );

    if (response.success) {
      return {
        success: true,
        refundId: response.data.cancels[0]?.transactionKey,
        code: 'REFUND_SUCCESS',
        message: '토스 환불 성공',
        raw: response.data,
      };
    } else {
      return {
        success: false,
        code: response.error,
        message: response.errorMessage,
        raw: response,
      };
    }
  }

  /**
   * ✨ [CTO 스타일] 공통 CancelRequest를 받아서 Toss 전용 DTO로 변환
   */
  async cancel(request: CancelRequest): Promise<CancelResult> {
    // Toss는 paymentKey가 필수
    if (!request.paymentKey) {
      throw new PaymentError(
        'INVALID_CANCEL_REQUEST',
        'Toss cancel requires paymentKey.',
      );
    }

    this.logger.log(
      `➡️ 토스 결제 취소 시작 - PaymentKey: ${request.paymentKey}`,
    );
    // 토스는 환불과 취소가 동일한 'cancel' API를 사용합니다.
    const response = await this.callTossCancelAPI(
      request.paymentKey,
      request.reason,
    );

    if (response.success) {
      return {
        success: true,
        cancelId: response.data.cancels[0]?.transactionKey,
        code: 'CANCEL_SUCCESS',
        message: '토스 결제 취소 성공',
        raw: response.data,
      };
    } else {
      return {
        success: false,
        code: response.error,
        message: response.errorMessage,
        raw: response,
      };
    }
  }

  private async callTossCancelAPI(
    paymentKey: string,
    reason: string,
    options: Record<string, any> = {},
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    errorMessage?: string;
  }> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');

    const response = await fetch(
      `https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cancelReason: reason, ...options }),
      },
    );

    const responseData = await response.json();
    if (response.ok) {
      return { success: true, data: responseData };
    } else {
      return {
        success: false,
        error: responseData.code || 'TOSS_CANCEL_FAILED',
        errorMessage: responseData.message || '토스페이먼츠 취소 실패',
      };
    }
  }
}
