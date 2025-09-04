// services/payment-orchestration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { IdempotencyService } from './idempotency.service';
import { ulid } from 'ulid';
import { Money } from '../shared/utils/money.util';

/**
 * 결제 오케스트레이션 서비스
 * - 순수 결제 실행만 담당 (승인, 환불)
 * - 결제수단별 라이프사이클 관리는 별도 MethodService에서 처리
 * - 모든 결제 Provider를 단일 API로 추상화
 */
@Injectable()
export class PaymentOrchestrationService {
  private readonly logger = new Logger(PaymentOrchestrationService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * 통합 결제 처리 - 순수 결제 실행만
   * @param gatewayType 결제 게이트웨이 타입
   * @param amount 금액
   * @param currency 통화
   * @param metadata 결제 메타데이터
   */
  async processPayment(
    gatewayType: string,
    amount: number,
    currency: string = 'KRW',
    metadata: {
      userId: string;
      sessionId: string;
      paymentMethodId?: string;
      orderName?: string;
      bnplAccountId?: string; // BNPL용
      hmsMemberId?: string; // HMS 정기결제용
      isRecurring?: boolean;
      [key: string]: any;
    },
    idempotencyKey?: string,
  ) {
    this.logger.log(
      `통합 결제 처리: ${gatewayType}, 금액: ${amount}${currency}, 세션: ${metadata.sessionId}`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { gatewayType, amount, currency, metadata },
        `/payments/process`,
      );
      if (idempotencyResult.hit) return idempotencyResult.response;

      try {
        // 2. 게이트웨이 선택 및 결제 실행
        const gateway = this.gatewayFactory.getGateway(gatewayType);
        const result = await gateway.processPayment(amount, currency, {
          ...metadata,
          paymentMethodId: metadata.paymentMethodId || '',
        });

        if (!result.success) {
          throw new Error(result.error || '결제 처리에 실패했습니다');
        }

        // 3. 결제 이벤트 기록
        const [paymentEvent] = await tx
          .insert(schema.paymentEvents)
          .values({
            paymentSessionId: metadata.sessionId,
            paymentMethodId: metadata.paymentMethodId || '',
            status: result.authorizationId ? 'AUTHORIZED' : 'CAPTURED',
            amount: amount,
            pgTransactionId: result.transactionId,
            pgResponse: JSON.stringify({
              gateway: gatewayType,
              originalRequest: metadata,
              gatewayResponse: result.metadata,
            }),
            actor: 'USER',
          })
          .returning();

        const paymentEventId = paymentEvent.id;

        // 4. 세션 상태 업데이트
        const sessionStatus = result.authorizationId
          ? 'AUTHORIZED'
          : 'CAPTURED';
        await tx
          .update(schema.paymentSessions)
          .set({
            status: sessionStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, metadata.sessionId));

        const response = {
          success: true,
          paymentEventId,
          transactionId: result.transactionId,
          authorizationId: result.authorizationId,
          captureId: result.captureId,
          status: sessionStatus,
          gateway: gatewayType,
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);

        this.logger.log(
          `통합 결제 성공: ${gatewayType} - ${result.transactionId}`,
        );

        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`통합 결제 실패: ${gatewayType} - ${errorMessage}`);

        const failureResponse = {
          success: false,
          error: errorMessage,
          gateway: gatewayType,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * 통합 환불 처리 - 순수 환불 실행만
   */
  async refundPayment(
    gatewayType: string,
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ) {
    this.logger.log(
      `통합 환불 처리: ${gatewayType}, 거래ID: ${transactionId}, 금액: ${amount}KRW`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { gatewayType, transactionId, amount, reason },
        `/refunds/process`,
      );
      if (idempotencyResult.hit) return idempotencyResult.response;

      try {
        // 2. 게이트웨이 선택 및 환불 실행
        const gateway = this.gatewayFactory.getGateway(gatewayType);
        const result = await gateway.refundPayment(
          transactionId,
          amount,
          reason,
        );

        if (!result.success) {
          throw new Error(result.error || '환불 처리에 실패했습니다');
        }

        // 3. 환불 이벤트 기록
        await tx.insert(schema.refundEvents).values({
          paymentEventId: transactionId, // 원본 결제 이벤트 ID
          status: 'COMPLETED',
          amount: amount,
          reason: reason || '고객 요청',
          completedAt: new Date(),
          metadata: JSON.stringify({
            gateway: gatewayType,
            gatewayResponse: result.metadata,
          }),
        });

        const refundEventId = `refund_${ulid()}`;
        const response = {
          success: true,
          refundEventId,
          refundId: result.refundId,
          refundedAmount: result.refundedAmount,
          gateway: gatewayType,
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);

        this.logger.log(`통합 환불 성공: ${gatewayType} - ${result.refundId}`);

        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`통합 환불 실패: ${gatewayType} - ${errorMessage}`);

        const failureResponse = {
          success: false,
          error: errorMessage,
          gateway: gatewayType,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * 결제수단별 자동 게이트웨이 선택 (편의 메서드)
   */
  async processPaymentByMethodType(
    methodType: string,
    amount: number,
    metadata: {
      userId: string;
      sessionId: string;
      paymentMethodId?: string;
      orderName?: string;
      [key: string]: any;
    },
    idempotencyKey?: string,
  ) {
    // 결제수단 타입으로 게이트웨이 자동 선택
    const gatewayType = this.getGatewayTypeFromMethod(methodType);

    return this.processPayment(
      gatewayType,
      amount,
      'KRW',
      metadata,
      idempotencyKey,
    );
  }

  private getGatewayTypeFromMethod(methodType: string): string {
    switch (methodType) {
      case 'CARD':
      case 'EASY_PAY':
        return 'toss';
      case 'REWARD_POINT':
        return 'internal_point';
      case 'BNPL':
        return 'hms_bnpl';
      default:
        throw new Error(`지원하지 않는 결제수단: ${methodType}`);
    }
  }
}
