import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, ApiClientFactory } from 'hms-api-wrapper'; // 실제 라이브러리 경로로 수정하세요
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
export class HmsCardRefundProvider implements RefundPort, CancelPort {
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
   * ✨ [CTO 스타일] 공통 RefundRequest를 받아서 HMS 전용 DTO로 변환
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    // HMS는 transactionId와 amount가 필수
    if (!request.transactionId || !request.amount) {
      throw new PaymentError(
        'INVALID_REFUND_REQUEST',
        'HMS refund requires transactionId and amount.',
      );
    }

    this.logger.log(
      `➡️ HMS 카드 환불 - TxId: ${request.transactionId}, Amount: ${request.amount}`,
    );

    try {
      // HMS API의 cancelTransaction이 환불도 처리한다고 가정
      const resp = await this.hmsApi.paymentTransactions.cancelTransaction(
        request.transactionId,
        // 필요하다면 부분환불을 위해 금액과 같은 추가 파라미터를 넘깁니다.
        // { cancelAmount: request.amount, reason: request.reason }
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
   * ✨ [CTO 스타일] 공통 CancelRequest를 받아서 HMS 전용 DTO로 변환
   */
  async cancel(request: CancelRequest): Promise<CancelResult> {
    // HMS는 transactionId가 필수
    if (!request.transactionId) {
      throw new PaymentError(
        'INVALID_CANCEL_REQUEST',
        'HMS cancel requires transactionId.',
      );
    }

    this.logger.log(`➡️ HMS 카드 취소 - TxId: ${request.transactionId}`);

    try {
      const resp = await this.hmsApi.paymentTransactions.cancelTransaction(
        request.transactionId,
        // { reason: request.reason }
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
