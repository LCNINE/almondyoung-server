// services/payment-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentAdapter } from '../ports/payment-adapter.port';
import { TossImmediateAdapter } from '../adapters/toss-immediate.adapter';
import { BnplDeferredAdapter } from '../adapters/bnpl-deferred.adapter';
import { PointAdapter } from '../adapters/point.adapter';
import { IdempotencyService } from './Idempotency.service';
import {
  PaymentSessionNotFoundError,
  PaymentMethodNotFoundError,
  InvalidPaymentAmountError,
  PaymentSessionAlreadyProcessedError,
  InactivePaymentMethodError,
  UnsupportedPaymentMethodError,
  ImmediatePaymentFailedError,
  DeferredPaymentAuthorizationFailedError,
  DeferredPaymentCaptureFailedError,
} from '../shared/errors/payment.errors';

export interface PaymentRequest {
  sessionId: string;
  paymentMethods: PaymentMethodRequest[];
  usePoints?: number; // 포인트 사용량
  metadata?: Record<string, any>;
}

export interface PaymentMethodRequest {
  paymentMethodId: string;
  amount: number;
}

export interface PaymentResponse {
  success: boolean;
  paymentId: string;
  sessionId: string;
  totalAmount: number;
  results: {
    immediate?: Array<{
      methodId: string;
      transactionId: string;
      amount: number;
    }>;
    deferred?: Array<{
      methodId: string;
      authorizationId: string;
      amount: number;
    }>;
    points?: { amount: number; transactionId: string };
  };
  error?: string;
}

/**
 * 통합된 결제 서비스 (V2)
 * - 모든 결제수단이 PaymentAdapter 인터페이스를 구현
 * - 즉시결제(카드,포인트): authorize에서 승인+확정 동시 처리
 * - 후불결제(BNPL): authorize는 승인만, capture는 실제 출금
 */
@Injectable()
export class PaymentServiceV2 {
  private readonly logger = new Logger(PaymentServiceV2.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly tossImmediateAdapter: TossImmediateAdapter,
    private readonly bnplDeferredAdapter: BnplDeferredAdapter,
    private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 결제수단별 어댑터 선택
   */
  private getAdapter(methodType: string): PaymentAdapter {
    switch (methodType) {
      case 'CARD':
        return this.tossImmediateAdapter;
      case 'BNPL':
        return this.bnplDeferredAdapter;
      case 'REWARD_POINT':
        return this.pointAdapter;
      default:
        throw new UnsupportedPaymentMethodError(
          `지원하지 않는 결제수단: ${methodType}`,
        );
    }
  }

  /**
   * 혼합 결제 처리
   * - 포인트 + 카드 OR 포인트 + BNPL만 허용
   * - 카드 + BNPL 조합은 금지
   */
  async processPayment(paymentData: PaymentRequest): Promise<PaymentResponse> {
    const { sessionId, paymentMethods, usePoints, metadata } = paymentData;

    this.logger.log(
      `🚀 결제 처리 시작: ${sessionId}, 결제수단: ${paymentMethods.length}개, 포인트: ${usePoints || 0}`,
    );

    // 1. 결제 세션 조회
    const [session] = await this.db.db
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new PaymentSessionNotFoundError(
        `결제 세션을 찾을 수 없습니다: ${sessionId}`,
      );
    }

    if (session.status !== 'PENDING') {
      throw new PaymentSessionAlreadyProcessedError(
        `이미 처리된 세션입니다: ${session.status}`,
      );
    }

    // 2. 혼합결제 규칙 검증: 최대 1개 결제수단 + 선택적 포인트
    if (paymentMethods.length > 1) {
      throw new Error(
        '혼합결제는 최대 1개의 결제수단(카드 OR BNPL)만 허용됩니다',
      );
    }

    // 3. 총 금액 검증
    const totalMethodAmount = paymentMethods.reduce(
      (sum, pm) => sum + pm.amount,
      0,
    );
    const totalRequest = totalMethodAmount + (usePoints || 0);
    const sessionAmount = Number(session.amount); // DB의 numeric 타입 변환

    this.logger.debug(`금액 검증: 세션=${sessionAmount}, 요청=${totalRequest}`);

    if (sessionAmount !== totalRequest) {
      throw new InvalidPaymentAmountError(totalRequest, sessionAmount);
    }

    // 4. 결제 실행
    const immediateResults: Array<{
      methodId: string;
      transactionId: string;
      amount: number;
    }> = [];
    const deferredResults: Array<{
      methodId: string;
      authorizationId: string;
      amount: number;
    }> = [];
    let pointResults: { amount: number; transactionId: string } | null = null;

    // 포인트 사용 처리 (통합된 PaymentAdapter 방식)
    if (usePoints && usePoints > 0) {
      try {
        const pointResult = await this.pointAdapter.authorize({
          paymentMethodId: 'points', // 포인트는 특별한 ID 사용
          amount: usePoints,
          currency: session.currency,
          metadata: { ...metadata, sessionId },
        });

        if (pointResult.success) {
          pointResults = {
            amount: usePoints,
            transactionId: pointResult.pgTransactionId || '',
          };
        } else {
          this.logger.error('포인트 사용 실패:', pointResult.error);
          // 포인트 실패는 전체 결제를 실패시키지 않고 무시 (선택적)
        }
      } catch (error) {
        this.logger.error('포인트 처리 중 오류:', error);
        // 포인트 오류는 전체 결제를 실패시키지 않음
      }
    }

    // 결제수단별 처리
    for (const { paymentMethodId, amount } of paymentMethods) {
      // 결제수단 조회
      const [method] = await this.db.db
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, paymentMethodId))
        .limit(1);

      if (!method) {
        throw new PaymentMethodNotFoundError(
          `결제수단을 찾을 수 없습니다: ${paymentMethodId}`,
        );
      }

      if (method.status !== 'ACTIVE') {
        throw new InactivePaymentMethodError(
          `비활성화된 결제수단입니다: ${paymentMethodId}`,
        );
      }

      // 통합된 어댑터 사용
      const adapter = this.getAdapter(method.methodType);

      // 모든 어댑터는 authorize 메서드 호출
      const result = await adapter.authorize({
        paymentMethodId,
        amount,
        currency: session.currency,
        metadata: { ...metadata, sessionId },
      });

      if (result.success) {
        // 결제수단 타입에 따라 결과 분류
        if (
          method.methodType === 'CARD' ||
          method.methodType === 'REWARD_POINT'
        ) {
          // 즉시결제 (카드, 포인트)
          immediateResults.push({
            methodId: paymentMethodId,
            transactionId: result.pgTransactionId || '',
            amount,
          });
        } else if (method.methodType === 'BNPL') {
          // 후불결제 (BNPL)
          deferredResults.push({
            methodId: paymentMethodId,
            authorizationId:
              result.authorizationId || result.pgTransactionId || '',
            amount,
          });
        }
      } else {
        // 결제수단 타입에 따른 에러 처리
        if (
          method.methodType === 'CARD' ||
          method.methodType === 'REWARD_POINT'
        ) {
          throw new ImmediatePaymentFailedError(
            `즉시결제 실패(${method.methodType}): ${result.error}`,
          );
        } else if (method.methodType === 'BNPL') {
          throw new DeferredPaymentAuthorizationFailedError(
            `후불결제 승인 실패: ${result.error}`,
          );
        }
      }
    }

    // 5. 결제 완료 상태 업데이트
    await this.db.db
      .update(schema.paymentSessions)
      .set({
        status: 'CAPTURED',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentSessions.id, sessionId));

    const paymentId = `payment_${Date.now()}`;

    this.logger.log(
      `✅ 결제 완료: ${paymentId}, 즉시: ${immediateResults.length}, 후불: ${deferredResults.length}, 포인트: ${pointResults?.amount || 0}`,
    );

    return {
      success: true,
      paymentId,
      sessionId,
      totalAmount: sessionAmount,
      results: {
        immediate: immediateResults.length > 0 ? immediateResults : undefined,
        deferred: deferredResults.length > 0 ? deferredResults : undefined,
        points: pointResults || undefined,
      },
    };
  }

  /**
   * 후불결제 확정 (BNPL 전용)
   */
  async captureDeferred(
    authorizationId: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    this.logger.log(`후불결제 확정: ${authorizationId}`);

    try {
      const adapter = this.bnplDeferredAdapter;
      const result = await adapter.capture({
        pgTransactionId: authorizationId,
        amount: 0, // 승인된 금액 그대로 사용
      });

      if (result.success) {
        return {
          success: true,
          message: `후불결제 확정 완료: ${result.pgTransactionId}`,
        };
      } else {
        throw new DeferredPaymentCaptureFailedError(
          `후불결제 확정 실패: ${result.error}`,
        );
      }
    } catch (error) {
      if (error instanceof DeferredPaymentCaptureFailedError) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`후불결제 확정 중 오류: ${errorMessage}`);
      throw new DeferredPaymentCaptureFailedError(
        `후불결제 확정 처리 중 오류가 발생했습니다`,
      );
    }
  }
}
