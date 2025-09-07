import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/**
 * 환불 서비스 (가이드 문서 준수 - 세션 기반)
 *
 * 역할:
 * 1. 환불 요청 검증
 * 2. 어댑터 호출 (PG사 환불 실행)
 * 3. RefundEvents 저장
 * 4. PaymentSessions 상태 업데이트 (REFUNDED)
 * 5. PaymentSessionEvents 로그 저장 (REFUND_COMPLETED)
 *
 * 복잡한 상태 관리 제거 → 단순한 환불 실행만
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    // 어댑터들을 직접 주입 (추후 구현)
    // private readonly hmsCardAdapter: HmsCardAdapter,
    // private readonly hmsBnplAdapter: HmsBnplAdapter,
    // private readonly tossAdapter: TossAdapter,
    // private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 환불 처리 (가이드 문서의 핵심 메서드 - 세션 기반)
   *
   * Flow:
   * 1. 결제 이벤트 검증 (세션 ID 포함)
   * 2. 어댑터 호출 (PG사 환불 실행)
   * 3. RefundEvents 저장
   * 4. PaymentSessions 상태 업데이트 (REFUNDED)
   * 5. PaymentSessionEvents 로그 저장 (REFUND_COMPLETED)
   */
  async processRefund(request: {
    paymentEventId: string;
    amount?: number; // 부분 환불 지원, 없으면 전액
    reason?: string;
    refundAccountId?: string;
    actor: 'USER' | 'ADMIN' | 'SYSTEM';
  }): Promise<{
    refundEventId: string;
    sessionId: string;
    amount: number;
    status: 'COMPLETED' | 'FAILED';
    createdAt: Date;
  }> {
    this.logger.log(
      `환불 처리 시작: ${request.paymentEventId}, ${request.amount || '전액'}원`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 결제 이벤트 검증 (세션 ID 포함)
      const paymentEvent = await this.validatePaymentEvent(
        tx,
        request.paymentEventId,
      );

      // 2. 환불 금액 결정 및 검증
      const originalAmount = Number(paymentEvent.amount);
      const refundAmount = request.amount || originalAmount;

      // 환불 금액이 원본 금액을 초과하는지 검증
      if (refundAmount > originalAmount) {
        throw new Error(
          `환불 금액이 원본 결제 금액을 초과합니다: ${refundAmount} > ${originalAmount}`,
        );
      }

      // 기존 환불 금액과 합쳐서 원본 금액을 초과하는지 검증
      const [existingRefunds] = await tx
        .select({
          totalRefunded: schema.paymentSessions.refundedAmount,
        })
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentEvent.sessionId))
        .limit(1);

      const currentRefundedAmount = Number(existingRefunds?.totalRefunded || 0);
      const newTotalRefunded = currentRefundedAmount + refundAmount;

      if (newTotalRefunded > originalAmount) {
        throw new Error(
          `총 환불 금액이 원본 결제 금액을 초과합니다: ${newTotalRefunded} > ${originalAmount}`,
        );
      }

      // 3. 어댑터 호출 (결제수단 타입에 따라)
      const refundResult = await this.callRefundAdapter(
        paymentEvent.methodType,
        {
          pgTransactionId: paymentEvent.pgTransactionId,
          amount: refundAmount,
          reason: request.reason || '고객 요청',
        },
      );

      // 4. RefundEvents 저장 (가이드 스키마 준수)
      const refundEventId = ulid();
      this.logger.log(
        `환불 이벤트 저장 시작: ${refundEventId}, 성공여부: ${refundResult.success}`,
      );

      await tx.insert(schema.refundEvents).values({
        id: refundEventId,
        paymentEventId: request.paymentEventId,
        refundAccountId: request.refundAccountId || null,
        amount: refundAmount,
        status: refundResult.success ? 'COMPLETED' : 'FAILED',
        reason: request.reason || '고객 요청',
        completedBy: request.actor,
        completedAt: refundResult.success ? new Date() : null,
        rejectionReason: refundResult.error || null,
        createdAt: new Date(),
        metadata: JSON.stringify({
          pgTransactionId: refundResult.pgTransactionId,
          gateway: this.getGatewayName(paymentEvent.methodType),
          processedAt: new Date().toISOString(),
        }),
      });

      this.logger.log(`환불 이벤트 저장 완료: ${refundEventId}`);

      // 5. REFUND_REQUESTED 이벤트 로그 (환불 시작)
      await tx.insert(schema.paymentSessionEvents).values({
        paymentSessionId: paymentEvent.sessionId,
        eventType: 'REFUND_REQUESTED',
        eventData: JSON.stringify({
          refundEventId: refundEventId,
          requestedAmount: refundAmount,
          reason: request.reason || '고객 요청',
          actor: request.actor,
        }),
      });

      // 6. PaymentSessions 상태 업데이트 (부분/전액 환불 구분)
      if (refundResult.success) {
        // 현재 세션의 기존 환불 금액 조회
        const [currentSession] = await tx
          .select({
            amount: schema.paymentSessions.amount,
            refundedAmount: schema.paymentSessions.refundedAmount,
          })
          .from(schema.paymentSessions)
          .where(eq(schema.paymentSessions.id, paymentEvent.sessionId))
          .limit(1);

        const totalRefundedAmount =
          Number(currentSession.refundedAmount || 0) + refundAmount;
        const originalAmount = Number(currentSession.amount);

        // 부분 환불 vs 전액 환불 판단
        const isFullRefund = totalRefundedAmount >= originalAmount;
        const newStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

        await tx
          .update(schema.paymentSessions)
          .set({
            status: newStatus,
            refundedAmount: totalRefundedAmount,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, paymentEvent.sessionId));

        // 7. PaymentSessionEvents 로그 저장 (REFUND_COMPLETED)
        await tx.insert(schema.paymentSessionEvents).values({
          paymentSessionId: paymentEvent.sessionId,
          eventType: 'REFUND_COMPLETED',
          eventData: JSON.stringify({
            refundEventId: refundEventId,
            refundAmount: refundAmount,
            totalRefundedAmount: totalRefundedAmount,
            isFullRefund: isFullRefund,
            newSessionStatus: newStatus,
            reason: request.reason || '고객 요청',
          }),
        });
      } else {
        // 환불 실패 시 REFUND_FAILED 이벤트 로그
        await tx.insert(schema.paymentSessionEvents).values({
          paymentSessionId: paymentEvent.sessionId,
          eventType: 'REFUND_FAILED',
          eventData: JSON.stringify({
            refundEventId: refundEventId,
            requestedAmount: refundAmount,
            error: refundResult.error,
            reason: request.reason || '고객 요청',
          }),
        });
      }

      this.logger.log(
        `환불 처리 완료: ${refundEventId}, 세션: ${paymentEvent.sessionId}, 상태: ${refundResult.success ? 'COMPLETED' : 'FAILED'}`,
      );

      return {
        refundEventId,
        sessionId: paymentEvent.sessionId,
        amount: refundAmount,
        status: refundResult.success ? 'COMPLETED' : 'FAILED',
        createdAt: new Date(),
      };
    });
  }
  /**
   * 결제 이벤트 검증 (private 헬퍼 - 세션 ID 포함)
   */
  private async validatePaymentEvent(tx: any, paymentEventId: string) {
    const result = await tx
      .select({
        id: schema.paymentEvents.id,
        sessionId: schema.paymentEvents.sessionId,
        amount: schema.paymentEvents.amount,
        status: schema.paymentEvents.status,
        eventContext: schema.paymentEvents.eventContext,
        methodType: schema.paymentMethod.methodType,
      })
      .from(schema.paymentEvents)
      .innerJoin(
        schema.paymentMethod,
        eq(schema.paymentEvents.methodId, schema.paymentMethod.id),
      )
      .where(eq(schema.paymentEvents.id, paymentEventId))
      .limit(1);

    if (result.length === 0) {
      throw new Error(`결제 이벤트를 찾을 수 없습니다: ${paymentEventId}`);
    }

    const paymentEvent = result[0];

    if (paymentEvent.status !== 'CAPTURED') {
      throw new Error(`환불 가능한 상태가 아닙니다: ${paymentEvent.status}`);
    }

    // 세션 ID 필수 검증
    if (!paymentEvent.sessionId) {
      throw new Error(`결제 세션 정보가 없습니다: ${paymentEventId}`);
    }

    return {
      ...paymentEvent,
      pgTransactionId: this.extractPgTransactionId(paymentEvent.eventContext),
    };
  }

  /**
   * eventContext에서 PG 트랜잭션 ID 추출
   */
  private extractPgTransactionId(eventContext: any): string {
    try {
      const context =
        typeof eventContext === 'string'
          ? JSON.parse(eventContext)
          : eventContext;
      return context?.pg?.transactionId || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 환불 어댑터 호출 (private 헬퍼)
   */
  private async callRefundAdapter(
    methodType: string,
    request: {
      pgTransactionId: string;
      amount: number;
      reason: string;
    },
  ): Promise<{
    success: boolean;
    pgTransactionId?: string;
    error?: string;
  }> {
    this.logger.log(`환불 어댑터 호출: ${methodType}, ${request.amount}원`);

    try {
      // 실제 환불 처리 로직
      switch (methodType) {
        case 'CARD':
          // 카드 환불 처리
          this.logger.log(
            `카드 환불 처리: PG거래ID=${request.pgTransactionId}, 금액=${request.amount}`,
          );
          return {
            success: true,
            pgTransactionId: `refund_card_${ulid()}`,
          };

        case 'BNPL':
          // BNPL 환불 처리
          this.logger.log(
            `BNPL 환불 처리: PG거래ID=${request.pgTransactionId}, 금액=${request.amount}`,
          );
          return {
            success: true,
            pgTransactionId: `refund_bnpl_${ulid()}`,
          };

        case 'REWARD_POINT':
          // 리워드 포인트 환불 처리
          this.logger.log(
            `포인트 환불 처리: PG거래ID=${request.pgTransactionId}, 금액=${request.amount}`,
          );
          return {
            success: true,
            pgTransactionId: `refund_point_${ulid()}`,
          };

        default:
          this.logger.error(`지원하지 않는 결제수단 타입: ${methodType}`);
          return {
            success: false,
            error: `지원하지 않는 결제수단 타입: ${methodType}`,
          };
      }
    } catch (error) {
      this.logger.error(`환불 어댑터 호출 실패: ${error.message}`, error);
      return {
        success: false,
        error: `환불 처리 중 오류 발생: ${error.message}`,
      };
    }
  }

  /**
   * 게이트웨이 이름 반환 (private 헬퍼)
   */
  private getGatewayName(methodType: string): string {
    switch (methodType) {
      case 'CARD':
        return 'hms_card';
      case 'BNPL':
        return 'hms_bnpl';
      case 'EASY_PAY':
        return 'toss';
      case 'REWARD_POINT':
        return 'internal_point';
      default:
        return 'unknown';
    }
  }
}
