import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, ApiClientFactory } from 'hms-api-wrapper'; // 실제 라이브러리 경로로 수정하세요
import {
  CancelPort,
  CancelResult,
  RefundPort,
  RefundResult,
} from './payment-provider.interface';

// 환불/취소에 필요한 정보를 담는 Payload 타입 정의
export type HmsRefundPayload = {
  transactionId: string; // 원거래 ID
  amount: number; // 환불 금액 (전액환불 시 원거래금액)
  reason?: string;
};

export type HmsCancelPayload = {
  transactionId: string; // 원거래 ID
  reason?: string;
};

@Injectable()
export class HmsCardRefundProvider
  implements RefundPort<HmsRefundPayload>, CancelPort<HmsCancelPayload>
{
  private readonly logger = new Logger(HmsCardRefundProvider.name);
  private readonly hmsApi: HmsAPI;

  constructor() {
    this.hmsApi = ApiClientFactory.create({
      swKey: process.env.SW_KEY || '',
      custKey: process.env.CUST_KEY || '',
      isTest: process.env.NODE_ENV !== 'production',
      useMock: false,
    }) as HmsAPI;
  }

  /**
   * 정산 완료 후의 '환불'을 처리합니다.
   * @param payload 환불 요청 정보
   */
  async refund(payload: HmsRefundPayload): Promise<RefundResult> {
    this.logger.log(
      `➡️ HMS 카드 환불 - TxId: ${payload.transactionId}, Amount: ${payload.amount}`,
    );

    try {
      // HMS API의 cancelTransaction이 환불도 처리한다고 가정
      const resp = await this.hmsApi.paymentTransactions.cancelTransaction(
        payload.transactionId,
        // 필요하다면 부분환불을 위해 금액과 같은 추가 파라미터를 넘깁니다.
        // { cancelAmount: payload.amount, reason: payload.reason }
      );

      const success = resp.payment.result.flag === 'SUCCESS'; // 실제 응답값에 맞게 수정
      return {
        success,
        refundId: resp.payment.transactionId, // 환불 거래 ID
        code: success ? 'REFUND_SUCCESS' : 'REFUND_FAILED',
        message: resp.payment.result.message,
        raw: resp,
      };
    } catch (error: any) {
      this.logger.error(`❌ HMS 카드 환불 실패: ${error.message}`, error.stack);
      return {
        success: false,
        code: 'HMS_API_ERROR',
        message: `HMS API 연동 실패: ${error.message}`,
        raw: error,
      };
    }
  }

  /**
   * 당일 결제 건에 대한 '취소'를 처리합니다.
   * @param payload 취소 요청 정보
   */
  async cancel(payload: HmsCancelPayload): Promise<CancelResult> {
    this.logger.log(`➡️ HMS 카드 취소 - TxId: ${payload.transactionId}`);

    // 만약 HMS API가 취소와 환불을 동일한 API로 처리한다면,
    // 내부적으로 refund 메서드를 호출하여 코드를 재사용할 수 있습니다.
    // 이 때, '전액 환불'을 의미하도록 원거래 금액을 조회해서 넘겨주어야 합니다.
    // 여기서는 설명을 위해 refund 로직을 그대로 사용하겠습니다.

    try {
      const resp = await this.hmsApi.paymentTransactions.cancelTransaction(
        payload.transactionId,
        // { reason: payload.reason }
      );

      const success = resp.payment.result.flag === 'SUCCESS';
      return {
        success,
        cancelId: resp.payment.transactionId, // 취소 거래 ID
        code: success ? 'CANCEL_SUCCESS' : 'CANCEL_FAILED',
        message: resp.payment.result.message,
        raw: resp,
      };
    } catch (error: any) {
      this.logger.error(`❌ HMS 카드 취소 실패: ${error.message}`, error.stack);
      return {
        success: false,
        code: 'HMS_API_ERROR',
        message: `HMS API 연동 실패: ${error.message}`,
        raw: error,
      };
    }
  }
}
