// providers/toss.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import { getTsid } from 'tsid-ts';
import {
  PaymentProvider,
  PaymentRequest,
  RefundRequest,
  PaymentType,
  PaymentProvider_ID,
} from './payment-provider.interface';
import {
  PaymentResult,
  RefundResult,
} from '../interfaces/payment-gateway.interface';

/**
 * 토스페이먼츠 Provider (Ephemeral 지원)
 * - 토스페이먼츠 API 연동 (Mock 구현)
 * - 일회성 결제 (Ephemeral) 지원
 * - paymentKey 기반 승인 확정
 */
@Injectable()
export class TossProvider implements PaymentProvider {
  private readonly logger = new Logger(TossProvider.name);

  readonly providerId: PaymentProvider_ID = 'TOSS';
  // supportedTypes 제거 - 정책 기반으로 결정

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `토스페이먼츠 결제 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // Ephemeral 지원: instrumentRef는 TOSS paymentKey
    if (request.instrumentType === 'ONE_TIME' && request.instrumentRef) {
      return this.processEphemeralPayment(request);
    }

    // Stored Profile 지원 (향후 구현)
    if (request.instrumentType === 'PROFILE' && request.profileId) {
      throw new Error('TOSS Stored Profile은 아직 구현되지 않았습니다');
    }

    throw new Error(
      'TOSS Provider: instrumentType 또는 instrumentRef가 필요합니다',
    );
  }

  /**
   * Ephemeral 결제 처리 (paymentKey 기반)
   */
  private async processEphemeralPayment(
    request: PaymentRequest,
  ): Promise<PaymentResult> {
    this.logger.log(
      `토스페이먼츠 Ephemeral 결제 - paymentKey: ${request.instrumentRef}`,
    );

    try {
      // 토스페이먼츠 결제 승인 확정 API 호출
      const confirmResponse = await this.callTossConfirmAPI(request);

      if (confirmResponse.success) {
        const result: PaymentResult = {
          success: true,
          transactionId: confirmResponse.data.lastTransactionKey,
          captureId: confirmResponse.data.lastTransactionKey, // 토스는 즉시 확정
          metadata: {
            provider: 'toss',
            apiMethod: 'confirm',
            paymentKey: confirmResponse.data.paymentKey,
            orderId: confirmResponse.data.orderId,
            approvedAt: confirmResponse.data.approvedAt,
            actualAmount: confirmResponse.data.totalAmount,
            suppliedAmount: confirmResponse.data.suppliedAmount,
            vat: confirmResponse.data.vat,
            paymentMethod: confirmResponse.data.method,
            status: confirmResponse.data.status,
            card: confirmResponse.data.card,
            easyPay: confirmResponse.data.easyPay,
            receipt: confirmResponse.data.receipt,
            rawResponse: confirmResponse.data,
          },
        };

        this.logger.log(
          `토스페이먼츠 결제 성공 - PaymentKey: ${request.instrumentRef}`,
        );
        return result;
      } else {
        this.logger.error(`토스페이먼츠 결제 실패: ${confirmResponse.error}`);
        return {
          success: false,
          transactionId: `TOSS_FAILED_${getTsid().toString()}`,
          error: confirmResponse.error,
          metadata: {
            provider: 'toss',
            apiMethod: 'confirm',
            paymentKey: request.instrumentRef,
            failedAt: new Date().toISOString(),
            errorMessage: confirmResponse.errorMessage,
          },
        };
      }
    } catch (error) {
      this.logger.error(`토스페이먼츠 API 호출 실패`, error);
      return {
        success: false,
        transactionId: `TOSS_FAILED_${getTsid().toString()}`,
        error: 'TOSS_API_ERROR',
        metadata: {
          provider: 'toss',
          apiMethod: 'confirm',
          paymentKey: request.instrumentRef,
          errorMessage: error.message,
        },
      };
    }
  }

  /**
   * 토스페이먼츠 결제 승인 확정 API 호출
   */
  private async callTossConfirmAPI(request: PaymentRequest): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    errorMessage?: string;
  }> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      throw new Error('TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다');
    }

    // 요청 본문 구성 (토스 공식 API 스펙에 맞게)
    const requestBody = {
      paymentKey: request.instrumentRef, // 필수
      orderId: request.metadata?.orderId || request.intentId, // 필수 (Intent ID를 orderId로 사용)
      amount: request.amount, // 필수
    };

    try {
      const response = await fetch(
        'https://api.tosspayments.com/v1/payments/confirm',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      );

      const responseData = await response.json();

      if (response.ok) {
        this.logger.log(
          '토스페이먼츠 승인 확정 API 성공:',
          JSON.stringify(responseData),
        );
        return { success: true, data: responseData };
      } else {
        this.logger.error(
          '토스페이먼츠 승인 확정 API 실패:',
          JSON.stringify(responseData),
        );
        return {
          success: false,
          error: responseData.code || 'TOSS_CONFIRM_FAILED',
          errorMessage: responseData.message || '토스페이먼츠 승인 확정 실패',
        };
      }
    } catch (error) {
      this.logger.error('토스페이먼츠 승인 확정 API 호출 중 오류:', error);
      throw error;
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `토스페이먼츠 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    try {
      // 토스페이먼츠 결제 취소 API 호출
      const cancelResponse = await this.callTossCancelAPI(request);

      if (cancelResponse.success) {
        const result: RefundResult = {
          success: true,
          refundId: request.refundId,
          refundedAmount: request.amount,
          pgTransactionId: cancelResponse.data.lastTransactionKey,
          metadata: {
            provider: 'toss',
            method: 'cancel',
            paymentKey: cancelResponse.data.paymentKey,
            originalTransactionId: request.originalTransactionId,
            canceledAt: cancelResponse.data.cancels[0]?.canceledAt,
            cancelReason: request.reason,
            cancelStatus: cancelResponse.data.cancels[0]?.cancelStatus,
            transactionKey: cancelResponse.data.cancels[0]?.transactionKey,
            receiptKey: cancelResponse.data.cancels[0]?.receiptKey,
            rawResponse: cancelResponse.data,
          },
        };

        this.logger.log(
          `토스페이먼츠 환불 성공 - RefundId: ${request.refundId}`,
        );
        return result;
      } else {
        this.logger.error(`토스페이먼츠 환불 실패: ${cancelResponse.error}`);
        return {
          success: false,
          refundId: request.refundId,
          refundedAmount: 0,
          error: cancelResponse.error,
          metadata: {
            provider: 'toss',
            errorMessage: cancelResponse.errorMessage,
            originalTransactionId: request.originalTransactionId,
          },
        };
      }
    } catch (error) {
      this.logger.error(`토스페이먼츠 환불 API 호출 실패`, error);
      return {
        success: false,
        refundId: request.refundId,
        refundedAmount: 0,
        error: 'TOSS_API_ERROR',
        metadata: {
          provider: 'toss',
          errorMessage: error.message,
          originalTransactionId: request.originalTransactionId,
        },
      };
    }
  }

  /**
   * 토스페이먼츠 결제 취소 API 호출
   */
  private async callTossCancelAPI(request: RefundRequest): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    errorMessage?: string;
  }> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      throw new Error('TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다');
    }

    // paymentKey 추출 (originalTransactionId에서 또는 metadata에서)
    const paymentKey = this.extractPaymentKey(request);
    if (!paymentKey) {
      throw new Error('PaymentKey를 찾을 수 없습니다');
    }

    // 요청 본문 구성 (최소 필수값만)
    const requestBody: any = {
      cancelReason: request.reason,
    };

    // 부분 취소인 경우 cancelAmount 추가
    if (request.amount && request.metadata?.totalAmount) {
      const totalAmount = request.metadata.totalAmount as number;
      if (request.amount < totalAmount) {
        requestBody.cancelAmount = request.amount;
      }
    }

    // 가상계좌 환불 계좌 정보 추가
    if (request.metadata?.refundReceiveAccount) {
      requestBody.refundReceiveAccount = request.metadata.refundReceiveAccount;
    }

    try {
      const response = await fetch(
        `https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      );

      const responseData = await response.json();

      if (response.ok) {
        this.logger.log(
          '토스페이먼츠 취소 API 성공:',
          JSON.stringify(responseData),
        );
        return { success: true, data: responseData };
      } else {
        this.logger.error(
          '토스페이먼츠 취소 API 실패:',
          JSON.stringify(responseData),
        );
        return {
          success: false,
          error: responseData.code || 'TOSS_CANCEL_FAILED',
          errorMessage: responseData.message || '토스페이먼츠 취소 실패',
        };
      }
    } catch (error) {
      this.logger.error('토스페이먼츠 취소 API 호출 중 오류:', error);
      throw error;
    }
  }

  /**
   * RefundRequest에서 paymentKey 추출
   */
  private extractPaymentKey(request: RefundRequest): string | null {
    // 1. metadata에서 paymentKey 찾기
    if (request.metadata?.paymentKey) {
      return request.metadata.paymentKey as string;
    }

    // 2. originalTransactionId가 TOSS_ 형태인 경우 추출
    if (request.originalTransactionId?.startsWith('TOSS_')) {
      // 실제로는 DB에서 paymentKey를 조회해야 함
      // 여기서는 간단히 originalTransactionId를 사용
      return request.originalTransactionId;
    }

    // 3. metadata의 rawResponse에서 찾기
    if (request.metadata?.rawResponse?.paymentKey) {
      return request.metadata.rawResponse.paymentKey as string;
    }

    return null;
  }
}
