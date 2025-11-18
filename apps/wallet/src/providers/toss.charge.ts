import { Injectable, Logger } from '@nestjs/common';
import {
  ChargePort,
  PaymentError,
  PaymentResult,
  ProviderType,
  TossPayload,
} from './payment-provider.interface';

@Injectable()
export class TossChargeProvider implements ChargePort<ProviderType.TOSS> {
  private readonly logger = new Logger(TossChargeProvider.name);
  private readonly TOSS_API_URL = 'https://api.tosspayments.com/v1';

  /**
   * TossPayload를 받아 결제를 처리합니다.
   * oneTimeToken (paymentKey) 또는 billingKey를 기반으로 결제를 실행합니다.
   */
  async process(payload: TossPayload): Promise<PaymentResult> {
    // 1. 일회성 토큰(paymentKey)을 이용한 결제 승인
    if (payload.oneTimeToken) {
      this.logger.log(
        `➡️ 토스 일회성 결제 승인 요청 - OrderId: ${
          payload.metadata?.intentId ?? 'N/A'
        }`,
      );
      return this.confirmPayment(payload);
    }

    // 2. 빌링키를 이용한 결제
    if (payload.billingKey) {
      this.logger.log(
        `➡️ 토스 빌링키 결제 요청 - BillingKey: ${payload.billingKey.slice(
          -4,
        )}`,
      );
      // TODO: 실제 토스 빌링키 결제 API 연동 로직 구현 필요
      // 현재는 Mock 성공을 반환합니다.
      return {
        success: true,
        transactionId: `toss_billing_${Date.now()}`,
        code: 'SUCCESS_MOCKED',
        message: '토스 빌링키 결제 (Mock)',
      };
    }

    // 두 가지 필수 값 중 하나도 없으면 에러 처리
    throw new PaymentError(
      'INVALID_PAYLOAD',
      'TossPayload에는 oneTimeToken 또는 billingKey가 반드시 필요합니다.',
    );
  }

  /**
   * 토스페이먼츠의 '결제 승인 API'를 호출합니다.
   *
   * @docs https://docs.tosspayments.com/guides/v2/payment-widget/integration#결제-승인-api-호출하기
   * @private
   */
  private async confirmPayment(payload: TossPayload): Promise<PaymentResult> {
    // TODO: 개발자센터에 로그인해서 내 결제위젯 연동 키 > 시크릿 키를 입력하세요. 시크릿 키는 외부에 공개되면 안돼요.
    // @docs https://docs.tosspayments.com/reference/using-api/api-keys
    const secretKey =
      process.env.TOSS_SECRET_KEY || 'test_sk_ALnQvDd2VJxMDd5NLwna8Mj7X41m';

    if (!secretKey) {
      throw new PaymentError(
        'PROVIDER_CONFIG_ERROR',
        'TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다.',
      );
    }

    this.logger.log(`🔑 토스 시크릿 키 확인: ${secretKey.slice(-4)}****`);

    // 상위 서비스(Orchestrator)에서 intentId를 metadata로 넘겨주는 것이 이상적입니다.
    const orderId = payload.metadata?.intentId ?? `temp-order-${Date.now()}`;
    const paymentKey = payload.oneTimeToken!;
    const amount = payload.amount;

    // 토스페이먼츠 API는 시크릿 키를 사용자 ID로 사용하고, 비밀번호는 사용하지 않습니다.
    // 비밀번호가 없다는 것을 알리기 위해 시크릿 키 뒤에 콜론을 추가합니다.
    // @docs https://docs.tosspayments.com/reference/using-api/authorization#%EC%9D%B8%EC%A6%9D
    const encryptedSecretKey =
      'Basic ' + Buffer.from(secretKey + ':').toString('base64');

    try {
      // ------ 결제 승인 API 호출 ------
      // @docs https://docs.tosspayments.com/guides/v2/payment-widget/integration#결제-승인-api-호출하기
      const response = await fetch(`${this.TOSS_API_URL}/payments/confirm`, {
        method: 'POST',
        body: JSON.stringify({ orderId, amount, paymentKey }),
        headers: {
          Authorization: encryptedSecretKey,
          'Content-Type': 'application/json',
        },
      });

      const responseData = await response.json();

      // API 응답을 우리 시스템의 PaymentResult 형식으로 '번역'합니다.
      if (response.ok) {
        this.logger.log(`✅ 토스 결제 승인 성공 - OrderId: ${orderId}`);
        return {
          success: true,
          transactionId: responseData.paymentKey, // 고유 식별자로 paymentKey를 사용
          code: responseData.status, // 예: 'DONE', 'CANCELED' 등
          message: '토스페이먼츠 결제 승인 성공',
          raw: responseData, // 디버깅 및 추가 정보 저장을 위해 원본 응답 포함
        };
      } else {
        this.logger.warn(
          `⚠️ 토스 결제 승인 실패 - OrderId: ${orderId}, Code: ${responseData.code}, Msg: ${responseData.message}`,
        );
        return {
          success: false,
          code: responseData.code,
          message: responseData.message,
          raw: responseData,
        };
      }
    } catch (error: any) {
      this.logger.error(
        `❌ 토스 API 호출 중 예외 발생: ${error.message}`,
        error.stack,
      );
      // 네트워크 에러 등 예기치 못한 실패 처리
      throw new PaymentError(
        'PROVIDER_API_ERROR',
        `토스 API 요청 실패: ${error.message}`,
      );
    }
  }
}
