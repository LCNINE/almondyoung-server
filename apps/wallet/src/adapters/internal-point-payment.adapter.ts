// adapters/internal-point-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentGateway,
  PaymentMetadata,
  PaymentResult,
  RefundResult,
} from '../interfaces/payment-gateway.interface';
import { PointMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { Money } from '../shared/utils/money.util';

/**
 * 내부 포인트 결제 어댑터 (표준 간소화)
 * - processPayment(): 포인트 차감
 * - refundPayment(): 포인트 환급
 */
@Injectable()
export class InternalPointPaymentAdapter
  implements PaymentGateway, PointMethodGateway
{
  private readonly logger = new Logger(InternalPointPaymentAdapter.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  async processPayment(
    amount: number,
    currency: string = 'KRW',
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(`포인트 결제: ${metadata?.userId}, 금액: ${amountKRW}KRW`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 사용자 포인트 조회
        const [pointAccount] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, metadata?.userId || ''))
          .limit(1);

        if (!pointAccount) {
          return {
            success: false,
            transactionId: '',
            error: '포인트 계정을 찾을 수 없습니다',
          };
        }

        const currentBalance = Money.toKRWInt(pointAccount.balance);
        if (currentBalance < amountKRW) {
          return {
            success: false,
            transactionId: '',
            error: '포인트 잔액이 부족합니다',
            metadata: {
              currentBalance,
              requestedAmount: amountKRW,
            },
          };
        }

        // 2. 포인트 트랜잭션 생성
        const transactionId = ulid();
        await tx.insert(schema.pointEvents).values({
          pointId: pointAccount.id,
          type: 'REDEEM', // 포인트 사용
          amount: amountKRW,
          reason: '상품 구매',
          relatedEventId: metadata?.sessionId,
        });

        // 3. 포인트 잔액 업데이트
        const newBalance = currentBalance - amountKRW;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.userId, metadata?.userId || ''));

        this.logger.log(`포인트 결제 성공: ${transactionId}`);

        return {
          success: true,
          transactionId,
          captureId: transactionId, // 포인트는 즉시 확정
          metadata: {
            provider: 'internal_point',
            method: 'point_debit',
            previousBalance: currentBalance,
            remainingBalance: newBalance,
            processedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: '포인트 결제 처리 중 오류가 발생했습니다',
      };
    }
  }

  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(`포인트 환불: ${transactionId}, 금액: ${amountKRW}KRW`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 원본 트랜잭션 조회
        const [originalTransaction] = await tx
          .select()
          .from(schema.pointEvents)
          .where(eq(schema.pointEvents.id, transactionId))
          .limit(1);

        if (!originalTransaction || originalTransaction.type !== 'REDEEM') {
          throw new Error('원본 포인트 사용 트랜잭션을 찾을 수 없습니다');
        }

        // 2. 환불 트랜잭션 생성 (포인트 복원)
        await tx.insert(schema.pointEvents).values({
          pointId: originalTransaction.pointId,
          type: 'EARN', // 포인트 복원
          amount: amountKRW,
          reason: `환불: ${reason || '고객 요청'}`,
          relatedEventId: transactionId,
        });

        // 3. 포인트 잔액 복원 (pointId로 조회)
        await tx
          .update(schema.points)
          .set({
            balance: sql`${schema.points.balance} + ${amountKRW}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.id, originalTransaction.pointId));

        const refundId = `refund_${ulid()}`;
        this.logger.log(`포인트 환불 완료: ${refundId}`);

        return {
          success: true,
          refundId,
          refundedAmount: amountKRW,
          metadata: {
            provider: 'internal_point',
            originalTransactionId: transactionId,
            refundedAt: new Date().toISOString(),
            reason: reason || '고객 요청',
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: '포인트 환불 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * 포인트 적립/지급 - PointMethodGateway 인터페이스용
   */
  async awardPoints(
    userId: string,
    amount: number,
    sourceType: 'PURCHASE_REWARD' | 'EVENT_BONUS' | 'REFUND' | 'ADMIN_GRANT',
    metadata?: Record<string, any>,
  ): Promise<{
    success: boolean;
    transactionId?: string;
    newBalance?: number;
    error?: string;
  }> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `포인트 적립: ${userId}, 금액: ${amountKRW}KRW, 타입: ${sourceType}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 포인트 계정 확인
        const [pointAccount] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, userId))
          .limit(1);

        if (!pointAccount) {
          return {
            success: false,
            error: '포인트 계정을 찾을 수 없습니다',
          };
        }

        // 2. 적립 트랜잭션 생성
        await tx.insert(schema.pointEvents).values({
          pointId: pointAccount.id,
          type: 'EARN', // 포인트 적립
          amount: amountKRW,
          reason: `포인트 적립 (${sourceType})`,
          relatedEventId: metadata?.relatedId || null,
        });

        // 3. 포인트 잔액 업데이트
        const newBalance = Money.toKRWInt(pointAccount.balance) + amountKRW;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.userId, userId));

        const earnId = `earn_${ulid()}`;
        this.logger.log(`포인트 적립 완료: ${earnId}`);

        return {
          success: true,
          transactionId: earnId,
          newBalance,
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 적립 실패: ${errorMessage}`);

      return {
        success: false,
        error: `포인트 적립 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * 포인트 잔액 조회 - PointMethodGateway 인터페이스용
   */
  async getPointBalance(userId: string): Promise<{
    balance: number;
    freezeAmount: number;
    availableAmount: number;
  }> {
    try {
      const [pointAccount] = await this.db.db
        .select()
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      if (!pointAccount) {
        return {
          balance: 0,
          freezeAmount: 0,
          availableAmount: 0,
        };
      }

      const balance = Money.toKRWInt(pointAccount.balance);
      const freezeAmount = 0; // 스키마에 freezeAmount 없음

      return {
        balance,
        freezeAmount,
        availableAmount: balance - freezeAmount,
      };
    } catch (error) {
      this.logger.error(
        `포인트 잔액 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
