// services/payment-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
// import { createHash } from 'crypto';
import { ImmediatePaymentAdapter } from '../ports/immediate-payment.port';
import { DeferredPaymentAdapter } from '../ports/deferred-payment.port';
import { TossImmediateAdapter } from '../adapters/toss-immediate.adapter';
import { BnplDeferredAdapter } from '../adapters/bnpl-deferred.adapter';
import { PointsService } from './point.service';
import { IdempotencyService } from './Idempotency.service';
import {
  PaymentSessionNotFoundError,
  PaymentMethodNotFoundError,
  PaymentEventNotFoundError,
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
    points?: { amount: number; newBalance: number };
  };
  error?: string;
}

/**
 * 개선된 결제 서비스 (V2)
 * - 포인트: 별도 차감 처리 (결제수단이 아님)
 * - 즉시결제: authorize+capture 통합
 * - 후불결제: authorize/capture 분리
 */
@Injectable()
export class PaymentServiceV2 {
  private readonly logger = new Logger(PaymentServiceV2.name);
  private readonly immediateAdapters: Map<string, ImmediatePaymentAdapter> =
    new Map();
  private readonly deferredAdapters: Map<string, DeferredPaymentAdapter> =
    new Map();

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly tossImmediateAdapter: TossImmediateAdapter,
    private readonly bnplDeferredAdapter: BnplDeferredAdapter,
    private readonly pointsService: PointsService,
  ) {
    // 즉시결제 어댑터 등록
    this.immediateAdapters.set('CARD', this.tossImmediateAdapter);

    // 후불결제 어댑터 등록
    this.deferredAdapters.set('BNPL', this.bnplDeferredAdapter);

    this.logger.log('PaymentServiceV2 초기화 완료');
  }

  /**
   * 혼합 결제 처리 (V2)
   * - 포인트 + 카드 혼합결제
   * - 포인트 + BNPL 혼합결제
   * - 단일 결제수단만 (카드+BNPL 조합 불가)
   */
  async processPayment(
    request: PaymentRequest,
    idemKey?: string,
  ): Promise<PaymentResponse> {
    this.logger.log(
      `혼합 결제 시작: sessionId=${request.sessionId}, methods=${request.paymentMethods.length}, points=${request.usePoints || 0}`,
    );

    // 멱등성을 위한 요청 해시는 필요시에만 생성
    // const requestHash = ...

    return this.db.db.transaction(async (tx) => {
      // 1. 멱등성 처리
      if (idemKey) {
        const idem = await this.idempotency.checkOrCreate<PaymentResponse>(
          tx,
          idemKey,
          request,
          '/payments/process',
        );
        if (idem.hit) {
          this.logger.log(`멱등성 히트: ${idemKey}`);
          return idem.response!;
        }
      }

      // 2. 결제 세션 조회
      const [session] = await tx
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, request.sessionId))
        .limit(1);

      if (!session) {
        throw new PaymentSessionNotFoundError(request.sessionId);
      }

      if (session.status !== 'PENDING') {
        throw new PaymentSessionAlreadyProcessedError(session.status);
      }

      // 3. 혼합결제 유효성 검증
      const paymentMethodCount = request.paymentMethods.length;
      const pointsAmount = request.usePoints || 0;

      // 혼합결제 규칙: 최대 1개 결제수단 + 포인트 선택사항
      if (paymentMethodCount > 1) {
        throw new Error(
          '혼합결제는 최대 1개의 결제수단만 사용할 수 있습니다 (카드+BNPL 조합 불가)',
        );
      }

      if (paymentMethodCount === 0 && pointsAmount === 0) {
        throw new Error('최소 하나의 결제수단이나 포인트를 선택해야 합니다');
      }

      // 4. 금액 검증
      const methodsTotal = request.paymentMethods.reduce(
        (sum, method) => sum + method.amount,
        0,
      );
      const totalRequest = methodsTotal + pointsAmount;

      // 디버깅 로그 추가
      this.logger.log(`=== 혼합결제 검증 디버깅 ===`);
      this.logger.log(`결제수단 개수: ${paymentMethodCount} (최대 1개)`);
      this.logger.log(`methodsTotal: ${methodsTotal}원`);
      this.logger.log(`pointsAmount: ${pointsAmount}원`);
      this.logger.log(`totalRequest: ${totalRequest}원`);
      this.logger.log(`session.amount: ${session.amount}원`);
      this.logger.log(`===========================`);

      // 숫자 비교를 위해 Number()로 변환
      if (totalRequest !== Number(session.amount)) {
        throw new InvalidPaymentAmountError(
          totalRequest,
          Number(session.amount),
        );
      }

      const results: PaymentResponse['results'] = {};

      try {
        // 4. 포인트 차감 처리 (우선)
        if (pointsAmount > 0) {
          const redeemResult = await this.pointsService.redeem(
            session.userId,
            pointsAmount,
            '결제 사용',
            tx,
          );
          results.points = {
            amount: pointsAmount,
            newBalance: redeemResult.newBalance,
          };
          this.logger.log(
            `포인트 차감 완료: ${pointsAmount}, 잔액: ${redeemResult.newBalance}`,
          );
        }

        // 6. 결제수단별 처리 (단일 결제수단만)
        results.immediate = [];
        results.deferred = [];

        for (const methodRequest of request.paymentMethods) {
          const [paymentMethod] = await tx
            .select()
            .from(schema.paymentMethod)
            .where(eq(schema.paymentMethod.id, methodRequest.paymentMethodId))
            .limit(1);

          if (!paymentMethod) {
            throw new PaymentMethodNotFoundError(methodRequest.paymentMethodId);
          }

          if (paymentMethod.status !== 'ACTIVE') {
            throw new InactivePaymentMethodError(methodRequest.paymentMethodId);
          }

          // 즉시결제 처리
          const immediateAdapter = this.immediateAdapters.get(
            paymentMethod.methodType,
          );
          if (immediateAdapter) {
            const result = await immediateAdapter.process({
              paymentMethodId: methodRequest.paymentMethodId,
              amount: methodRequest.amount,
              currency: session.currency,
              metadata: request.metadata,
            });

            if (!result.success) {
              throw new ImmediatePaymentFailedError(
                result.error || '알 수 없는 오류',
              );
            }

            results.immediate.push({
              methodId: methodRequest.paymentMethodId,
              transactionId: result.transactionId,
              amount: methodRequest.amount,
            });

            // 결제 이벤트 저장
            await tx.insert(schema.paymentEvents).values({
              paymentSessionId: session.id,
              paymentMethodId: methodRequest.paymentMethodId,
              amount: methodRequest.amount,
              status: 'CAPTURED', // 즉시결제는 바로 확정
              pgTransactionId: result.transactionId,
              pgResponse: JSON.stringify(result.metadata || {}),
              actor: 'USER',
              metadata: JSON.stringify(result.metadata || {}),
            });

            continue;
          }

          // 후불결제 처리
          const deferredAdapter = this.deferredAdapters.get(
            paymentMethod.methodType,
          );
          if (deferredAdapter) {
            const result = await deferredAdapter.authorize({
              paymentMethodId: methodRequest.paymentMethodId,
              amount: methodRequest.amount,
              currency: session.currency,
              metadata: { ...request.metadata, paymentSessionId: session.id },
            });

            if (!result.success) {
              throw new DeferredPaymentAuthorizationFailedError(
                result.error || '알 수 없는 오류',
              );
            }

            results.deferred.push({
              methodId: methodRequest.paymentMethodId,
              authorizationId: result.authorizationId,
              amount: methodRequest.amount,
            });

            // 결제 이벤트 저장 (승인만)
            await tx.insert(schema.paymentEvents).values({
              paymentSessionId: session.id,
              paymentMethodId: methodRequest.paymentMethodId,
              amount: methodRequest.amount,
              status: 'AUTHORIZED', // 후불결제는 승인만
              pgTransactionId: result.authorizationId,
              pgResponse: JSON.stringify(result.metadata || {}),
              actor: 'USER',
              metadata: JSON.stringify(result.metadata || {}),
            });

            continue;
          }

          throw new UnsupportedPaymentMethodError(paymentMethod.methodType);
        }

        // 7. 결제 세션 상태 업데이트
        const finalStatus =
          results.deferred && results.deferred.length > 0
            ? 'AUTHORIZED'
            : 'CAPTURED';
        await tx
          .update(schema.paymentSessions)
          .set({
            status: finalStatus,
            authorizedAt: new Date(),
            capturedAt: finalStatus === 'CAPTURED' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, session.id));

        // 7. 결제 세션 이벤트 저장
        await tx.insert(schema.paymentSessionEvents).values({
          paymentSessionId: session.id,
          eventType:
            finalStatus === 'CAPTURED'
              ? 'PAYMENT_CAPTURED'
              : 'PAYMENT_AUTHORIZED',
          eventData: JSON.stringify({
            results,
            totalAmount: session.amount,
            metadata: request.metadata,
          }),
        });

        const response: PaymentResponse = {
          success: true,
          paymentId: session.id, // 또는 별도 payment ID 생성
          sessionId: session.id,
          totalAmount: session.amount,
          results,
        };

        this.logger.log(`통합 결제 완료: ${session.id}`);
        return response;
      } catch (error) {
        // 실패 시 세션 상태 업데이트
        await tx
          .update(schema.paymentSessions)
          .set({
            status: 'FAILED',
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, session.id));

        throw error;
      }
    });
  }

  /**
   * 후불결제 확정 (스케줄러용)
   */
  async captureDeferred(
    authorizationId: string,
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    this.logger.log(`후불결제 확정: ${authorizationId}`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 결제 이벤트 조회
        const [paymentEvent] = await tx
          .select()
          .from(schema.paymentEvents)
          .where(eq(schema.paymentEvents.pgTransactionId, authorizationId))
          .limit(1);

        if (!paymentEvent) {
          throw new PaymentEventNotFoundError(authorizationId);
        }

        // 결제수단 조회
        const [paymentMethod] = await tx
          .select()
          .from(schema.paymentMethod)
          .where(eq(schema.paymentMethod.id, paymentEvent.paymentMethodId))
          .limit(1);

        if (!paymentMethod) {
          throw new PaymentMethodNotFoundError(paymentEvent.paymentMethodId);
        }

        // 후불결제 어댑터로 확정 처리
        const adapter = this.deferredAdapters.get(paymentMethod.methodType);
        if (!adapter) {
          throw new UnsupportedPaymentMethodError(paymentMethod.methodType);
        }

        const result = await adapter.capture({
          authorizationId,
          amount: paymentEvent.amount,
          metadata: { paymentEventId: paymentEvent.id },
        });

        if (!result.success) {
          throw new DeferredPaymentCaptureFailedError(
            result.error || '알 수 없는 오류',
          );
        }

        // 결제 이벤트 상태 업데이트
        await tx
          .update(schema.paymentEvents)
          .set({
            status: 'CAPTURED',
            pgTransactionId: result.transactionId,
            pgResponse: JSON.stringify(result.metadata || {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentEvents.id, paymentEvent.id));

        return { success: true, transactionId: result.transactionId };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`후불결제 확정 실패: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}
