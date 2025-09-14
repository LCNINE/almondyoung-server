import { Injectable, Logger } from '@nestjs/common';
import {
  ChargePort,
  PaymentResult,
  ProviderType,
  TossPayload,
} from './payment-provider.interface';

@Injectable()
export class TossChargeProvider implements ChargePort<ProviderType.TOSS> {
  private readonly logger = new Logger(TossChargeProvider.name);

  async process(payload: TossPayload): Promise<PaymentResult> {
    this.logger.log(`➡️ 토스 결제 처리 시작 - Amount: ${payload.amount}KRW`);

    try {
      // 1. 빌링키를 이용한 결제
      if (payload.billingKey) {
        this.logger.log(`토스 빌링키 결제 - BillingKey: ${payload.billingKey}`);
        // TODO: 실제 토스 빌링키 결제 API 호출 로직 구현
        // 현재는 Mock 처리
        const transactionId = `TOSS_BILLING_${Date.now()}`;
        return {
          success: true,
          transactionId,
          code: 'SUCCESS',
          message: '토스 빌링키 결제 성공',
          raw: { billingKey: payload.billingKey },
        };
      }

      // 2. 일회성 토큰(paymentKey)을 이용한 결제 승인
      if (payload.oneTimeToken) {
        this.logger.log(
          `토스 일회성 결제 승인 - Token: ${payload.oneTimeToken}`,
        );
        return await this.confirmPayment(
          payload.oneTimeToken,
          payload.amount,
          payload.metadata,
        );
      }

      throw new Error(
        'TossPayload에는 billingKey 또는 oneTimeToken이 필요합니다.',
      );
    } catch (error: any) {
      this.logger.error(`❌ 토스 결제 실패: ${error.message}`, error.stack);
      return {
        success: false,
        code: 'TOSS_PAYMENT_ERROR',
        message: `토스 결제 실패: ${error.message}`,
        raw: error,
      };
    }
  }

  /**
   * 토스페이먼츠 결제 승인 API를 호출하여 최종 결제를 완료합니다.
   * @param paymentKey 프론트에서 전달받은 일회성 결제 키
   * @param amount 검증할 결제 금액
   * @param metadata 주문 ID 등 추가 정보
   */
  private async confirmPayment(
    paymentKey: string,
    amount: number,
    metadata: any,
  ): Promise<PaymentResult> {
    const orderId = metadata?.orderId ?? `TOSS_ORDER_${Date.now()}`;
    const response = await this.callTossConfirmAPI({
      paymentKey,
      amount,
      orderId,
    });

    if (response.success) {
      return {
        success: true,
        transactionId: response.data.lastTransactionKey,
        code: 'SUCCESS',
        message: '토스페이먼츠 결제 성공',
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
   * 외부 API 호출을 담당하는 private 메서드
   */
  private async callTossConfirmAPI(payload: {
    paymentKey: string;
    amount: number;
    orderId: string;
  }): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    errorMessage?: string;
  }> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');

    const response = await fetch(
      'https://api.tosspayments.com/v1/payments/confirm',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentKey: payload.paymentKey,
          orderId: payload.orderId,
          amount: payload.amount,
        }),
      },
    );

    const responseData = await response.json();
    if (response.ok) {
      return { success: true, data: responseData };
    } else {
      return {
        success: false,
        error: responseData.code || 'TOSS_CONFIRM_FAILED',
        errorMessage: responseData.message || '토스페이먼츠 승인 실패',
      };
    }
  }
}
