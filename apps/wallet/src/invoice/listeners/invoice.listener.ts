import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { INVOICE_EVENT_TYPE, INVOICE_STATUS } from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import {
  InvoiceIssuedEvent,
  InvoicePaidEvent,
  InvoiceFailedEvent,
  InvoicePartiallyRefundedEvent,
  InvoiceFullyRefundedEvent,
  InvoiceCancelledEvent,
  InvoiceMarkedAsOverdueEvent,
} from '../events/invoice.events';

/**
 * Invoice 이벤트 리스너 - Event Sourcing Pattern
 * 모든 Invoice 관련 이벤트를 수신하여 InvoiceEvent 테이블에 기록하고
 * Invoice 테이블의 상태를 업데이트합니다.
 */
@Injectable()
export class InvoiceListener {
  private readonly logger = new Logger(InvoiceListener.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 청구서 생성 이벤트 처리
   */
  @OnEvent('invoice.issued')
  async handleInvoiceIssued(event: InvoiceIssuedEvent) {
    this.logger.log(`청구서 생성 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // InvoiceEvent 테이블에 이벤트 기록
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_ISSUED,
          reason: `청구서 생성 - 타입: ${event.invoiceType}, 금액: ${event.amount}원`,
          occurredAt: event.issuedAt,
        });

        this.logger.log(`청구서 생성 이벤트 기록 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 생성 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 결제 완료 이벤트 처리
   */
  @OnEvent('invoice.paid')
  async handleInvoicePaid(event: InvoicePaidEvent) {
    this.logger.log(`청구서 결제 완료 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        //    - 불변(Immutable) 원장: 모든 '사건'을 INSERT만 하고 절대 수정/삭제하지 않음
        //    - 은행의 '거래 내역서'와 같은 역할
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_PAID,
          reason: `결제 완료 - PaymentEvent ID: ${event.paymentEventId}, 금액: ${event.amount}원`,
          occurredAt: event.paidAt,
        });

        // 2. [READ MODEL] Invoice 상태를 PAID로 업데이트 (CQRS)
        //    - 빠른 조회를 위한 미리 계산된 상태: UPDATE로 현재 상태 갱신
        //    - 은행 앱의 '현재 잔액'과 같은 역할
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.PAID,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 결제 완료 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 결제 완료 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 결제 실패 이벤트 처리
   */
  @OnEvent('invoice.failed')
  async handleInvoiceFailed(event: InvoiceFailedEvent) {
    this.logger.log(`청구서 결제 실패 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_FAILED,
          reason: `결제 실패 - PaymentEvent ID: ${event.paymentEventId}, 사유: ${event.reason}`,
          occurredAt: event.failedAt,
        });

        // 2. [READ MODEL] Invoice 상태를 FAILED로 업데이트 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.FAILED,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 결제 실패 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 결제 실패 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 부분 환불 이벤트 처리
   */
  @OnEvent('invoice.partially-refunded')
  async handleInvoicePartiallyRefunded(event: InvoicePartiallyRefundedEvent) {
    this.logger.log(`청구서 부분 환불 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_PARTIALLY_REFUNDED,
          reason: `부분 환불 완료 - 환불액: ${event.refundAmount}원, 잔액: ${event.remainingAmount}원`,
          occurredAt: event.refundedAt,
        });

        // 2. [READ MODEL] Invoice 상태를 PARTIALLY_REFUNDED로 업데이트하고 환불 금액 반영 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.PARTIALLY_REFUNDED,
            refundedAmount: event.refundAmount,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 부분 환불 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 부분 환불 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 전액 환불 이벤트 처리
   */
  @OnEvent('invoice.fully-refunded')
  async handleInvoiceFullyRefunded(event: InvoiceFullyRefundedEvent) {
    this.logger.log(`청구서 전액 환불 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_FULLY_REFUNDED,
          reason: `전액 환불 완료 - 환불액: ${event.refundAmount}원`,
          occurredAt: event.refundedAt,
        });

        // 2. [READ MODEL] Invoice 상태를 REFUNDED로 업데이트하고 환불 금액 반영 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.REFUNDED,
            refundedAmount: event.refundAmount,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 전액 환불 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 전액 환불 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 취소 이벤트 처리
   */
  @OnEvent('invoice.cancelled')
  async handleInvoiceCancelled(event: InvoiceCancelledEvent) {
    this.logger.log(`청구서 취소 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_CANCELLED,
          reason: `청구서 취소 - 사유: ${event.reason}, 취소자: ${event.cancelledBy}`,
          occurredAt: event.cancelledAt,
        });

        // 2. [READ MODEL] Invoice 상태를 CANCELLED로 업데이트 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.CANCELLED,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 취소 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 취소 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }

  /**
   * 청구서 연체 처리 이벤트 처리
   */
  @OnEvent('invoice.marked-as-overdue')
  async handleInvoiceMarkedAsOverdue(event: InvoiceMarkedAsOverdueEvent) {
    this.logger.log(`청구서 연체 처리 이벤트 처리: ${event.invoiceId}`);

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 🏦 CQRS Pattern Implementation
        
        // 1. [WRITE MODEL] InvoiceEvent 테이블에 이벤트 기록 (Event Sourcing)
        await tx.insert(schema.invoiceEvent).values({
          id: ulid(),
          eventUuid: ulid(),
          invoiceId: event.invoiceId,
          eventType: INVOICE_EVENT_TYPE.INVOICE_MARKED_AS_OVERDUE,
          reason: `연체 처리 - 납부 기한: ${event.dueDate.toISOString()}`,
          occurredAt: event.markedAt,
        });

        // 2. [READ MODEL] Invoice 상태를 OVERDUE로 업데이트 (CQRS)
        await tx
          .update(schema.invoice)
          .set({
            status: INVOICE_STATUS.OVERDUE,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoice.id, event.invoiceId));

        this.logger.log(`청구서 연체 처리 이벤트 처리 완료: ${event.invoiceId}`);
      });
    } catch (error) {
      this.logger.error(`청구서 연체 처리 이벤트 처리 실패: ${event.invoiceId}`, error);
    }
  }
}