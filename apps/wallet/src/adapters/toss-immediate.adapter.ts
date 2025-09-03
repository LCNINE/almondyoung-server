// adapters/toss-immediate.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentAdapter,
  AuthorizeRequest,
  AuthorizeResponse,
  CaptureRequest,
  CaptureResponse,
  RefundRequest,
  RefundResponse,
} from '../ports/payment-adapter.port';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';

/**
 * 토스 결제 어댑터
 * - 빌링키 결제: 저장된 빌링키로 즉시 결제 처리
 * - UI 리다이렉트: 토스 결제창으로 리다이렉트 후 콜백 처리
 * - 두 방식 모두 authorize에서 처리, capture는 상황에 따라 처리
 */
@Injectable()
export class TossImmediateAdapter implements PaymentAdapter {
  private readonly logger = new Logger(TossImmediateAdapter.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  // TODO: 실제 구현 시 TossApiService 주입

  /**
   * 토스 결제 승인
   * - BILLING 모드: 저장된 빌링키로 즉시 결제
   * - UI_REDIRECT 모드: 토스 결제창 URL 반환
   */
  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    const paymentMode = request.paymentMode || 'BILLING';
    this.logger.log(
      `토스 결제 (${paymentMode}): ${request.paymentMethodId}, 금액: ${request.amount}`,
    );

    try {
      if (paymentMode === 'UI_REDIRECT') {
        return await this.processRedirectPayment(request);
      } else {
        return await this.processBillingKeyPayment(request);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 결제 실패: ${errorMessage}`);

      return {
        success: false,
        error: '토스 결제 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * 빌링키 기반 즉시 결제
   */
  private async processBillingKeyPayment(
    request: AuthorizeRequest,
  ): Promise<AuthorizeResponse> {
    // 1. 카드 결제수단 정보 조회
    const [cardMethod] = await this.db.db
      .select()
      .from(schema.cardMethod)
      .where(eq(schema.cardMethod.id, request.paymentMethodId))
      .limit(1);

    if (!cardMethod || !cardMethod.billingKey) {
      return {
        success: false,
        error: '빌링키 정보를 찾을 수 없습니다',
      };
    }

    // 2. Mock 지연 (실제 토스 API 호출 시뮬레이션)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // TODO: 실제 토스 빌링키 결제 API 호출
    /*
    const chargeResult = await this.tossApi.charge({
      billingKey: cardMethod.billingKey,
      amount: request.amount,
      currency: request.currency,
      orderName: request.orderName || '결제',
    });

    if (chargeResult.success) {
      return {
        success: true,
        paymentType: 'IMMEDIATE',
        pgTransactionId: chargeResult.transactionId,
        metadata: {
          approvalNumber: chargeResult.approvalNumber,
          cardNumber: cardMethod.maskedCardNumber,
          billingKey: cardMethod.billingKey,
          chargedAt: new Date().toISOString(),
        },
      };
    }

    return {
      success: false,
      error: chargeResult.errorMessage || '빌링키 결제에 실패했습니다',
    };
    */

    // MVP: Mock 빌링키 결제 성공
    const pgTransactionId = `toss_billing_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return {
      success: true,
      paymentType: 'IMMEDIATE',
      pgTransactionId,
      metadata: {
        approvalNumber: `${Math.floor(Math.random() * 100000000)}`,
        cardNumber: cardMethod.maskedCardNumber,
        billingKey: cardMethod.billingKey,
        chargedAt: new Date().toISOString(),
        method: 'BILLING_KEY',
      },
    };
  }

  /**
   * UI 리다이렉트 결제
   */
  private async processRedirectPayment(
    request: AuthorizeRequest,
  ): Promise<AuthorizeResponse> {
    if (!request.callbackUrls) {
      return {
        success: false,
        error: 'UI 리다이렉트를 위한 콜백 URL이 필요합니다',
      };
    }

    // Mock 지연
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 1. 임시 결제 세션 생성 (실제로는 토스에서 제공하는 세션)
    const redirectSessionId = `toss_redirect_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // TODO: 실제 토스 결제창 생성 API 호출
    /*
    const paymentWidgetResult = await this.tossApi.createPaymentWidget({
      amount: request.amount,
      currency: request.currency,
      orderName: request.orderName || '결제',
      successUrl: request.callbackUrls.successUrl,
      failUrl: request.callbackUrls.failureUrl,
      cancelUrl: request.callbackUrls.cancelUrl,
    });

    if (paymentWidgetResult.success) {
      return {
        success: true,
        paymentType: 'REDIRECT',
        pgTransactionId: paymentWidgetResult.sessionId,
        redirectUrl: paymentWidgetResult.checkoutUrl,
        redirectParams: {
          clientKey: paymentWidgetResult.clientKey,
          customerKey: paymentWidgetResult.customerKey,
        },
        metadata: {
          sessionId: redirectSessionId,
          widgetType: 'TOSS_WIDGET',
        },
      };
    }

    return {
      success: false,
      error: paymentWidgetResult.errorMessage || '토스 결제창 생성에 실패했습니다',
    };
    */

    // MVP: Mock 리다이렉트 URL
    const mockRedirectUrl = `https://checkout.tosspayments.com/v2/checkout?sessionId=${redirectSessionId}&amount=${request.amount}`;

    return {
      success: true,
      paymentType: 'REDIRECT',
      pgTransactionId: redirectSessionId,
      redirectUrl: mockRedirectUrl,
      redirectParams: {
        clientKey: 'test_client_key',
        customerKey: (request.metadata?.userId as string) || 'unknown',
      },
      metadata: {
        sessionId: redirectSessionId,
        widgetType: 'TOSS_WIDGET',
        pendingAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 결제 확정
   * - 빌링키 결제: 이미 확정되었으므로 no-op
   * - UI 리다이렉트: 콜백 처리 및 최종 확정
   */
  async capture(request: CaptureRequest): Promise<CaptureResponse> {
    this.logger.log(`토스 결제 확정: ${request.pgTransactionId}`);

    try {
      // UI 리다이렉트 세션인지 확인
      if (request.pgTransactionId.startsWith('toss_redirect_')) {
        return await this.processRedirectCallback(request);
      }

      // 빌링키 결제는 이미 authorize에서 확정되었으므로 성공으로 반환
      return {
        success: true,
        pgTransactionId: request.pgTransactionId,
        metadata: {
          message: '빌링키 결제는 이미 확정되었습니다',
          capturedAt: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 결제 확정 실패: ${errorMessage}`);

      return {
        success: false,
        pgTransactionId: '',
        error: '토스 결제 확정 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * UI 리다이렉트 콜백 처리
   */
  private async processRedirectCallback(
    request: CaptureRequest,
  ): Promise<CaptureResponse> {
    // TODO: 실제 토스 결제 결과 검증
    /*
    const paymentResult = await this.tossApi.verifyPayment({
      sessionId: request.pgTransactionId,
      paymentKey: request.metadata?.paymentKey,
    });

    if (paymentResult.success) {
      return {
        success: true,
        pgTransactionId: paymentResult.transactionId,
        metadata: {
          approvalNumber: paymentResult.approvalNumber,
          cardNumber: paymentResult.maskedCardNumber,
          capturedAt: new Date().toISOString(),
          method: 'UI_REDIRECT',
        },
      };
    }

    return {
      success: false,
      pgTransactionId: '',
      error: paymentResult.errorMessage || 'UI 리다이렉트 결제 검증에 실패했습니다',
    };
    */

    // MVP: Mock 콜백 처리 성공
    const finalTransactionId = `toss_captured_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    await new Promise((resolve) => setTimeout(resolve, 50)); // Mock 지연

    return {
      success: true,
      pgTransactionId: finalTransactionId,
      metadata: {
        approvalNumber: `${Math.floor(Math.random() * 100000000)}`,
        cardNumber: '**** **** **** 1234',
        capturedAt: new Date().toISOString(),
        method: 'UI_REDIRECT',
        originalSessionId: request.pgTransactionId,
      },
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `토스 환불: ${request.pgTransactionId}, 금액: ${request.amount}`,
    );

    try {
      // Mock 지연
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: 실제 토스 API 호출
      /*
      const refundResult = await this.tossApi.refund({
        transactionId: request.pgTransactionId,
        amount: request.amount,
        reason: request.reason || '고객 요청',
      });

      if (refundResult.success) {
        return {
          success: true,
          refundId: refundResult.refundId,
          metadata: {
            refundedAt: refundResult.refundedAt,
            reason: request.reason,
          }
        };
      }

      return {
        success: false,
        refundId: '',
        error: refundResult.errorMessage || '카드 환불에 실패했습니다',
      };
      */

      // MVP: Mock 응답
      const pgTransactionId = `toss_refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      return {
        success: true,
        pgTransactionId,
        metadata: {
          refundedAt: new Date().toISOString(),
          reason: request.reason || '고객 요청',
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`토스 환불 실패: ${errorMessage}`);

      return {
        success: false,
        pgTransactionId: '',
        error: '카드 환불 처리 중 오류가 발생했습니다',
      };
    }
  }
}
