// services/refunds-v2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { IdempotencyService } from './Idempotency.service';
import { WalletTx } from '../shared/database';
import { PaymentAdapter } from '../ports/payment-adapter.port';
import { TossImmediateAdapter } from '../adapters/toss-immediate.adapter';
import { BnplDeferredAdapter } from '../adapters/bnpl-deferred.adapter';
import { PointAdapter } from '../adapters/point.adapter';
import {
  RefundNotFoundError,
  RefundAlreadyProcessedError,
  RefundAmountExceedsLimitError,
  RefundExecutionFailedError,
} from '../shared/errors/payment.errors';

/**
 * MSA 환불 서비스 V2
 *
 * 📋 결제 MSA 환불 책임:
 * 1. 외부(주문/반품)에서 승인된 환불 명세 수신
 * 2. 실제 환급 실행 (PaymentAdapter 활용)
 * 3. 환불 상태 관리 (REQUESTED → APPROVED → COMPLETED/CANCELLED)
 * 4. 포인트 복원 처리
 * 5. 환불 장부 기록 (멱등성, 이벤트소싱)
 *
 * ❌ 하지 않는 것:
 * - 환불 가능성 판단 (주문/반품 서버)
 * - 물류 회수/검수 (물류 서버)
 * - 정책 검증 (주문/반품 서버)
 */

export interface RefundRequest {
  paymentSessionId: string;
  amount: number;
  reason?: string;
  metadata?: Record<string, any>;

  // 외부 승인 정보 (주문/반품 서버에서 제공)
  approvalInfo?: {
    orderId: string;
    orderLineIds: string[];
    approvedBy: string;
    approvedAt: string;
  };
}

export interface RefundApprovalRequest {
  refundId: string;

  // 외부 승인 정보 (주문/반품 서버에서 제공)
  approvalInfo: {
    orderId: string;
    orderLineIds: string[];
    approvedBy: string;
    approvedAt: string;
    finalAmount: number; // 최종 승인된 환불 금액
  };
}

export interface RefundCancellationRequest {
  refundId: string;
  reason: string;
  cancelledBy: string;
}

export interface RefundResponse {
  refundId: string;
  paymentSessionId: string;
  status: 'REQUESTED' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  amount: number;
  totalRefundedAmount: number; // 누적 환불 금액
  remainingRefundableAmount: number; // 남은 환불 가능 금액
  createdAt: string;
  processedAt?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class RefundsV2Service {
  private readonly logger = new Logger(RefundsV2Service.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly tossImmediateAdapter: TossImmediateAdapter,
    private readonly bnplDeferredAdapter: BnplDeferredAdapter,
    private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 1. 환불 요청 접수 (외부에서 호출)
   * - 상태: REQUESTED
   * - 실제 환급은 하지 않고 요청만 기록
   */
  async requestRefund(
    request: RefundRequest,
    idempotencyKey?: string,
  ): Promise<RefundResponse> {
    this.logger.log(
      `💰 환불 요청 접수: ${request.paymentSessionId}, 금액: ${request.amount}`,
    );

    return this.db.db.transaction(async (tx) => {
      // 멱등성 체크
      const idem = await this.idempotency.checkOrCreate<RefundResponse>(
        tx,
        idempotencyKey,
        request,
        `/refunds/request`,
      );
      if (idem.hit) return idem.response!;

      // 결제 세션 조회 및 검증
      const [session] = await tx
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, request.paymentSessionId))
        .limit(1);

      if (!session) {
        throw new RefundNotFoundError(
          `결제 세션을 찾을 수 없습니다: ${request.paymentSessionId}`,
        );
      }

      if (session.status !== 'CAPTURED') {
        throw new RefundAlreadyProcessedError(
          `환불 가능한 상태가 아닙니다: ${session.status}`,
        );
      }

      // 기존 환불 금액 조회
      const totalRefunded = await this.getTotalRefundedAmount(
        tx,
        request.paymentSessionId,
      );
      const sessionAmount = Number(session.amount);
      const remainingAmount = sessionAmount - totalRefunded;

      if (request.amount > remainingAmount) {
        throw new RefundAmountExceedsLimitError(
          `환불 요청 금액이 한도를 초과합니다. 요청: ${request.amount}, 가능: ${remainingAmount}`,
        );
      }

      // 환불 요청 기록 (REQUESTED 상태)
      const refundId = `refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      // paymentEvents에서 CAPTURED 이벤트 찾기
      const [paymentEvent] = await tx
        .select()
        .from(schema.paymentEvents)
        .where(
          and(
            eq(schema.paymentEvents.paymentSessionId, request.paymentSessionId),
            eq(schema.paymentEvents.status, 'CAPTURED'),
          ),
        )
        .limit(1);

      if (!paymentEvent) {
        throw new RefundNotFoundError(
          `결제 완료 이벤트를 찾을 수 없습니다: ${request.paymentSessionId}`,
        );
      }

      const [refundEvent] = await tx
        .insert(schema.refundEvents)
        .values({
          id: refundId,
          paymentEventId: paymentEvent.id,
          amount: request.amount,
          status: 'REQUESTED', // 요청 상태로 시작
          reason: request.reason,
          metadata: request.metadata
            ? JSON.stringify(request.metadata)
            : undefined,
        })
        .returning();

      const response: RefundResponse = {
        refundId: refundEvent.id,
        paymentSessionId: request.paymentSessionId,
        status: 'REQUESTED',
        amount: request.amount,
        totalRefundedAmount: totalRefunded,
        remainingRefundableAmount: remainingAmount - request.amount,
        createdAt: refundEvent.createdAt.toISOString(),
        metadata: request.metadata,
      };

      await this.idempotency.complete(tx, idempotencyKey, response, 201);
      return response;
    });
  }

  /**
   * 2. 환불 승인 처리 (외부 승인 후 실제 환급 실행)
   * - 상태: REQUESTED → APPROVED → COMPLETED
   * - PaymentAdapter를 통한 실제 환급 실행
   */
  async approveRefund(
    request: RefundApprovalRequest,
    idempotencyKey?: string,
  ): Promise<RefundResponse> {
    this.logger.log(
      `✅ 환불 승인 처리: ${request.refundId}, 최종금액: ${request.approvalInfo.finalAmount}`,
    );

    return this.db.db.transaction(async (tx) => {
      // 멱등성 체크
      const idem = await this.idempotency.checkOrCreate<RefundResponse>(
        tx,
        idempotencyKey,
        request,
        `/refunds/${request.refundId}/approve`,
      );
      if (idem.hit) return idem.response!;

      // 환불 이벤트 조회
      const [refundEvent] = await tx
        .select()
        .from(schema.refundEvents)
        .where(eq(schema.refundEvents.id, request.refundId))
        .limit(1);

      if (!refundEvent) {
        throw new RefundNotFoundError(
          `환불 요청을 찾을 수 없습니다: ${request.refundId}`,
        );
      }

      if (refundEvent.status !== 'REQUESTED') {
        throw new RefundAlreadyProcessedError(
          `이미 처리된 환불입니다: ${refundEvent.status}`,
        );
      }

      // 결제 이벤트 및 세션 조회
      const [paymentEvent] = await tx
        .select({
          paymentEvent: schema.paymentEvents,
          paymentMethod: schema.paymentMethod,
          session: schema.paymentSessions,
        })
        .from(schema.paymentEvents)
        .innerJoin(
          schema.paymentMethod,
          eq(schema.paymentEvents.paymentMethodId, schema.paymentMethod.id),
        )
        .innerJoin(
          schema.paymentSessions,
          eq(schema.paymentEvents.paymentSessionId, schema.paymentSessions.id),
        )
        .where(eq(schema.paymentEvents.id, refundEvent.paymentEventId))
        .limit(1);

      if (!paymentEvent) {
        throw new RefundNotFoundError(
          `결제 이벤트를 찾을 수 없습니다: ${refundEvent.paymentEventId}`,
        );
      }

      // 1단계: 환불 승인 상태로 변경
      await tx
        .update(schema.refundEvents)
        .set({
          status: 'APPROVED',
          metadata: JSON.stringify({
            ...(refundEvent.metadata ? JSON.parse(refundEvent.metadata) : {}),
            approvalInfo: request.approvalInfo,
          }),
        })
        .where(eq(schema.refundEvents.id, request.refundId));

      // 2단계: 실제 환급 실행
      const adapter = this.getPaymentAdapter(
        paymentEvent.paymentMethod.methodType,
      );
      const refundResult = await adapter.refund({
        pgTransactionId:
          paymentEvent.paymentEvent.pgTransactionId || 'mock_refund_tx',
        amount: request.approvalInfo.finalAmount,
        reason: refundEvent.reason || '외부 승인된 환불',
        metadata: request.approvalInfo,
      });

      let finalStatus: 'COMPLETED' | 'FAILED' = 'FAILED';
      const processedAt = new Date();

      if (refundResult.success) {
        finalStatus = 'COMPLETED';
        this.logger.log(
          `✅ 환급 실행 완료: ${request.refundId} → ${refundResult.pgTransactionId}`,
        );
      } else {
        this.logger.error(
          `❌ 환급 실행 실패: ${request.refundId} → ${refundResult.error}`,
        );
      }

      // 3단계: 최종 상태 업데이트
      await tx
        .update(schema.refundEvents)
        .set({
          status: finalStatus,
          completedAt: processedAt,
          completedBy: request.approvalInfo.approvedBy,
          rejectionReason: refundResult.success
            ? undefined
            : refundResult.error,
          metadata: JSON.stringify({
            approvalInfo: request.approvalInfo,
            executionResult: {
              pgTransactionId: refundResult.pgTransactionId,
              executedAt: processedAt.toISOString(),
              success: refundResult.success,
            },
          }),
        })
        .where(eq(schema.refundEvents.id, request.refundId));

      // 4단계: 포인트 복원 처리 (환불 성공 시)
      let pointsRestored = 0;
      if (refundResult.success) {
        pointsRestored = await this.restorePointsForRefund(
          tx,
          paymentEvent.session.id,
          request.approvalInfo.finalAmount,
          refundEvent.id,
        );
      }

      // 누적 환불 금액 재계산
      const totalRefunded = await this.getTotalRefundedAmount(
        tx,
        paymentEvent.session.id,
      );
      const remainingAmount =
        Number(paymentEvent.session.amount) - totalRefunded;

      const response: RefundResponse = {
        refundId: request.refundId,
        paymentSessionId: paymentEvent.session.id,
        status: finalStatus,
        amount: request.approvalInfo.finalAmount,
        totalRefundedAmount: totalRefunded,
        remainingRefundableAmount: remainingAmount,
        createdAt: refundEvent.createdAt.toISOString(),
        processedAt: processedAt.toISOString(),
        metadata: {
          approvalInfo: request.approvalInfo,
          pointsRestored,
          executionResult: refundResult,
        },
      };

      await this.idempotency.complete(tx, idempotencyKey, response, 200);
      return response;
    });
  }

  /**
   * 3. 환불 취소 (요청 철회)
   * - 상태: REQUESTED → CANCELLED
   */
  async cancelRefund(
    request: RefundCancellationRequest,
    idempotencyKey?: string,
  ): Promise<RefundResponse> {
    this.logger.log(
      `❌ 환불 취소: ${request.refundId}, 사유: ${request.reason}`,
    );

    return this.db.db.transaction(async (tx) => {
      // 멱등성 체크
      const idem = await this.idempotency.checkOrCreate<RefundResponse>(
        tx,
        idempotencyKey,
        request,
        `/refunds/${request.refundId}/cancel`,
      );
      if (idem.hit) return idem.response!;

      // 환불 이벤트 조회
      const [refundEvent] = await tx
        .select()
        .from(schema.refundEvents)
        .where(eq(schema.refundEvents.id, request.refundId))
        .limit(1);

      if (!refundEvent) {
        throw new RefundNotFoundError(
          `환불 요청을 찾을 수 없습니다: ${request.refundId}`,
        );
      }

      if (refundEvent.status !== 'REQUESTED') {
        throw new RefundAlreadyProcessedError(
          `취소할 수 없는 환불 상태입니다: ${refundEvent.status}`,
        );
      }

      // 환불 취소 처리
      const cancelledAt = new Date();
      await tx
        .update(schema.refundEvents)
        .set({
          status: 'CANCELLED',
          completedAt: cancelledAt,
          completedBy: request.cancelledBy,
          rejectionReason: request.reason,
          metadata: JSON.stringify({
            ...(refundEvent.metadata ? JSON.parse(refundEvent.metadata) : {}),
            cancellationInfo: {
              cancelledBy: request.cancelledBy,
              reason: request.reason,
              cancelledAt: cancelledAt.toISOString(),
            },
          }),
        })
        .where(eq(schema.refundEvents.id, request.refundId));

      // 세션 정보 조회 (응답용)
      const [paymentEvent] = await tx
        .select({
          session: schema.paymentSessions,
        })
        .from(schema.paymentEvents)
        .innerJoin(
          schema.paymentSessions,
          eq(schema.paymentEvents.paymentSessionId, schema.paymentSessions.id),
        )
        .where(eq(schema.paymentEvents.id, refundEvent.paymentEventId))
        .limit(1);

      if (!paymentEvent) {
        throw new RefundNotFoundError('결제 이벤트를 찾을 수 없습니다');
      }

      const totalRefunded = await this.getTotalRefundedAmount(
        tx,
        paymentEvent.session.id,
      );
      const remainingAmount =
        Number(paymentEvent.session.amount) - totalRefunded;

      const response: RefundResponse = {
        refundId: request.refundId,
        paymentSessionId: paymentEvent.session.id,
        status: 'CANCELLED',
        amount: refundEvent.amount,
        totalRefundedAmount: totalRefunded,
        remainingRefundableAmount: remainingAmount,
        createdAt: refundEvent.createdAt.toISOString(),
        processedAt: cancelledAt.toISOString(),
        metadata: {
          cancellationInfo: {
            cancelledBy: request.cancelledBy,
            reason: request.reason,
            cancelledAt: cancelledAt.toISOString(),
          },
        },
      };

      await this.idempotency.complete(tx, idempotencyKey, response, 200);
      return response;
    });
  }

  /**
   * 환불 조회
   */
  async getRefund(refundId: string): Promise<RefundResponse> {
    const [refundData] = await this.db.db
      .select({
        refund: schema.refundEvents,
        session: schema.paymentSessions,
      })
      .from(schema.refundEvents)
      .innerJoin(
        schema.paymentEvents,
        eq(schema.refundEvents.paymentEventId, schema.paymentEvents.id),
      )
      .innerJoin(
        schema.paymentSessions,
        eq(schema.paymentEvents.paymentSessionId, schema.paymentSessions.id),
      )
      .where(eq(schema.refundEvents.id, refundId))
      .limit(1);

    if (!refundData) {
      throw new RefundNotFoundError(`환불을 찾을 수 없습니다: ${refundId}`);
    }

    const totalRefunded = await this.getTotalRefundedAmount(
      this.db.db,
      refundData.session.id,
    );
    const remainingAmount = Number(refundData.session.amount) - totalRefunded;

    return {
      refundId: refundData.refund.id,
      paymentSessionId: refundData.session.id,
      status: refundData.refund.status,
      amount: refundData.refund.amount,
      totalRefundedAmount: totalRefunded,
      remainingRefundableAmount: remainingAmount,
      createdAt: refundData.refund.createdAt.toISOString(),
      processedAt: refundData.refund.completedAt?.toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metadata: refundData.refund.metadata
        ? JSON.parse(refundData.refund.metadata)
        : undefined,
    };
  }

  /**
   * 결제수단별 환불 어댑터 선택
   */
  private getPaymentAdapter(methodType: string): PaymentAdapter {
    switch (methodType) {
      case 'CARD':
        return this.tossImmediateAdapter;
      case 'BNPL':
        return this.bnplDeferredAdapter;
      case 'REWARD_POINT':
        return this.pointAdapter;
      default:
        throw new RefundExecutionFailedError(
          `지원하지 않는 결제수단: ${methodType}`,
        );
    }
  }

  /**
   * 세션별 총 환불 금액 조회
   */
  private async getTotalRefundedAmount(
    txOrDb: WalletTx | typeof this.db.db,
    paymentSessionId: string,
  ): Promise<number> {
    const [result] = await txOrDb
      .select({
        total: sql<number>`coalesce(sum(${schema.refundEvents.amount}), 0)`,
      })
      .from(schema.refundEvents)
      .innerJoin(
        schema.paymentEvents,
        eq(schema.refundEvents.paymentEventId, schema.paymentEvents.id),
      )
      .where(
        and(
          eq(schema.paymentEvents.paymentSessionId, paymentSessionId),
          eq(schema.refundEvents.status, 'COMPLETED'),
        ),
      );

    return Number(result?.total ?? 0);
  }

  /**
   * 환불 시 포인트 복원 처리
   * - 원래 결제에서 사용된 포인트 비율에 따라 복원
   */
  private async restorePointsForRefund(
    tx: WalletTx,
    paymentSessionId: string,
    refundAmount: number,
    refundId: string,
  ): Promise<number> {
    this.logger.log(
      `🎯 포인트 복원 처리: 세션=${paymentSessionId}, 환불금액=${refundAmount}`,
    );

    // 원래 결제에서 사용된 포인트 조회 (relatedEventId로 찾기)
    const [pointTransaction] = await tx
      .select()
      .from(schema.pointTransactions)
      .where(
        and(
          eq(schema.pointTransactions.relatedEventId, paymentSessionId),
          eq(schema.pointTransactions.type, 'REDEEM'),
        ),
      )
      .limit(1);

    if (!pointTransaction) {
      this.logger.log('포인트 사용 내역이 없어 복원하지 않음');
      return 0;
    }

    // 세션 총액 대비 환불 비율 계산
    const [session] = await tx
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, paymentSessionId))
      .limit(1);

    if (!session) return 0;

    const totalAmount = Number(session.amount);
    const pointsUsed = pointTransaction.amount;
    const refundRatio = refundAmount / totalAmount;
    const pointsToRestore = Math.floor(pointsUsed * refundRatio);

    if (pointsToRestore > 0) {
      // 포인트 복원 트랜잭션 생성
      await tx.insert(schema.pointTransactions).values({
        pointId: pointTransaction.pointId, // 동일한 포인트 계정
        type: 'EARN',
        amount: pointsToRestore,
        relatedEventId: refundId, // 환불 ID와 연관
        reason: `환불로 인한 포인트 복원 (환불ID: ${refundId})`,
      });

      this.logger.log(
        `✅ 포인트 복원 완료: ${pointsToRestore}원 (비율: ${refundRatio.toFixed(2)})`,
      );
    }

    return pointsToRestore;
  }
}
