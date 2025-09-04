import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import {
  PaymentProcessingStrategy,
  PaymentResult,
  RefundResult,
} from './payment.strategy.interface';
import { IdempotencyService } from '../services/idempotency.service';

/**
 * @class PointStrategy
 * @description 내부 포인트 결제수단의 모든 비즈니스 로직을 캡슐화한 클래스.
 * 외부 어댑터 없이 내부 DB만으로 처리합니다.
 */
@Injectable()
export class PointStrategy implements PaymentProcessingStrategy {
  private readonly logger = new Logger(PointStrategy.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * @method processPayment
   * @description 내부 포인트 결제를 처리합니다.
   */
  async processPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `포인트 결제 처리: 금액 ${amount}${currency}, 사용자: ${metadata.userId}`,
    );

    return await this.db.db.transaction(async (tx): Promise<PaymentResult> => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { amount, currency, metadata },
        `/payments/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as PaymentResult;

      try {
        // 1. 사용자 포인트 잔액 확인
        const [userPoint] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, metadata.userId))
          .limit(1);

        if (!userPoint || userPoint.balance < amount) {
          throw new Error('포인트 잔액이 부족합니다');
        }

        // 2. 포인트 차감
        await tx
          .update(schema.points)
          .set({
            balance: userPoint.balance - amount,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.userId, metadata.userId));

        // 3. 포인트 사용 이력 기록
        const transactionId = `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await tx.insert(schema.pointTransactions).values({
          pointId: userPoint.id,
          type: 'REDEEM',
          amount: -amount,
          reason: `결제 사용: ${metadata.orderName || '상품 구매'}`,
        });

        // 4. 결제 이벤트 기록
        await tx.insert(schema.paymentEvents).values({
          paymentSessionId: metadata.sessionId,
          paymentMethodId: metadata.paymentMethodId || '',
          status: 'CAPTURED', // 포인트는 즉시 확정
          amount: amount,
          pgTransactionId: transactionId,
          pgResponse: JSON.stringify({
            gateway: 'internal_point',
            originalRequest: metadata,
            pointBalance: userPoint.balance - amount,
          }),
          actor: 'USER',
          metadata: JSON.stringify({
            gateway: 'internal_point',
            paymentType: 'POINT',
            remainingBalance: userPoint.balance - amount,
          }),
        });

        // 5. 세션 상태 업데이트
        await tx
          .update(schema.paymentSessions)
          .set({
            status: 'CAPTURED',
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, metadata.sessionId));

        const response: PaymentResult = {
          success: true,
          transactionId,
          captureId: transactionId,
          amount,
          currency,
          status: 'CAPTURED',
          metadata: {
            remainingBalance: userPoint.balance - amount,
            usedAmount: amount,
          },
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`포인트 결제 실패: ${errorMessage}`);

        const failureResponse: PaymentResult = {
          success: false,
          transactionId: '',
          amount,
          currency,
          status: 'FAILED',
          error: errorMessage,
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
   * @method refundPayment
   * @description 포인트 환불을 처리합니다 (포인트 복구).
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(
      `포인트 환불 처리: 거래ID ${transactionId}, 금액: ${amount}`,
    );

    return await this.db.db.transaction(async (tx): Promise<RefundResult> => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { transactionId, amount, reason },
        `/refunds/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RefundResult;

      try {
        // 1. 원본 결제 이벤트 조회
        const [paymentEvent] = await tx
          .select()
          .from(schema.paymentEvents)
          .where(eq(schema.paymentEvents.pgTransactionId, transactionId))
          .limit(1);

        if (!paymentEvent) {
          throw new Error('원본 결제 정보를 찾을 수 없습니다');
        }

        // 2. 결제 세션 정보로부터 사용자 ID 조회
        const [paymentSession] = await tx
          .select()
          .from(schema.paymentSessions)
          .where(eq(schema.paymentSessions.id, paymentEvent.paymentSessionId))
          .limit(1);

        if (!paymentSession) {
          throw new Error('결제 세션 정보를 찾을 수 없습니다');
        }

        // 3. 사용자 포인트 잔액 조회
        const [userPoint] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, paymentSession.userId))
          .limit(1);

        if (!userPoint) {
          throw new Error('사용자 포인트 정보를 찾을 수 없습니다');
        }

        // 4. 포인트 복구
        await tx
          .update(schema.points)
          .set({
            balance: userPoint.balance + amount,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.userId, paymentSession.userId));

        // 4. 포인트 환불 이력 기록
        const refundId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await tx.insert(schema.pointTransactions).values({
          pointId: userPoint.id,
          type: 'EARN',
          amount: amount,
          reason: `환불: ${reason || '고객 요청'}`,
        });

        // 5. 환불 이벤트 기록
        await tx.insert(schema.refundEvents).values({
          paymentEventId: paymentEvent.id,
          status: 'COMPLETED',
          amount: amount,
          reason: reason || '고객 요청',
          completedBy: 'SYSTEM', // Strategy에서 자동 처리
          completedAt: new Date(),
          metadata: JSON.stringify({
            gateway: 'internal_point',
            refundedBalance: userPoint.balance + amount,
          }),
        });

        const response: RefundResult = {
          success: true,
          refundId,
          refundedAmount: amount,
          metadata: {
            restoredBalance: userPoint.balance + amount,
          },
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`포인트 환불 실패: ${errorMessage}`);

        const failureResponse: RefundResult = {
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: errorMessage,
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
}
