import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import {
  REFUND_STATUS,
  FINANCIAL_TRANSACTION_STATUS,
} from '../shared/schemas/schema';
import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InvoicePartiallyRefundedEvent,
  InvoiceFullyRefundedEvent,
} from '../invoice/events/invoice.events';
import {
  RefundProcessingEvent,
  RefundCompletedEvent,
  RefundRejectedEvent,
} from './events/refund.events';
import { RefundGatewayFactory } from './factories/refund-gateway.factory';

export interface RefundRequest {
  userId: string;
  paymentEventId: string;
  refundAccountId: string; // ✅ 환불 계좌 ID 추가
  amount: number;
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

// 서비스 내부 이벤트/페이로드 타입 명확 선언
export interface RefundProcessingEventData {
  refundId: string;
  processedBy: string;
  notes?: string;
  processedAt?: Date;
}

export interface RefundCompletedEventData {
  refundId: string;
  completedBy: string;
  notes?: string;
  completedAt?: Date;
}

export interface RefundRejectedEventData {
  refundId: string;
  rejectedBy: string;
  reason: string;
  notes?: string;
  rejectedAt?: Date;
}

// 예시: RefundEvent 타입 명확 선언 (DB에 없으므로 직접 선언)
export interface RefundEvent {
  id: string;
  paymentEventId: string;
  refundAccountId: string;
  amount: number;
  status: string;
  reason: string | null;
  createdAt: Date;
  completedAt?: Date | null;
  rejectionReason?: string | null;
  // 필요한 필드 추가
  paymentEvent?: {
    invoice?: {
      id: string;
      amount: number;
      refundedAmount?: number;
    };
  };
}

/**
 * 환불(Refund) 도메인 서비스 - Event Sourcing Pattern 적용
 * - 역할: CS팀의 수동 환불 처리를 지원합니다.
 * - 환불 요청: 사용자 환불 요청을 접수하고 CS팀에 알림
 * - 환불 관리: CS팀이 환불 요청을 조회하고 완료 처리
 * - Event Sourcing: 모든 환불 상태 변경을 이벤트로 발행
 */

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
    private readonly refundGatewayFactory: RefundGatewayFactory,
  ) {}

  /**
   * 환불 요청 접수 (포트와 어댑터 패턴 적용)
   * 결제수단에 따라 적절한 환불 방식을 자동 선택하여 처리
   */
  async requestRefund(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `환불 요청 접수: userId=${request.userId}, amount=${request.amount}`,
    );

    try {
      // 1. 환불 가능 여부 검증 (트랜잭션 없이 검증)
      await this.validateRefundRequest(request);

      // 2. 원본 결제의 결제수단 조회
      const paymentMethod = await this.getPaymentMethodForEvent(
        request.paymentEventId,
      );

      // 3. 🏭 팩토리에게 적절한 환불 어댑터 요청
      const refundProcessor =
        this.refundGatewayFactory.getAdapterFor(paymentMethod);

      // 4. 🎯 환불 처리 위임 (포트와 어댑터 패턴)
      const refundId = ulid();
      const refundResult = await refundProcessor.processRefund({
        refundId,
        paymentEventId: request.paymentEventId,
        refundAccountId: request.refundAccountId,
        amount: request.amount,
        reason: request.reason,
        userId: request.userId,
      });

      this.logger.log(`환불 처리 결과: ${JSON.stringify(refundResult)}`);

      return {
        success: refundResult.success,
        refundId: refundResult.refundId,
        error: refundResult.success ? undefined : refundResult.message,
      };
    } catch (error) {
      this.logger.error('환불 요청 처리 실패:', error);

      if (error instanceof InvalidRefundRequestError) {
        return { success: false, error: error.message };
      }

      return { success: false, error: 'REFUND_REQUEST_FAILED' };
    }
  }

  /**
   * CS팀용 환불 요청 목록 조회
   */
  async getRefundRequests(
    status?: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED',
  ): Promise<RefundEvent[]> {
    this.logger.log(`환불 요청 목록 조회: status=${status || 'ALL'}`);

    try {
      const whereCondition = status
        ? eq(schema.refundEvents.status, status)
        : undefined;

      const refundRequests =
        await this.dbService.db.query.refundEvents.findMany({
          where: whereCondition,
          with: {
            paymentEvent: {
              with: {
                invoice: true,
                paymentMethod: true,
              },
            },
          },
          orderBy: (refundEvents, { desc }) => [desc(refundEvents.createdAt)],
        });

      this.logger.log(`환불 요청 목록 조회 완료: ${refundRequests.length}건`);
      return refundRequests;
    } catch (error) {
      this.logger.error('환불 요청 목록 조회 실패:', error);
      throw error;
    }
  }

  /**
   * CS팀의 환불 처리 시작
   * 환불 요청을 검토하고 처리 시작 상태로 변경
   */
  async processRefund(
    refundId: string,
    processedBy: string,
    notes?: string,
  ): Promise<void> {
    this.logger.log(
      `환불 처리 시작: refundId=${refundId}, processedBy=${processedBy}`,
    );

    let shouldEmit = false;
    try {
      await this.dbService.db.transaction(async (tx) => {
        const refundEvent = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.id, refundId),
        });
        if (!refundEvent) {
          throw new Error(`환불 요청을 찾을 수 없습니다: ${refundId}`);
        }
        if (refundEvent.status !== REFUND_STATUS.REQUESTED) {
          throw new Error(
            `이미 처리 중이거나 완료된 환불 요청입니다: ${refundId}`,
          );
        }
        // 트랜잭션 내에서 상태를 먼저 업데이트
        await tx
          .update(schema.refundEvents)
          .set({ status: REFUND_STATUS.PROCESSING })
          .where(eq(schema.refundEvents.id, refundId));
        shouldEmit = true;
      });
      // 트랜잭션 커밋 후 이벤트 발행
      if (shouldEmit) {
        this.eventEmitter.emit(
          'refund.processing',
          new RefundProcessingEvent(refundId, processedBy, notes),
        );
      }
    } catch (error) {
      this.logger.error('환불 처리 시작 실패:', error);
      throw error;
    }
  }

  /**
   * CS팀의 환불 완료 처리
   * 수동 이체 완료 후 시스템에서 환불 상태를 완료로 업데이트
   */
  async completeRefund(refundId: string, completedBy: string): Promise<void> {
    this.logger.log(
      `환불 완료 처리: refundId=${refundId}, completedBy=${completedBy}`,
    );
    let shouldEmit = false;
    let refundEventData: RefundEvent | undefined;
    let invoiceData: InvoiceData | undefined;
    try {
      await this.dbService.db.transaction(async (tx) => {
        const refundEvent = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.id, refundId),
          with: {
            paymentEvent: {
              with: {
                invoice: true,
              },
            },
          },
        });
        if (!refundEvent) {
          throw new Error(`환불 요청을 찾을 수 없습니다: ${refundId}`);
        }
        if (refundEvent.status === REFUND_STATUS.COMPLETED) {
          throw new Error(`이미 완료된 환불 요청입니다: ${refundId}`);
        }
        if (
          refundEvent.status !== REFUND_STATUS.PROCESSING &&
          refundEvent.status !== REFUND_STATUS.REQUESTED
        ) {
          throw new Error(
            `완료 처리할 수 없는 상태입니다: ${refundEvent.status}`,
          );
        }
        // 트랜잭션 내에서 상태를 먼저 업데이트
        await tx
          .update(schema.refundEvents)
          .set({ status: REFUND_STATUS.COMPLETED, completedAt: new Date() })
          .where(eq(schema.refundEvents.id, refundId));
        refundEventData = refundEvent;
        if (refundEvent.paymentEvent?.invoice) {
          const invoice = refundEvent.paymentEvent.invoice;
          const refundAmount = Number(refundEvent.amount);
          const originalAmount = Number(invoice.amount);
          const currentRefundedAmount = Number(invoice.refundedAmount || 0);
          const totalRefundedAmount = currentRefundedAmount + refundAmount;

          invoiceData = {
            invoiceId: invoice.id,
            refundAmount,
            originalAmount,
            totalRefundedAmount,
            isFullRefund: totalRefundedAmount >= originalAmount,
            remainingAmount: originalAmount - totalRefundedAmount,
          } as InvoiceData;
        }
        shouldEmit = true;
      });
      // 트랜잭션 커밋 후 이벤트 발행
      if (shouldEmit) {
        this.eventEmitter.emit(
          'refund.completed',
          new RefundCompletedEvent(refundId, refundEventData),
        );
        if (invoiceData) {
          const { invoiceId, refundAmount, isFullRefund, remainingAmount } =
            invoiceData;
          if (isFullRefund) {
            this.eventEmitter.emit(
              'invoice.fully-refunded',
              new InvoiceFullyRefundedEvent(
                invoiceId,
                refundId,
                refundAmount,
                new Date(),
              ),
            );
          } else {
            this.eventEmitter.emit(
              'invoice.partially-refunded',
              new InvoicePartiallyRefundedEvent(
                invoiceId,
                refundId,
                refundAmount,
                remainingAmount,
                new Date(),
              ),
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('환불 완료 처리 실패:', error);
      throw error;
    }
  }

  /**
   * CS팀의 환불 요청 거절
   * 환불 요청을 검토 후 거절 처리
   */
  async rejectRefund(
    refundId: string,
    rejectedBy: string,
    reason: string,
    notes?: string,
  ): Promise<void> {
    this.logger.log(
      `환불 거절 처리: refundId=${refundId}, rejectedBy=${rejectedBy}, reason=${reason}`,
    );
    let shouldEmit = false;
    let formattedReason = '';
    try {
      await this.dbService.db.transaction(async (tx) => {
        const refundEvent = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.id, refundId),
        });
        if (!refundEvent) {
          throw new Error(`환불 요청을 찾을 수 없습니다: ${refundId}`);
        }
        if (
          refundEvent.status !== REFUND_STATUS.REQUESTED &&
          refundEvent.status !== REFUND_STATUS.PROCESSING
        ) {
          throw new Error(`이미 처리된 환불 요청입니다: ${refundId}`);
        }
        formattedReason = `[거절] ${reason} (원래 사유: ${refundEvent.reason})`;
        // 트랜잭션 내에서 상태를 먼저 업데이트
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.REJECTED,
            rejectionReason: formattedReason,
          })
          .where(eq(schema.refundEvents.id, refundId));
        shouldEmit = true;
      });
      // 트랜잭션 커밋 후 이벤트 발행
      if (shouldEmit) {
        this.eventEmitter.emit(
          'refund.rejected',
          new RefundRejectedEvent(refundId, rejectedBy, formattedReason, notes),
        );
      }
    } catch (error) {
      this.logger.error('환불 거절 처리 실패:', error);
      throw error;
    }
  }

  /**
   * 환불 요청 유효성 검증
   */
  private async validateRefundRequest(request: RefundRequest): Promise<void> {
    // 1. 결제 이벤트 존재 여부 확인
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, request.paymentEventId),
      with: {
        invoice: true,
      },
    });
    if (!paymentEvent) {
      throw new InvalidRefundRequestError('결제 내역을 찾을 수 없습니다');
    }
    // 2. 결제 상태 확인 (CAPTURED 상태만 환불 가능)
    if (paymentEvent.status !== FINANCIAL_TRANSACTION_STATUS.CAPTURED) {
      throw new InvalidRefundRequestError('완료된 결제만 환불 가능합니다');
    }
    // 3. 환불 금액 검증
    if (request.amount <= 0 || request.amount > paymentEvent.amount) {
      throw new InvalidRefundRequestError('유효하지 않은 환불 금액입니다');
    }
    // 4. 중복 환불 요청 확인
    const existingRefund = await this.dbService.db.query.refundEvents.findFirst(
      {
        where: and(
          eq(schema.refundEvents.paymentEventId, request.paymentEventId),
          eq(schema.refundEvents.status, REFUND_STATUS.REQUESTED),
        ),
      },
    );
    if (existingRefund) {
      throw new InvalidRefundRequestError('이미 환불 요청이 진행 중입니다');
    }
  }

  /**
   * PaymentEvent에서 결제수단 정보 조회
   */
  private async getPaymentMethodForEvent(paymentEventId: string) {
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, paymentEventId),
      with: {
        paymentMethod: true,
      },
    });

    if (!paymentEvent?.paymentMethod) {
      throw new Error(
        `PaymentEvent ${paymentEventId}의 결제수단을 찾을 수 없습니다`,
      );
    }

    return paymentEvent.paymentMethod;
  }

  /**
   * CS팀에 환불 요청 알림 (향후 구현)
   */
}

/**
 * 환불 요청 유효성 검증 오류
 */
export class InvalidRefundRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRefundRequestError';
  }
}

interface InvoiceData {
  invoiceId: string;
  refundAmount: number;
  originalAmount: number;
  totalRefundedAmount: number;
  isFullRefund: boolean;
  remainingAmount: number;
}
