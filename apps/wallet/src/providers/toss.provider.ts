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
  readonly supportedTypes: PaymentType[] = ['ORDER'];

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `토스페이먼츠 결제 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // Ephemeral 지원: instrumentRef는 TOSS paymentKey
    if (request.instrumentKind === 'EPHEMERAL' && request.instrumentRef) {
      return this.processEphemeralPayment(request);
    }

    // Stored Profile 지원 (향후 구현)
    if (request.instrumentKind === 'STORED' && request.profileId) {
      throw new Error('TOSS Stored Profile은 아직 구현되지 않았습니다');
    }

    throw new Error(
      'TOSS Provider: instrumentKind 또는 instrumentRef가 필요합니다',
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
      // Mock: 토스페이먼츠 결제 승인 확정 API 호출
      // 실제로는 POST https://api.tosspayments.com/v1/payments/confirm
      const mockTransactionId = `TOSS_${getTsid().toString()}`;

      // 성공 시뮬레이션 (90% 확률)
      const isSuccess = Math.random() > 0.1;

      if (isSuccess) {
        const result: PaymentResult = {
          success: true,
          transactionId: mockTransactionId,
          metadata: {
            provider: 'toss',
            method: 'ephemeral_confirm',
            paymentKey: request.instrumentRef,
            approvedAt: new Date().toISOString(),
            actualAmount: request.amount,
            fee: Math.floor(request.amount * 0.029), // 2.9% 수수료
          },
        };

        this.logger.log(
          `토스페이먼츠 결제 성공 - TransactionId: ${mockTransactionId}`,
        );
        return result;
      } else {
        // 실패 시뮬레이션
        this.logger.error(
          `토스페이먼츠 결제 실패 - paymentKey: ${request.instrumentRef}`,
        );
        return {
          success: false,
          transactionId: mockTransactionId,
          error: 'TOSS_PAYMENT_FAILED',
          metadata: {
            provider: 'toss',
            method: 'ephemeral_confirm',
            paymentKey: request.instrumentRef,
            failedAt: new Date().toISOString(),
            errorCode: 'INSUFFICIENT_BALANCE',
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
          method: 'ephemeral_confirm',
          errorMessage: error.message,
        },
      };
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `토스페이먼츠 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    try {
      // Mock: 토스페이먼츠 환불 API 호출
      // 실제로는 POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel
      const mockRefundId = `TOSS_REFUND_${getTsid().toString()}`;

      const result: RefundResult = {
        success: true,
        refundId: mockRefundId,
        refundedAmount: request.amount,
        pgTransactionId: mockRefundId,
        metadata: {
          provider: 'toss',
          method: 'refund',
          originalTransactionId: request.originalTransactionId,
          refundedAt: new Date().toISOString(),
          refundReason: request.reason,
        },
      };

      this.logger.log(`토스페이먼츠 환불 성공 - RefundId: ${mockRefundId}`);
      return result;
    } catch (error) {
      this.logger.error(`토스페이먼츠 환불 실패`, error);
      return {
        success: false,
        refundId: `TOSS_REFUND_FAILED_${getTsid().toString()}`,
        refundedAmount: 0,
        error: 'TOSS_REFUND_FAILED',
        metadata: {
          provider: 'toss',
          errorMessage: error.message,
        },
      };
    }
  }
}
