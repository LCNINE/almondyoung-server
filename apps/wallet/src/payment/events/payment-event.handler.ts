import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { FINANCIAL_TRANSACTION_STATUS } from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import {
  PaymentAuthorizedEvent,
  PaymentCapturedEvent,
  PaymentFailedEvent,
  SettlementBatchStartedEvent,
  SettlementBatchCompletedEvent,
} from './payment.events';

/**
 * Payment 이벤트 리스너 - Event Sourcing Pattern
 * 모든 Payment 관련 이벤트를 수신하여 PaymentEvents 테이블에 기록하고
 * 관련 테이블들의 상태를 업데이트합니다.
 */
@Injectable()
export class PaymentEventHandler {
  private readonly logger = new Logger(PaymentEventHandler.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 결제 승인 이벤트 처리 (AUTHORIZED)
   */
  @OnEvent('payment.authorized')
  async handleAuthorized(event: PaymentAuthorizedEvent) {
    this.logger.log(`결제 승인 이벤트 처리: ${event.paymentEventId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] PaymentEvents 테이블에 이벤트 기록 (Event Sourcing)
        //    - 불변(Immutable) 원장: 모든 '사건'을 INSERT만 하고 절대 수정/삭제하지 않음
        await tx.insert(schema.paymentEvents).values({
          id: event.paymentEventId,
          invoiceId: event.invoiceId,
          paymentMethodId: event.paymentMethodId,
          amount: event.amount,
          status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
          actor: 'USER',
          createdAt: event.authorizedAt,
        });

        // 2. [WRITE MODEL] BnplTransaction 테이블에도 기록
        const bnplAccount = await tx.query.bnplAccount.findFirst({
          where: eq(schema.bnplAccount.userId, event.userId),
        });

        if (bnplAccount) {
          await tx.insert(schema.bnplTransaction).values({
            id: ulid(),
            bnplAccountId: bnplAccount.id,
            invoiceId: event.invoiceId,
            transactionType: 'DEBIT',
            status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
            amount: event.amount,
            createdAt: event.authorizedAt,
          });
        }

        // 3. [READ MODEL] Invoice 상태를 PAID로 업데이트 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: 'PAID',
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`결제 승인 이벤트 처리 완료: ${event.paymentEventId}`);
      });
    } catch (error) {
      this.logger.error(`결제 승인 이벤트 처리 실패: ${event.paymentEventId}`, error);
    }
  }

  /**
   * 결제 완료 이벤트 처리 (CAPTURED)
   */
  @OnEvent('payment.captured')
  async handleCaptured(event: PaymentCapturedEvent) {
    this.logger.log(`결제 완료 이벤트 처리: ${event.paymentEventId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] PaymentEvents 상태 업데이트 (Event Sourcing)
        await tx
          .update(schema.paymentEvents)
          .set({
            status: FINANCIAL_TRANSACTION_STATUS.CAPTURED,
            pgTransactionId: event.pgTransactionId,
            updatedAt: event.capturedAt,
          })
          .where(eq(schema.paymentEvents.id, event.paymentEventId));

        // 2. [WRITE MODEL] BnplTransaction 상태 업데이트
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: FINANCIAL_TRANSACTION_STATUS.CAPTURED,
          })
          .where(eq(schema.bnplTransaction.invoiceId, event.invoiceId));

        this.logger.log(`결제 완료 이벤트 처리 완료: ${event.paymentEventId}`);
      });
    } catch (error) {
      this.logger.error(`결제 완료 이벤트 처리 실패: ${event.paymentEventId}`, error);
    }
  }

  /**
   * 결제 실패 이벤트 처리 (FAILED)
   */
  @OnEvent('payment.failed')
  async handleFailed(event: PaymentFailedEvent) {
    this.logger.log(`결제 실패 이벤트 처리: ${event.paymentEventId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] PaymentEvents 상태 업데이트 (Event Sourcing)
        await tx
          .update(schema.paymentEvents)
          .set({
            status: FINANCIAL_TRANSACTION_STATUS.FAILED,
            errorMessage: event.reason,
            updatedAt: event.failedAt,
          })
          .where(eq(schema.paymentEvents.id, event.paymentEventId));

        // 2. [WRITE MODEL] BnplTransaction 상태 업데이트
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: FINANCIAL_TRANSACTION_STATUS.FAILED,
          })
          .where(eq(schema.bnplTransaction.invoiceId, event.invoiceId));

        // 3. [READ MODEL] Invoice 상태를 FAILED로 업데이트 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: 'FAILED',
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`결제 실패 이벤트 처리 완료: ${event.paymentEventId}`);
      });
    } catch (error) {
      this.logger.error(`결제 실패 이벤트 처리 실패: ${event.paymentEventId}`, error);
    }
  }

  /**
   * 정산 배치 시작 이벤트 처리
   */
  @OnEvent('settlement.batch.started')
  async handleBatchStarted(event: SettlementBatchStartedEvent) {
    this.logger.log(`정산 배치 시작 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 시작 로깅 및 모니터링
      this.logger.log(
        `정산 배치 시작: ${event.batchId}, 총액: ${event.totalAmount}원, 거래수: ${event.transactionCount}건`,
      );
      
      // TODO: 외부 모니터링 시스템에 알림 발송
      // TODO: 정산 시작 메트릭 수집
    } catch (error) {
      this.logger.error(`정산 배치 시작 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 완료 이벤트 처리
   */
  @OnEvent('settlement.batch.completed')
  async handleBatchCompleted(event: SettlementBatchCompletedEvent) {
    this.logger.log(`정산 배치 완료 이벤트 처리: ${event.batchId}`);

    try {
      if (event.status === 'COMPLETED') {
        this.logger.log(
          `정산 배치 성공: ${event.batchId}, 총액: ${event.totalAmount}원`,
        );
        // TODO: 성공 알림 발송
      } else {
        this.logger.error(
          `정산 배치 실패: ${event.batchId}, 총액: ${event.totalAmount}원`,
        );
        // TODO: 실패 알림 발송, 운영팀 에스컬레이션
      }
      
      // TODO: 정산 완료 메트릭 수집
    } catch (error) {
      this.logger.error(`정산 배치 완료 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }
}
