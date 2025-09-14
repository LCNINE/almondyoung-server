import { Injectable, Logger } from '@nestjs/common';
import {
  CancelPort,
  CancelResult,
  RefundPort,
  RefundResult,
} from './payment-provider.interface';

// 토스 환불/취소에 필요한 Payload 타입 정의
export type TossRefundPayload = {
  paymentKey: string; // 환불/취소를 위한 필수 키
  reason: string;
  cancelAmount?: number; // 부분 환불 금액
  refundReceiveAccount?: {
    // 가상계좌 환불 시 필요
    bank: string;
    accountNumber: string;
    holderName: string;
  };
};

@Injectable()
export class TossRefundProvider
  implements
    RefundPort<TossRefundPayload>,
    CancelPort<{ paymentKey: string; reason: string }>
{
  private readonly logger = new Logger(TossRefundProvider.name);

  async refund(payload: TossRefundPayload): Promise<RefundResult> {
    this.logger.log(
      `➡️ 토스 환불 처리 시작 - PaymentKey: ${payload.paymentKey}`,
    );
    const response = await this.callTossCancelAPI(
      payload.paymentKey,
      payload.reason,
      {
        cancelAmount: payload.cancelAmount,
        refundReceiveAccount: payload.refundReceiveAccount,
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

  async cancel(payload: {
    paymentKey: string;
    reason: string;
  }): Promise<CancelResult> {
    this.logger.log(
      `➡️ 토스 결제 취소 시작 - PaymentKey: ${payload.paymentKey}`,
    );
    // 토스는 환불과 취소가 동일한 'cancel' API를 사용합니다.
    const response = await this.callTossCancelAPI(
      payload.paymentKey,
      payload.reason,
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
