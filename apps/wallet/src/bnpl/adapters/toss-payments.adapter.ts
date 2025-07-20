import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProcessingPort,
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  PaymentStatusResponse,
} from '../../bnpl/ports/payment-ports';

/**
 * 토스페이먼츠 PG 어댑터
 *
 * 향후 토스페이먼츠 연동을 위한 어댑터
 * 현재는 목업 구현, 실제 연동 시 토스페이먼츠 API 사용
 */
@Injectable()
export class TossPaymentsAdapter implements PaymentProcessingPort {
  private readonly logger = new Logger(TossPaymentsAdapter.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    super();
    this.apiKey = process.env.TOSS_PAYMENTS_SECRET_KEY || 'test_sk_mock';
    this.baseUrl =
      process.env.TOSS_PAYMENTS_BASE_URL || 'https://api.tosspayments.com/v1';
    this.logger.log('토스페이먼츠 어댑터 초기화 완료');
  }

  /**
   * 토스페이먼츠 결제 요청
   */
  async charge(request: PaymentRequest): Promise<PaymentResponse> {
    this.logger.log(
      `토스페이먼츠 결제 요청: ${request.orderId}, 금액: ${request.amount}`,
    );

    try {
      // TODO: 실제 토스페이먼츠 API 호출
      // const response = await fetch(`${this.baseUrl}/payments/confirm`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({
      //     paymentKey: request.billingKey,
      //     orderId: request.orderId,
      //     amount: request.amount,
      //   }),
      // });

      // 임시로 목업 응답 생성
      const mockResponse = {
        transactionId: `TOSS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'SUCCESS' as const,
        message: '토스페이먼츠 결제 성공',
        capturedAt: new Date(),
        rawResponse: {
          paymentKey: `payment_${Date.now()}`,
          orderId: request.orderId,
          amount: request.amount,
          status: 'DONE',
          requestedAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          method: {
            type: 'CARD',
            card: {
              company: 'MOCK_CARD',
              number: '****-****-****-1234',
            },
          },
        },
      };

      this.logger.log(`토스페이먼츠 결제 성공: ${mockResponse.transactionId}`);
      return mockResponse;
    } catch (error) {
      this.logger.error(`토스페이먼츠 결제 실패: ${error.message}`);

      return {
        transactionId: '',
        status: 'FAILURE',
        message: error.message,
        rawResponse: { error: error.message },
      };
    }
  }

  /**
   * 토스페이먼츠 환불
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `토스페이먼츠 환불 요청: ${request.transactionId}, 금액: ${request.amount}`,
    );

    try {
      // TODO: 실제 토스페이먼츠 환불 API 호출
      // const response = await fetch(`${this.baseUrl}/payments/${request.transactionId}/cancel`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({
      //     cancelReason: request.reason,
      //     cancelAmount: request.amount,
      //   }),
      // });

      // 임시로 목업 응답 생성
      const mockResponse = {
        refundId: `TOSS_REFUND_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'SUCCESS' as const,
        message: '토스페이먼츠 환불 성공',
        rawResponse: {
          paymentKey: request.transactionId,
          cancelAmount: request.amount,
          cancelReason: request.reason,
          canceledAt: new Date().toISOString(),
          status: 'CANCELED',
        },
      };

      this.logger.log(`토스페이먼츠 환불 성공: ${mockResponse.refundId}`);
      return mockResponse;
    } catch (error) {
      this.logger.error(`토스페이먼츠 환불 실패: ${error.message}`);

      return {
        refundId: '',
        status: 'FAILURE',
        message: error.message,
        rawResponse: { error: error.message },
      };
    }
  }

  /**
   * 토스페이먼츠 결제 상태 조회
   */
  async getPaymentStatus(
    transactionId: string,
  ): Promise<PaymentStatusResponse> {
    this.logger.log(`토스페이먼츠 결제 상태 조회: ${transactionId}`);

    try {
      // TODO: 실제 토스페이먼츠 상태 조회 API 호출
      // const response = await fetch(`${this.baseUrl}/payments/${transactionId}`, {
      //   method: 'GET',
      //   headers: {
      //     'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      //   },
      // });

      // 임시로 목업 응답 생성
      const mockResponse = {
        transactionId,
        status: 'CAPTURED' as const,
        amount: 50000, // 임시 금액
        capturedAt: new Date(),
        rawResponse: {
          paymentKey: transactionId,
          orderId: `ORDER_${Date.now()}`,
          status: 'DONE',
          totalAmount: 50000,
          approvedAt: new Date().toISOString(),
          method: {
            type: 'CARD',
          },
        },
      };

      this.logger.log(
        `토스페이먼츠 결제 상태 조회 성공: ${transactionId} - ${mockResponse.status}`,
      );
      return mockResponse;
    } catch (error) {
      this.logger.error(
        `토스페이먼츠 결제 상태 조회 실패: ${transactionId} - ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 토스페이먼츠 연결 상태 확인
   */
  async healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }> {
    try {
      // TODO: 실제 토스페이먼츠 연결 확인
      // const response = await fetch(`${this.baseUrl}/brandpay/payments/status`, {
      //   method: 'GET',
      //   headers: {
      //     'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      //   },
      // });

      return {
        status: 'ok',
        message: '토스페이먼츠 연결 정상',
      };
    } catch (error) {
      this.logger.error(`토스페이먼츠 연결 확인 실패: ${error.message}`);

      return {
        status: 'error',
        message: `토스페이먼츠 연결 실패: ${error.message}`,
      };
    }
  }
}
