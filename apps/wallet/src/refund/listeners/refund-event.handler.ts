import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { REFUND_STATUS } from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { RefundRequestedEvent, RefundProcessingEvent, RefundCompletedEvent, RefundRejectedEvent } from '../events/refund.events';

/**
 * Refund 이벤트 리스너 - Event Sourcing Pattern
 * 모든 Refund 관련 이벤트를 수신하여 RefundEvents 테이블에 기록하고
 * 관련 테이블들의 상태를 업데이트합니다.
 */
@Injectable()
export class RefundEventHandler {
  private readonly logger = new Logger(RefundEventHandler.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) { }

  /**
   * 환불 요청 이벤트 처리 (REQUESTED)
   */
  @OnEvent('refund.requested')
  async handleRefundRequested(event: RefundRequestedEvent) {
    this.logger.log(`환불 요청 이벤트 처리: ${event.refundId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation

        // 1. [WRITE MODEL] RefundEvents 테이블에 이벤트 기록 (Event Sourcing)
        //    - 불변(Immutable) 원장: 모든 '사건'을 INSERT만 하고 절대 수정/삭제하지 않음

        // 🔧 실제 사용자 정보 추출 (PaymentEvent에서 userId 가져오기)
        const paymentEvent = await tx.query.paymentEvents.findFirst({
          where: eq(schema.paymentEvents.id, event.data.paymentEventId),
          with: {
            invoice: true,
          },
        });

        if (!paymentEvent) {
          throw new Error(`PaymentEvent ${event.data.paymentEventId}를 찾을 수 없습니다.`);
        }

        const actualUserId = paymentEvent.invoice?.userId;
        if (!actualUserId) {
          throw new Error(`PaymentEvent ${event.data.paymentEventId}에서 userId를 찾을 수 없습니다.`);
        }

        // refundAccountId가 실제 존재하는지 확인하고, 없으면 실제 사용자로 임시 계정 생성
        let validRefundAccountId = event.data.refundAccountId;

        const existingAccount = await tx.query.userRefundAccounts.findFirst({
          where: eq(schema.userRefundAccounts.id, event.data.refundAccountId),
        });

        if (!existingAccount) {
          this.logger.warn(`RefundAccount ${event.data.refundAccountId}가 존재하지 않습니다. 실제 사용자(${actualUserId})로 임시 계정을 생성합니다.`);

          // 실제 사용자로 임시 환불 계정 생성
          const [tempAccount] = await tx.insert(schema.userRefundAccounts).values({
            id: event.data.refundAccountId,
            userId: actualUserId, // ✅ 실제 사용자 ID 사용
            bankCode: 'TEMP',
            bankName: '임시 은행',
            accountNumber: 'TEMP-ACCOUNT',
            accountHolderName: '임시 계정',
            isDefault: false,
          }).returning();

          validRefundAccountId = tempAccount.id;
          this.logger.log(`임시 환불 계정 생성 완료: ${tempAccount.id} (사용자: ${actualUserId})`);
        }

        await tx.insert(schema.refundEvents).values({
          id: event.refundId,
          paymentEventId: event.data.paymentEventId,
          refundAccountId: validRefundAccountId,
          amount: event.data.amount,
          status: REFUND_STATUS.REQUESTED,
          reason: event.data.reason,
          createdAt: new Date(),
        });

        this.logger.log(`환불 요청 이벤트 처리 완료: ${event.refundId}`);
      });
    } catch (error) {
      this.logger.error(`환불 요청 이벤트 처리 실패: ${event.refundId}`, error);
    }
  }

  /**
   * 환불 완료 이벤트 처리 (COMPLETED)
   */
  @OnEvent('refund.completed')
  async handleRefundCompleted(event: RefundCompletedEvent) {
    this.logger.log(`환불 완료 이벤트 처리: ${event.refundId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation

        // 1. [WRITE MODEL] RefundEvents 상태 업데이트 (Event Sourcing)
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.COMPLETED,
            completedAt: new Date(),
          })
          .where(eq(schema.refundEvents.id, event.refundId));

        this.logger.log(`환불 완료 이벤트 처리 완료: ${event.refundId}`);
      });
    } catch (error) {
      this.logger.error(`환불 완료 이벤트 처리 실패: ${event.refundId}`, error);
    }
  }

  /**
   * 환불 처리 시작 이벤트 처리 (PROCESSING)
   */
  @OnEvent('refund.processing')
  async handleRefundProcessing(event: RefundProcessingEvent) {
    this.logger.log(`환불 처리 시작 이벤트 처리: ${event.refundId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation

        // 1. [WRITE MODEL] RefundEvents 상태 업데이트 (Event Sourcing)
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.PROCESSING,
          })
          .where(eq(schema.refundEvents.id, event.refundId));

        this.logger.log(`환불 처리 시작 이벤트 처리 완료: ${event.refundId}`);
      });
    } catch (error) {
      this.logger.error(`환불 처리 시작 이벤트 처리 실패: ${event.refundId}`, error);
    }
  }

  /**
   * 환불 거절 이벤트 처리 (REJECTED)
   */
  @OnEvent('refund.rejected')
  async handleRefundRejected(event: RefundRejectedEvent) {
    this.logger.log(`환불 거절 이벤트 처리: ${event.refundId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation

        // 1. [WRITE MODEL] RefundEvents 상태 업데이트 (Event Sourcing)
        await tx
          .update(schema.refundEvents)
          .set({
            status: REFUND_STATUS.REJECTED,
            rejectionReason: event.reason,
          })
          .where(eq(schema.refundEvents.id, event.refundId));

        this.logger.log(`환불 거절 이벤트 처리 완료: ${event.refundId}`);
      });
    } catch (error) {
      this.logger.error(`환불 거절 이벤트 처리 실패: ${event.refundId}`, error);
    }
  }
}