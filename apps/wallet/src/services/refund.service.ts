import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/**
 * 환불 서비스 (가이드 문서 준수)
 *
 * 역할:
 * 1. 환불 요청 검증
 * 2. 어댑터 호출 (PG사 환불 실행)
 * 3. RefundEvents 저장
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
   * 환불 처리 (가이드 문서의 핵심 메서드)
   *
   * Flow:
   * 1. 결제 이벤트 검증
   * 2. 어댑터 호출 (PG사 환불 실행)
   * 3. RefundEvents 저장
   */
  async processRefund(request: {
    paymentEventId: string;
    amount?: number; // 부분 환불 지원, 없으면 전액
    reason?: string;
    refundAccountId?: string;
    actor: 'USER' | 'ADMIN' | 'SYSTEM';
  }): Promise<{
    refundEventId: string;
    amount: number;
    status: 'COMPLETED' | 'FAILED';
    createdAt: Date;
  }> {
    this.logger.log(
      `환불 처리 시작: ${request.paymentEventId}, ${request.amount || '전액'}원`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 결제 이벤트 검증
      const paymentEvent = await this.validatePaymentEvent(
        tx,
        request.paymentEventId,
      );

      // 2. 환불 금액 결정 (부분 환불 vs 전액 환불)
      const refundAmount = request.amount || Number(paymentEvent.amount);

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

      this.logger.log(
        `환불 처리 완료: ${refundEventId}, 상태: ${refundResult.success ? 'COMPLETED' : 'FAILED'}`,
      );

      return {
        refundEventId,
        amount: refundAmount,
        status: refundResult.success ? 'COMPLETED' : 'FAILED',
        createdAt: new Date(),
      };
    });
  }
  /**
   * 결제 이벤트 검증 (private 헬퍼)
   */
  private async validatePaymentEvent(tx: any, paymentEventId: string) {
    const result = await tx
      .select({
        id: schema.paymentEvents.id,
        amount: schema.paymentEvents.amount,
        status: schema.paymentEvents.status,
        pgTransactionId: schema.paymentEvents.pgTransactionId,
        methodType: schema.paymentMethod.methodType,
      })
      .from(schema.paymentEvents)
      .innerJoin(
        schema.paymentMethod,
        eq(schema.paymentEvents.paymentMethodId, schema.paymentMethod.id),
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

    return paymentEvent;
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

    // TODO: 실제 어댑터 호출 로직 구현
    // 현재는 Mock 응답 반환
    switch (methodType) {
      case 'CARD':
        return {
          success: true,
          pgTransactionId: `refund_card_${ulid()}`,
        };
      case 'BNPL':
        return {
          success: true,
          pgTransactionId: `refund_bnpl_${ulid()}`,
        };
      case 'REWARD_POINT':
        return {
          success: true,
          pgTransactionId: `refund_point_${ulid()}`,
        };
      default:
        return {
          success: false,
          error: `지원하지 않는 결제수단 타입: ${methodType}`,
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
