// services/v2/refund.service.ts - v4 아키텍처 환불 서비스
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { PaymentPolicyValidator } from '../../shared/policies/payment-policy';
import {
  RefundCreateDto,
  RefundResponseDto,
} from '../../shared/dtos/v2-payment.dto';

/**
 * v4 아키텍처 Refund 서비스
 *
 * 책임:
 * - 환불 생성/조회/상태 관리
 * - 환불 정책 검증 (금액 초과 방지 등)
 * - Intent 상태 업데이트 (PARTIALLY_REFUNDED/REFUNDED)
 * - 환불 도메인 전용 상태 관리 (COMPLETED 사용)
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly policyValidator: PaymentPolicyValidator,
  ) {}

  /**
   * 환불 생성
   */
  async createRefund(
    dto: RefundCreateDto,
    idempotencyKey?: string,
  ): Promise<RefundResponseDto> {
    this.logger.log(
      `환불 생성 시작: intentId=${dto.intentId}, amount=${dto.amount || '전액'}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. Intent 조회 및 검증
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, dto.intentId))
        .limit(1);

      if (intent.length === 0) {
        throw new Error(`Intent not found: ${dto.intentId}`);
      }

      const session = intent[0];

      if (
        !['CAPTURED', 'AUTHORIZED', 'PARTIALLY_REFUNDED'].includes(
          session.status,
        )
      ) {
        throw new Error(`Cannot refund intent with status: ${session.status}`);
      }

      // 2. 환불 금액 검증
      const refundAmount = dto.amount || session.amount;
      const remainingAmount = session.amount - session.refundedAmount;

      if (refundAmount > remainingAmount) {
        throw new Error(
          `Refund amount ${refundAmount} exceeds remaining amount ${remainingAmount}`,
        );
      }

      // 3. 정책 검증
      this.policyValidator.validateRefundPolicy(
        session.amount,
        refundAmount,
        dto.reason,
      );

      // 4. Attempt 검증 (지정된 경우)
      let targetAttemptId = dto.attemptId;
      if (!targetAttemptId) {
        // attemptId가 없으면 성공한 마지막 Attempt 찾기
        const attempts = await tx
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.intentId, dto.intentId))
          .orderBy(schema.paymentAttempts.createdAt);

        const successfulAttempt = attempts.find((a) =>
          ['CAPTURED', 'AUTHORIZED'].includes(a.status),
        );
        if (!successfulAttempt) {
          throw new Error('No successful attempt found for refund');
        }
        targetAttemptId = successfulAttempt.id;
      }

      // 5. 환불 생성
      const refundId = ulid();
      await tx.insert(schema.paymentRefunds).values({
        id: refundId,
        intentId: dto.intentId,
        attemptId: targetAttemptId,
        amount: refundAmount,
        status: 'REQUESTED', // 환불 도메인 상태
        reason: dto.reason || null,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      });

      // 6. Intent 상태 및 환불 금액 업데이트
      const newRefundedAmount = session.refundedAmount + refundAmount;
      const newStatus =
        newRefundedAmount >= session.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      await tx
        .update(schema.paymentIntents)
        .set({
          status: newStatus,
          refundedAmount: newRefundedAmount,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, dto.intentId));

      const response: RefundResponseDto = {
        refundId,
        intentId: dto.intentId,
        amount: refundAmount,
        status: 'REQUESTED',
        createdAt: new Date().toISOString(),
        reason: dto.reason,
        attemptId: targetAttemptId,
      };

      this.logger.log(
        `환불 생성 완료: ${refundId}, 금액: ${refundAmount}, Intent 상태: ${newStatus}`,
      );
      return response;
    });
  }

  /**
   * 환불 조회
   */
  async getRefund(refundId: string): Promise<RefundResponseDto> {
    const refund = await this.dbService.db
      .select({
        refund: schema.paymentRefunds,
        attempt: schema.paymentAttempts,
      })
      .from(schema.paymentRefunds)
      .innerJoin(
        schema.paymentAttempts,
        eq(schema.paymentRefunds.attemptId, schema.paymentAttempts.id),
      )
      .where(eq(schema.paymentRefunds.id, refundId))
      .limit(1);

    if (refund.length === 0) {
      throw new Error(`Refund not found: ${refundId}`);
    }

    const { refund: refundData, attempt } = refund[0];

    return {
      refundId: refundData.id,
      intentId: refundData.intentId,
      amount: refundData.amount,
      status: refundData.status,
      createdAt: refundData.createdAt.toISOString(),
      completedAt: refundData.completedAt?.toISOString(),
      reason: refundData.reason || undefined,
      attemptId: refundData.attemptId,
    };
  }

  /**
   * Intent별 환불 목록 조회
   */
  async getRefundsByIntent(intentId: string): Promise<RefundResponseDto[]> {
    const refunds = await this.dbService.db
      .select({
        refund: schema.paymentRefunds,
        attempt: schema.paymentAttempts,
      })
      .from(schema.paymentRefunds)
      .innerJoin(
        schema.paymentAttempts,
        eq(schema.paymentRefunds.attemptId, schema.paymentAttempts.id),
      )
      .where(eq(schema.paymentRefunds.intentId, intentId))
      .orderBy(schema.paymentRefunds.createdAt);

    return refunds.map(({ refund, attempt }) => ({
      refundId: refund.id,
      intentId: refund.intentId,
      amount: refund.amount,
      status: refund.status,
      createdAt: refund.createdAt.toISOString(),
      completedAt: refund.completedAt?.toISOString(),
      reason: refund.reason || undefined,
      attemptId: refund.attemptId,
    }));
  }

  /**
   * 환불 승인 처리 (관리자용)
   */
  async approveRefund(
    refundId: string,
    approvedBy: string,
  ): Promise<RefundResponseDto> {
    this.logger.log(`환불 승인 처리: ${refundId}, 승인자: ${approvedBy}`);

    return await this.dbService.db.transaction(async (tx) => {
      const refund = await tx
        .select()
        .from(schema.refundEvents)
        .where(eq(schema.refundEvents.id, refundId))
        .limit(1);

      if (refund.length === 0) {
        throw new Error(`Refund not found: ${refundId}`);
      }

      if (refund[0].status !== 'REQUESTED') {
        throw new Error(
          `Cannot approve refund with status: ${refund[0].status}`,
        );
      }

      // 환불 상태 업데이트
      await tx
        .update(schema.refundEvents)
        .set({
          status: 'APPROVED',
          completedBy: approvedBy,
        })
        .where(eq(schema.refundEvents.id, refundId));

      // TODO: 실제 환불 처리 (PG사 API 호출)
      // 현재는 바로 COMPLETED로 처리
      await tx
        .update(schema.refundEvents)
        .set({
          status: 'COMPLETED',
          completedAt: new Date(),
        })
        .where(eq(schema.refundEvents.id, refundId));

      return this.getRefund(refundId);
    });
  }
}
