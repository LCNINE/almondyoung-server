// providers/kakaopay.provider.ts

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
 * 카카오페이 Provider (Ephemeral 지원)
 * - 카카오페이 API 연동 (Mock 구현)
 * - 일회성 결제 (Ephemeral) 지원
 * - tid 기반 결제 승인
 */
@Injectable()
export class KakaopayProvider implements PaymentProvider {
  private readonly logger = new Logger(KakaopayProvider.name);

  readonly providerId: PaymentProvider_ID = 'KAKAOPAY';
  // supportedTypes 제거 - 정책 기반으로 결정

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `카카오페이 결제 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // Ephemeral 지원: instrumentRef는 KakaoPay tid
    if (request.instrumentType === 'ONE_TIME' && request.instrumentRef) {
      return this.processEphemeralPayment(request);
    }

    // Stored Profile 지원 (향후 구현)
    if (request.instrumentType === 'PROFILE' && request.profileId) {
      throw new Error('카카오페이 Stored Profile은 아직 구현되지 않았습니다');
    }

    throw new Error(
      '카카오페이 Provider: instrumentType 또는 instrumentRef가 필요합니다',
    );
  }

  /**
   * Ephemeral 결제 처리 (tid 기반)
   */
  private async processEphemeralPayment(
    request: PaymentRequest,
  ): Promise<PaymentResult> {
    this.logger.log(
      `카카오페이 Ephemeral 결제 - tid: ${request.instrumentRef}`,
    );

    try {
      // Mock: 카카오페이 결제 승인 API 호출
      // 실제로는 POST https://kapi.kakao.com/v1/payment/approve
      const mockTransactionId = `KAKAO_${getTsid().toString()}`;

      // 성공 시뮬레이션 (85% 확률)
      const isSuccess = Math.random() > 0.15;

      if (isSuccess) {
        const result: PaymentResult = {
          success: true,
          transactionId: mockTransactionId,
          metadata: {
            provider: 'kakaopay',
            method: 'ephemeral_approve',
            tid: request.instrumentRef,
            approvedAt: new Date().toISOString(),
            actualAmount: request.amount,
            paymentMethodType: 'MONEY', // 카카오머니
            itemName: request.metadata?.itemName || '상품명',
          },
        };

        this.logger.log(
          `카카오페이 결제 성공 - TransactionId: ${mockTransactionId}`,
        );
        return result;
      } else {
        // 실패 시뮬레이션
        this.logger.error(
          `카카오페이 결제 실패 - tid: ${request.instrumentRef}`,
        );
        return {
          success: false,
          transactionId: mockTransactionId,
          error: 'KAKAO_PAYMENT_FAILED',
          metadata: {
            provider: 'kakaopay',
            method: 'ephemeral_approve',
            tid: request.instrumentRef,
            failedAt: new Date().toISOString(),
            errorCode: 'PAYMENT_TIMEOUT',
          },
        };
      }
    } catch (error) {
      this.logger.error(`카카오페이 API 호출 실패`, error);
      return {
        success: false,
        transactionId: `KAKAO_FAILED_${getTsid().toString()}`,
        error: 'KAKAO_API_ERROR',
        metadata: {
          provider: 'kakaopay',
          method: 'ephemeral_approve',
          errorMessage: error.message,
        },
      };
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `카카오페이 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    try {
      // Mock: 카카오페이 환불 API 호출
      // 실제로는 POST https://kapi.kakao.com/v1/payment/cancel
      const mockRefundId = `KAKAO_REFUND_${getTsid().toString()}`;

      const result: RefundResult = {
        success: true,
        refundId: mockRefundId,
        refundedAmount: request.amount,
        pgTransactionId: mockRefundId,
        metadata: {
          provider: 'kakaopay',
          method: 'refund',
          originalTransactionId: request.originalTransactionId,
          refundedAt: new Date().toISOString(),
          refundReason: request.reason,
        },
      };

      this.logger.log(`카카오페이 환불 성공 - RefundId: ${mockRefundId}`);
      return result;
    } catch (error) {
      this.logger.error(`카카오페이 환불 실패`, error);
      return {
        success: false,
        refundId: `KAKAO_REFUND_FAILED_${getTsid().toString()}`,
        refundedAmount: 0,
        error: 'KAKAO_REFUND_FAILED',
        metadata: {
          provider: 'kakaopay',
          errorMessage: error.message,
        },
      };
    }
  }
}
