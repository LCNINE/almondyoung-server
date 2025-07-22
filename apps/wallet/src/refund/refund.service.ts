import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { REFUND_STATUS, FINANCIAL_TRANSACTION_STATUS } from '../shared/schemas/schema';
import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { WalletTx } from '../shared/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePartiallyRefundedEvent, InvoiceFullyRefundedEvent } from '../invoice/events/invoice.events';

export interface RefundRequest {
  userId: string;
  paymentEventId: string;
  amount: number;
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

/**
 * 환불(Refund) 도메인 서비스
 * - 역할: CS팀의 수동 환불 처리를 지원합니다.
 * - 환불 요청: 사용자 환불 요청을 접수하고 CS팀에 알림
 * - 환불 관리: CS팀이 환불 요청을 조회하고 완료 처리
 */
// 환불 이벤트 클래스 정의
export class RefundRequestedEvent {
  constructor(
    public readonly refundId: string,
    public readonly data: any,
  ) {}
}
export class RefundCompletedEvent {
  constructor(
    public readonly refundId: string,
    public readonly data: any,
  ) {}
}

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 사용자 환불 요청 처리
   * 효성 CMS는 API 환불을 지원하지 않으므로 CS팀 수동 처리를 위한 요청 기록
   */
  async requestRefund(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `환불 요청 접수: userId=${request.userId}, amount=${request.amount}`,
    );

    try {
      return await this.dbService.db.transaction(async (tx) => {
        // 1. 환불 가능 여부 검증
        await this.validateRefundRequest(tx, request);

        // 2. 환불 요청 이벤트 기록 생성
        const [refundEvent] = await tx
          .insert(schema.refundEvents)
          .values({
            id: ulid(),
            paymentEventId: request.paymentEventId,
            amount: request.amount,
            status: REFUND_STATUS.REQUESTED,
            reason: request.reason,
            createdAt: new Date(),
          })
          .returning();

        this.logger.log(`환불 요청 생성 완료: refundId=${refundEvent.id}`);

        // 3. 이벤트 발행
        this.eventEmitter.emit(
          'refund.requested',
          new RefundRequestedEvent(refundEvent.id, refundEvent),
        );

        // 4. CS팀 알림 (향후 구현)
        await this.notifyCSTeam(refundEvent);

        return {
          success: true,
          refundId: refundEvent.id,
        };
      });
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
  async getRefundRequests(status?: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED'): Promise<any[]> {
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
  async processRefund(refundId: string, processedBy: string, notes?: string): Promise<void> {
    this.logger.log(
      `환불 처리 시작: refundId=${refundId}, processedBy=${processedBy}`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 환불 요청 조회
        const refundEvent = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.id, refundId),
        });

        if (!refundEvent) {
          throw new Error(`환불 요청을 찾을 수 없습니다: ${refundId}`);
        }

        if (refundEvent.status !== REFUND_STATUS.REQUESTED) {
          throw new Error(`이미 처리 중이거나 완료된 환불 요청입니다: ${refundId}`);
        }

        // 2. 환불 상태를 PROCESSING으로 업데이트
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.PROCESSING,
          })
          .where(eq(schema.refundEvents.id, refundId));

        this.logger.log(`환불 처리 시작 성공: refundId=${refundId}, processedBy=${processedBy}`);
      });
    } catch (error) {
      this.logger.error('환불 처리 시작 실패:', error);
      throw error;
    }
  }

  /**
   * CS팀의 환불 완료 처리
   * 수동 이체 완료 후 시스템에서 환불 상태를 완료로 업데이트
   */
  async completeRefund(refundId: string, completedBy: string, notes?: string): Promise<void> {
    this.logger.log(
      `환불 완료 처리: refundId=${refundId}, completedBy=${completedBy}`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 환불 요청 조회
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

        // PROCESSING 상태가 아닌 경우에도 완료 처리 가능 (유연성 제공)
        if (refundEvent.status !== REFUND_STATUS.PROCESSING && refundEvent.status !== REFUND_STATUS.REQUESTED) {
          throw new Error(`완료 처리할 수 없는 상태입니다: ${refundEvent.status}`);
        }

        // 2. 환불 상태를 COMPLETED로 업데이트
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.COMPLETED,
            completedAt: new Date(),
          })
          .where(eq(schema.refundEvents.id, refundId));

        // 3. 환불 완료 이벤트 발행
        this.eventEmitter.emit(
          'refund.completed',
          new RefundCompletedEvent(refundId, refundEvent),
        );

        // 4. ✅ Invoice 환불 이벤트 발행 (Event Sourcing)
        if (refundEvent.paymentEvent?.invoice) {
          const invoice = refundEvent.paymentEvent.invoice;
          const refundAmount = Number(refundEvent.amount);
          const originalAmount = Number(invoice.amount);
          const currentRefundedAmount = Number(invoice.refundedAmount || 0);
          const totalRefundedAmount = currentRefundedAmount + refundAmount;

          if (totalRefundedAmount >= originalAmount) {
            // 전액 환불
            this.eventEmitter.emit(
              'invoice.fully-refunded',
              new InvoiceFullyRefundedEvent(
                invoice.id,
                refundEvent.id,
                refundAmount,
                new Date(),
              ),
            );
          } else {
            // 부분 환불
            const remainingAmount = originalAmount - totalRefundedAmount;
            this.eventEmitter.emit(
              'invoice.partially-refunded',
              new InvoicePartiallyRefundedEvent(
                invoice.id,
                refundEvent.id,
                refundAmount,
                remainingAmount,
                new Date(),
              ),
            );
          }
        }

        this.logger.log(`환불 완료 처리 성공: refundId=${refundId}, completedBy=${completedBy}`);
      });
    } catch (error) {
      this.logger.error('환불 완료 처리 실패:', error);
      throw error;
    }
  }

  /**
   * CS팀의 환불 요청 거절
   * 환불 요청을 검토 후 거절 처리
   */
  async rejectRefund(refundId: string, rejectedBy: string, reason: string, notes?: string): Promise<void> {
    this.logger.log(
      `환불 거절 처리: refundId=${refundId}, rejectedBy=${rejectedBy}, reason=${reason}`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 환불 요청 조회
        const refundEvent = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.id, refundId),
        });

        if (!refundEvent) {
          throw new Error(`환불 요청을 찾을 수 없습니다: ${refundId}`);
        }

        if (refundEvent.status !== REFUND_STATUS.REQUESTED && refundEvent.status !== REFUND_STATUS.PROCESSING) {
          throw new Error(`이미 처리된 환불 요청입니다: ${refundId}`);
        }

        // 2. 환불 상태를 REJECTED로 업데이트
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.REJECTED,
            // 거절 사유를 reason 필드에 업데이트 (기존 사유와 구분)
            reason: `[거절] ${reason} (원래 사유: ${refundEvent.reason})`,
          })
          .where(eq(schema.refundEvents.id, refundId));

        this.logger.log(`환불 거절 처리 성공: refundId=${refundId}, rejectedBy=${rejectedBy}`);
      });
    } catch (error) {
      this.logger.error('환불 거절 처리 실패:', error);
      throw error;
    }
  }

  /**
   * 환불 요청 유효성 검증
   */
  private async validateRefundRequest(
    tx: WalletTx,
    request: RefundRequest,
  ): Promise<void> {
    // 1. 결제 이벤트 존재 여부 확인
    const paymentEvent = await tx.query.paymentEvents.findFirst({
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
    const existingRefund = await tx.query.refundEvents.findFirst({
      where: and(
        eq(schema.refundEvents.paymentEventId, request.paymentEventId),
        eq(schema.refundEvents.status, REFUND_STATUS.REQUESTED),
      ),
    });

    if (existingRefund) {
      throw new InvalidRefundRequestError('이미 환불 요청이 진행 중입니다');
    }
  }

  /**
   * CS팀에 환불 요청 알림 (향후 구현)
   */
  private async notifyCSTeam(refundEvent: any): Promise<void> {
    // TODO: 실제 알림 시스템 연동 (이메일, 슬랙 등)
    this.logger.log(`CS팀 알림 발송: 새로운 환불 요청 ${refundEvent.id}`);
  }
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
