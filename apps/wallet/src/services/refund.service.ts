import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { IdempotencyService } from './idempotency.service';
import { WalletTx } from '../shared/database';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { PaymentGateway } from '../interfaces/payment-gateway.interface';

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

interface PaymentSessionData {
  id: string;
  amount: string | number;
  status: string;
}

interface PaymentEventData {
  id: string;
  pgTransactionId: string | null;
  paymentSessionId: string;
  status: string;
}

interface PaymentMethodData {
  id: string;
  methodType: string;
}

interface RefundEventData {
  id: string;
  paymentEventId: string;
  amount: number;
  status: string;
  reason: string | null;
  createdAt: Date;
  completedAt: Date | null;
  metadata: string | null;
}

interface RefundValidationResult {
  session: PaymentSessionData;
  paymentEvent: PaymentEventData;
  totalRefunded: number;
  remainingAmount: number;
}

interface ApprovalContext {
  refundEvent: RefundEventData;
  paymentData: {
    paymentEvent: PaymentEventData;
    paymentMethod: PaymentMethodData;
    session: PaymentSessionData;
  };
}

interface RefundExecutionResult {
  finalStatus: 'COMPLETED' | 'FAILED';
  processedAt: Date;
  refundResult: {
    success: boolean;
    pgTransactionId?: string;
    error?: string;
  };
}

interface RefundWithSessionData {
  refund: RefundEventData;
  session: PaymentSessionData;
}

interface CancellationContext {
  refundEvent: RefundEventData;
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
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly gatewayFactory: PaymentGatewayFactory,
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
      const idempotencyResult =
        await this.idempotency.checkOrCreate<RefundResponse>(
          tx,
          idempotencyKey,
          request,
          `/refunds/request`,
        );
      if (idempotencyResult.hit) return idempotencyResult.response!;

      // ✅ 세부 에러 클래스 대신 단순 Error 사용
      const refundValidation = await this.validateRefundRequest(tx, request);

      const refundEvent = await this.createRefundRequestRecord(
        tx,
        request,
        refundValidation.paymentEvent.id,
      );

      const response = this.buildRefundResponse(
        refundEvent,
        request,
        refundValidation.totalRefunded,
        refundValidation.remainingAmount - request.amount,
      );

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
      const idempotencyResult =
        await this.idempotency.checkOrCreate<RefundResponse>(
          tx,
          idempotencyKey,
          request,
          `/refunds/${request.refundId}/approve`,
        );
      if (idempotencyResult.hit) return idempotencyResult.response!;

      // 환불 요청 검증 및 결제 정보 조회
      const approvalContext = await this.validateAndGetApprovalContext(
        tx,
        request,
      );

      // 환불 승인 상태로 변경
      await this.updateRefundStatusToApproved(tx, request);

      // 실제 환급 실행
      const refundExecutionResult = await this.executeRefund(
        tx,
        approvalContext,
        request,
      );

      // 최종 응답 생성
      const response = await this.buildApprovalResponse(
        tx,
        request,
        approvalContext,
        refundExecutionResult,
      );

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
      const idempotencyResult =
        await this.idempotency.checkOrCreate<RefundResponse>(
          tx,
          idempotencyKey,
          request,
          `/refunds/${request.refundId}/cancel`,
        );
      if (idempotencyResult.hit) return idempotencyResult.response!;

      // 환불 취소 가능 여부 검증
      const cancellationContext = await this.validateRefundCancellation(
        tx,
        request,
      );

      // 환불 취소 처리
      await this.updateRefundStatusToCancelled(tx, request);

      // 취소 응답 생성
      const response = await this.buildCancellationResponse(
        tx,
        request,
        cancellationContext,
      );

      await this.idempotency.complete(tx, idempotencyKey, response, 200);
      return response;
    });
  }

  /**
   * 환불 상세 정보 조회
   */
  async getRefund(refundId: string): Promise<RefundResponse> {
    const refundData = await this.getRefundWithSessionData(refundId);

    const totalRefunded = await this.getTotalRefundedAmount(
      this.db.db,
      refundData.session.id,
    );

    return this.buildRefundQueryResponse(refundData, totalRefunded);
  }

  /**
   * 환불 및 세션 데이터 조회
   */
  private async getRefundWithSessionData(
    refundId: string,
  ): Promise<RefundWithSessionData> {
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
      throw new Error(`Refund not found: ${refundId}`);
    }

    return refundData as RefundWithSessionData;
  }

  /**
   * 환불 조회 응답 생성
   */
  private buildRefundQueryResponse(
    refundData: RefundWithSessionData,
    totalRefunded: number,
  ): RefundResponse {
    const remainingAmount = Number(refundData.session.amount) - totalRefunded;

    return {
      refundId: refundData.refund.id,
      paymentSessionId: refundData.session.id,
      status: refundData.refund.status as RefundResponse['status'],
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
   * 결제수단별 환불 게이트웨이 선택 (표준 PaymentGateway 사용)
   */
  private getPaymentGateway(methodType: string): PaymentGateway {
    return this.gatewayFactory.getGatewayByMethodType(methodType);
  }

  /**
   * 환불 요청 검증
   */
  private async validateRefundRequest(
    tx: WalletTx,
    request: RefundRequest,
  ): Promise<RefundValidationResult> {
    const [session] = await tx
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, request.paymentSessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Refund not found: ${request.paymentSessionId}`);
    }

    if (session.status !== 'CAPTURED') {
      throw new Error(`Refund already processed: ${session.status}`);
    }

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
      throw new Error(
        `Refund event not found for session: ${request.paymentSessionId}`,
      );
    }

    const totalRefunded = await this.getTotalRefundedAmount(
      tx,
      request.paymentSessionId,
    );
    const sessionAmount = Number(session.amount);
    const remainingAmount = sessionAmount - totalRefunded;

    if (request.amount > remainingAmount) {
      throw new Error(
        `Refund amount exceeds limit. requested=${request.amount}, limit=${remainingAmount}`,
      );
    }

    return {
      session: session as PaymentSessionData,
      paymentEvent: paymentEvent as PaymentEventData,
      totalRefunded,
      remainingAmount,
    };
  }

  /**
   * 환불 요청 기록 생성
   */
  private async createRefundRequestRecord(
    tx: WalletTx,
    request: RefundRequest,
    paymentEventId: string,
  ): Promise<RefundEventData> {
    const refundId = this.generateRefundId();

    const [refundEvent] = await tx
      .insert(schema.refundEvents)
      .values({
        id: refundId,
        paymentEventId,
        amount: request.amount,
        status: 'REQUESTED',
        reason: request.reason,
        metadata: request.metadata
          ? JSON.stringify(request.metadata)
          : undefined,
      })
      .returning();

    return refundEvent as RefundEventData;
  }

  /**
   * 환불 응답 객체 생성
   */
  private buildRefundResponse(
    refundEvent: RefundEventData,
    request: RefundRequest,
    totalRefunded: number,
    remainingRefundable: number,
  ): RefundResponse {
    return {
      refundId: refundEvent.id,
      paymentSessionId: request.paymentSessionId,
      status: 'REQUESTED',
      amount: request.amount,
      totalRefundedAmount: totalRefunded,
      remainingRefundableAmount: remainingRefundable,
      createdAt: refundEvent.createdAt.toISOString(),
      metadata: request.metadata,
    };
  }

  /**
   * 고유한 환불 ID 생성
   */
  private generateRefundId(): string {
    return `refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * 환불 승인을 위한 컨텍스트 검증 및 조회
   */
  private async validateAndGetApprovalContext(
    tx: WalletTx,
    request: RefundApprovalRequest,
  ): Promise<ApprovalContext> {
    // 환불 이벤트 조회
    const [refundEvent] = await tx
      .select()
      .from(schema.refundEvents)
      .where(eq(schema.refundEvents.id, request.refundId))
      .limit(1);
    if (!refundEvent) {
      throw new Error(`Refund not found: ${request.refundId}`);
    }

    if (refundEvent.status !== 'REQUESTED') {
      throw new Error(`Refund already processed: ${refundEvent.status}`);
    }

    // 결제 이벤트 및 세션 조회
    const [paymentData] = await tx
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

    if (!paymentData) {
      throw new Error(`Refund not found: ${refundEvent.paymentEventId}`);
    }

    return {
      refundEvent: refundEvent as RefundEventData,
      paymentData: {
        paymentEvent: paymentData.paymentEvent as PaymentEventData,
        paymentMethod: paymentData.paymentMethod as PaymentMethodData,
        session: paymentData.session as PaymentSessionData,
      },
    };
  }

  /**
   * 환불 상태를 승인으로 변경
   */
  private async updateRefundStatusToApproved(
    tx: WalletTx,
    request: RefundApprovalRequest,
  ): Promise<void> {
    await tx
      .update(schema.refundEvents)
      .set({
        status: 'APPROVED',
        metadata: JSON.stringify({
          approvalInfo: request.approvalInfo,
        }),
      })
      .where(eq(schema.refundEvents.id, request.refundId));
  }

  /**
   * 실제 환급 실행
   */
  private async executeRefund(
    tx: WalletTx,
    approvalContext: ApprovalContext,
    request: RefundApprovalRequest,
  ): Promise<RefundExecutionResult> {
    const { paymentData, refundEvent } = approvalContext;

    const gateway = this.getPaymentGateway(
      paymentData.paymentMethod.methodType,
    );

    const refundResult = await gateway.refundPayment(
      paymentData.paymentEvent.pgTransactionId || 'mock_refund_tx',
      request.approvalInfo.finalAmount,
      refundEvent.reason || '외부 승인된 환불',
    );

    const finalStatus: 'COMPLETED' | 'FAILED' = refundResult.success
      ? 'COMPLETED'
      : 'FAILED';
    const processedAt = new Date();

    if (refundResult.success) {
      this.logger.log(
        `✅ 환급 실행 완료: ${request.refundId} → ${refundResult.pgTransactionId}`,
      );
    } else {
      this.logger.error(
        `❌ 환급 실행 실패: ${request.refundId} → ${refundResult.error}`,
      );
    }

    // 환불 최종 상태 업데이트
    await this.updateRefundFinalStatus(
      tx,
      request.refundId,
      finalStatus,
      processedAt,
      request.approvalInfo.approvedBy,
      refundResult,
    );

    return { finalStatus, processedAt, refundResult };
  }

  /**
   * 환불 최종 상태 업데이트
   */
  private async updateRefundFinalStatus(
    tx: WalletTx,
    refundId: string,
    status: 'COMPLETED' | 'FAILED',
    processedAt: Date,
    completedBy: string,
    refundResult: RefundExecutionResult['refundResult'],
  ): Promise<void> {
    await tx
      .update(schema.refundEvents)
      .set({
        status,
        completedAt: processedAt,
        completedBy,
        rejectionReason: refundResult.success ? undefined : refundResult.error,
        metadata: JSON.stringify({
          executionResult: {
            pgTransactionId: refundResult.pgTransactionId,
            executedAt: processedAt.toISOString(),
            success: refundResult.success,
          },
        }),
      })
      .where(eq(schema.refundEvents.id, refundId));
  }

  /**
   * 환불 승인 응답 생성
   */
  private async buildApprovalResponse(
    tx: WalletTx,
    request: RefundApprovalRequest,
    approvalContext: ApprovalContext,
    executionResult: RefundExecutionResult,
  ): Promise<RefundResponse> {
    const { refundEvent, paymentData } = approvalContext;
    const { finalStatus, processedAt, refundResult } = executionResult;

    // 포인트 복원 처리 (환불 성공 시)
    let pointsRestored = 0;
    if (refundResult.success) {
      pointsRestored = await this.restorePointsForRefund(
        tx,
        paymentData.session.id,
        request.approvalInfo.finalAmount,
        refundEvent.id,
      );
    }

    // 누적 환불 금액 재계산
    const totalRefunded = await this.getTotalRefundedAmount(
      tx,
      paymentData.session.id,
    );
    const remainingAmount = Number(paymentData.session.amount) - totalRefunded;

    return {
      refundId: request.refundId,
      paymentSessionId: paymentData.session.id,
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
   * 환불 취소 가능 여부 검증
   */
  private async validateRefundCancellation(
    tx: WalletTx,
    request: RefundCancellationRequest,
  ): Promise<CancellationContext> {
    const [refundEvent] = await tx
      .select()
      .from(schema.refundEvents)
      .where(eq(schema.refundEvents.id, request.refundId))
      .limit(1);

    if (!refundEvent) {
      throw new Error(`Refund not found: ${request.refundId}`);
    }

    if (refundEvent.status !== 'REQUESTED') {
      throw new Error(`Refund already processed: ${refundEvent.status}`);
    }

    return { refundEvent: refundEvent as RefundEventData };
  }

  /**
   * 환불 상태를 취소로 변경
   */
  private async updateRefundStatusToCancelled(
    tx: WalletTx,
    request: RefundCancellationRequest,
  ): Promise<void> {
    const cancelledAt = new Date();
    await tx
      .update(schema.refundEvents)
      .set({
        status: 'CANCELLED',
        completedAt: cancelledAt,
        completedBy: request.cancelledBy,
        rejectionReason: request.reason,
        metadata: JSON.stringify({
          cancellationInfo: {
            cancelledBy: request.cancelledBy,
            reason: request.reason,
            cancelledAt: cancelledAt.toISOString(),
          },
        }),
      })
      .where(eq(schema.refundEvents.id, request.refundId));
  }

  /**
   * 환불 취소 응답 생성
   */
  private async buildCancellationResponse(
    tx: WalletTx,
    request: RefundCancellationRequest,
    cancellationContext: CancellationContext,
  ): Promise<RefundResponse> {
    const { refundEvent } = cancellationContext;

    // 세션 정보 조회 (응답용)
    const [paymentSessionData] = await tx
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

    if (!paymentSessionData) {
      throw new Error(
        `결제이벤트를 찾을수없습니다: ${refundEvent.paymentEventId}`,
      );
    }

    const totalRefunded = await this.getTotalRefundedAmount(
      tx,
      paymentSessionData.session.id,
    );
    const remainingAmount =
      Number(paymentSessionData.session.amount) - totalRefunded;

    return {
      refundId: request.refundId,
      paymentSessionId: paymentSessionData.session.id,
      status: 'CANCELLED',
      amount: refundEvent.amount,
      totalRefundedAmount: totalRefunded,
      remainingRefundableAmount: remainingAmount,
      createdAt: refundEvent.createdAt.toISOString(),
      processedAt: new Date().toISOString(),
      metadata: {
        cancellationInfo: {
          cancelledBy: request.cancelledBy,
          reason: request.reason,
          cancelledAt: new Date().toISOString(),
        },
      },
    };
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

    // 원래 결제에서 사용된 포인트 조회
    const originalPointUsage = await this.getOriginalPointUsage(
      tx,
      paymentSessionId,
    );
    if (!originalPointUsage) {
      this.logger.log('포인트 사용 내역이 없어 복원하지 않음');
      return 0;
    }

    // 복원할 포인트 금액 계산
    const pointsToRestore = await this.calculatePointsToRestore(
      tx,
      paymentSessionId,
      refundAmount,
      originalPointUsage.amount,
    );

    if (pointsToRestore > 0) {
      await this.createPointRestorationTransaction(
        tx,
        originalPointUsage.pointId,
        pointsToRestore,
        refundId,
      );
    }

    return pointsToRestore;
  }

  /**
   * 원래 결제에서 사용된 포인트 조회
   */
  private async getOriginalPointUsage(tx: WalletTx, paymentSessionId: string) {
    const [pointTransaction] = await tx
      .select()
      .from(schema.pointEvents)
      .where(
        and(
          eq(schema.pointEvents.relatedEventId, paymentSessionId),
          eq(schema.pointEvents.type, 'REDEEM'),
        ),
      )
      .limit(1);

    return pointTransaction;
  }

  /**
   * 복원할 포인트 금액 계산
   */
  private async calculatePointsToRestore(
    tx: WalletTx,
    paymentSessionId: string,
    refundAmount: number,
    pointsUsed: number,
  ): Promise<number> {
    const [session] = await tx
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, paymentSessionId))
      .limit(1);

    if (!session) return 0;

    const totalPaymentAmount = Number(session.amount);
    const refundRatio = refundAmount / totalPaymentAmount;
    const pointsToRestore = Math.floor(pointsUsed * refundRatio);

    this.logger.log(
      `💡 포인트 복원 계산: 사용=${pointsUsed}, 비율=${refundRatio.toFixed(2)}, 복원=${pointsToRestore}`,
    );

    return pointsToRestore;
  }

  /**
   * 포인트 복원 트랜잭션 생성
   */
  private async createPointRestorationTransaction(
    tx: WalletTx,
    pointId: string,
    pointsToRestore: number,
    refundId: string,
  ): Promise<void> {
    await tx.insert(schema.pointEvents).values({
      pointId,
      type: 'EARN',
      amount: pointsToRestore,
      relatedEventId: refundId,
      reason: `환불로 인한 포인트 복원 (환불ID: ${refundId})`,
    });

    this.logger.log(`✅ 포인트 복원 완료: ${pointsToRestore}원`);
  }
}
