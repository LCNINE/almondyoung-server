// providers/points.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
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
 * 포인트 결제 Provider (내부 원장 기반)
 * - 사용자 포인트 잔액 관리
 * - 즉시 차감/적립 처리
 * - Profile 등록 불필요 (모든 사용자 자동 보유)
 */
@Injectable()
export class PointsProvider implements PaymentProvider {
  private readonly logger = new Logger(PointsProvider.name);

  readonly providerId: PaymentProvider_ID = 'POINTS';
  readonly supportedTypes: PaymentType[] = ['ORDER', 'REFUND'];

  constructor(private readonly db: DbService) {}

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `포인트 결제 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // 포인트는 profileId 불필요
    if (request.instrumentKind === 'STORED' && request.profileId) {
      this.logger.warn(
        `포인트 결제에 profileId가 제공되었지만 무시됩니다: ${request.profileId}`,
      );
    }

    const transactionId = `POINTS_${ulid()}`;

    try {
      // 1. 사용자 포인트 잔액 확인
      const userPoints = await this.getUserPointBalance(request.userId);

      if (userPoints < request.amount) {
        return {
          success: false,
          transactionId,
          error: `포인트 잔액 부족: 보유 ${userPoints}원, 결제 ${request.amount}원`,
          metadata: {
            providerId: this.providerId,
            availablePoints: userPoints,
            requestedAmount: request.amount,
          },
        };
      }

      // 2. 포인트 차감 처리
      await this.deductPoints(request.userId, request.amount, {
        transactionId,
        intentId: request.intentId,
        attemptId: request.attemptId,
        type: 'PAYMENT',
        description: `결제 차감 - Intent: ${request.intentId}`,
      });

      this.logger.log(
        `포인트 결제 완료 - TransactionId: ${transactionId}, 차감: ${request.amount}원`,
      );

      return {
        success: true,
        transactionId,
        captureId: transactionId, // 포인트는 즉시 확정
        metadata: {
          providerId: this.providerId,
          deductedAmount: request.amount,
          remainingBalance: userPoints - request.amount,
          paymentDate: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `포인트 결제 실패 - Intent: ${request.intentId}`,
        error,
      );
      return {
        success: false,
        transactionId,
        error: `포인트 결제 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `포인트 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    const refundId = `POINTS_REFUND_${ulid()}`;

    try {
      // 포인트 적립 처리 (환불)
      await this.addPoints(request.userId, request.amount, {
        transactionId: refundId,
        intentId: request.intentId,
        originalTransactionId: request.originalTransactionId,
        type: 'REFUND',
        description: `결제 환불 - Intent: ${request.intentId}, Reason: ${request.reason || '일반 환불'}`,
      });

      const newBalance = await this.getUserPointBalance(request.userId);

      this.logger.log(
        `포인트 환불 완료 - RefundId: ${refundId}, 적립: ${request.amount}원`,
      );

      return {
        success: true,
        refundId,
        refundedAmount: request.amount,
        metadata: {
          providerId: this.providerId,
          refundedAmount: request.amount,
          newBalance,
          refundDate: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `포인트 환불 실패 - RefundId: ${request.refundId}`,
        error,
      );
      return {
        success: false,
        refundId,
        refundedAmount: 0,
        error: `포인트 환불 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  // === 포인트 원장 관리 메서드 ===

  /**
   * 사용자 포인트 잔액 조회
   */
  private async getUserPointBalance(userId: string): Promise<number> {
    const userPoints = await this.db.db
      .select({ balance: schema.points.balance })
      .from(schema.points)
      .where(eq(schema.points.userId, userId))
      .limit(1);

    return userPoints[0]?.balance || 0;
  }

  /**
   * 포인트 차감
   */
  private async deductPoints(
    userId: string,
    amount: number,
    eventData: PointEventData,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 포인트 레코드 확인 및 생성
      const existingPoints = await tx
        .select({ id: schema.points.id, balance: schema.points.balance })
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      let pointId: string;

      if (existingPoints.length === 0) {
        // 포인트 레코드가 없으면 생성 (0원으로 시작)
        const newPoint = await tx
          .insert(schema.points)
          .values({
            userId,
            balance: 0,
          })
          .returning({ id: schema.points.id });
        pointId = newPoint[0].id;
      } else {
        pointId = existingPoints[0].id;
      }

      // 2. 포인트 차감
      await tx
        .update(schema.points)
        .set({
          balance: sql`${schema.points.balance} - ${amount}`,
          updatedAt: new Date(),
          version: sql`${schema.points.version} + 1`,
        })
        .where(eq(schema.points.userId, userId));

      // 3. 포인트 이벤트 기록
      await tx.insert(schema.pointEvents).values({
        pointId,
        type: eventData.type as any, // PointTransactionType
        amount: -amount, // 차감은 음수
        reason: eventData.description,
        relatedEventId: eventData.transactionId,
        createdAt: new Date(),
      });
    });
  }

  /**
   * 포인트 적립
   */
  private async addPoints(
    userId: string,
    amount: number,
    eventData: PointEventData,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 포인트 레코드 확인 및 생성
      const existingPoints = await tx
        .select({ id: schema.points.id, balance: schema.points.balance })
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      let pointId: string;

      if (existingPoints.length === 0) {
        // 포인트 레코드가 없으면 생성
        const newPoint = await tx
          .insert(schema.points)
          .values({
            userId,
            balance: amount, // 적립된 금액으로 시작
          })
          .returning({ id: schema.points.id });
        pointId = newPoint[0].id;
      } else {
        pointId = existingPoints[0].id;

        // 2. 포인트 적립
        await tx
          .update(schema.points)
          .set({
            balance: sql`${schema.points.balance} + ${amount}`,
            updatedAt: new Date(),
            version: sql`${schema.points.version} + 1`,
          })
          .where(eq(schema.points.userId, userId));
      }

      // 3. 포인트 이벤트 기록
      await tx.insert(schema.pointEvents).values({
        pointId,
        type: eventData.type as any, // PointTransactionType
        amount: amount, // 적립은 양수
        reason: eventData.description,
        relatedEventId: eventData.transactionId,
        createdAt: new Date(),
      });
    });
  }
}

// === 내부 타입 ===

interface PointEventData {
  transactionId: string;
  intentId: string;
  attemptId?: string;
  originalTransactionId?: string;
  type: 'PAYMENT' | 'REFUND' | 'REWARD' | 'ADJUSTMENT';
  description: string;
}
