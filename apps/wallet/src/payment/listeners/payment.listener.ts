import { Injectable, forwardRef, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ulid } from 'ulid';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { InvoiceService } from '../../invoice/invoice.service';
import {
  DuplicatePaymentAttemptedEvent,
  PaymentFailedEvent,
  PaymentSucceededEvent,
  RefundSucceededEvent,
  RefundFailedEvent,
} from '../events/payment.events';
import * as invoiceSchema from '../../invoice/schema';
import { PaymentService } from '../payment.service';
import { eq } from 'drizzle-orm';

const INVOICE_STATUS = {
  PAID: 'PAID',
  FAILED: 'FAILED',
  ISSUED: 'ISSUED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;

const EVENT_TYPE = {
  DUPLICATE_ATTEMPT: 'DUPLICATE_ATTEMPT',
}

@Injectable()
export class PaymentEventListener {
  private readonly logger = new Logger(PaymentEventListener.name);

  constructor(
    @Inject(forwardRef(() => InvoiceService))
    private readonly invoiceService: InvoiceService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
    @InjectDb() private readonly dbService: DbService<any>,
  ) {}

  @OnEvent('payment.succeeded')
  async handlePaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    this.logger.log(
      `Handling payment.succeeded for invoice ID: ${event.invoice.id}`,
    );
    const totalPaid = await this.paymentService.getPaidAmount(
      event.invoice.id,
    );
    const invoiceAmount = Number(event.invoice.amount);

    let newStatus = event.invoice.status;
    let reason = '';

    // NOTE: 현재는 전액 결제만 성공으로 간주하므로, totalPaid는 항상 invoiceAmount와 같습니다.
    // 부분 결제를 허용하게 되면 이 로직은 변경되어야 합니다.
    if (totalPaid >= invoiceAmount) {
      newStatus = INVOICE_STATUS.PAID;
      reason = 'Payment completed successfully.';
    }

    if (newStatus !== event.invoice.status) {
      await this.invoiceService.updateStatus(event.invoice.id, {
        status: newStatus,
        reason: reason,
      });
    }
  }

  @OnEvent('payment.failed')
  async handlePaymentFailed(event: PaymentFailedEvent): Promise<void> {
    this.logger.log(`Handling payment.failed for invoice ID: ${event.invoice.id}`);
    await this.invoiceService.updateStatus(event.invoice.id, {
      status: INVOICE_STATUS.FAILED,
      reason: `Payment failed. PG Response: ${event.paymentEvent.pgResponse}`,
    });
  }

  @OnEvent('payment.duplicate.attempted')
  async handleDuplicatePaymentAttempted(
    event: DuplicatePaymentAttemptedEvent,
  ): Promise<void> {
    this.logger.log(`Handling payment.duplicate.attempted for invoice ID: ${event.invoice.id}`);
    await this.dbService.db.insert(invoiceSchema.invoiceEvent).values({
      invoiceId: event.invoice.id,
      eventType: EVENT_TYPE.DUPLICATE_ATTEMPT,
      reason: 'Duplicate payment attempt detected',
      occurredAt: new Date(),
      eventUuid: ulid(),
    });
  }

  @OnEvent('refund.succeeded')
  async handleRefundSucceeded(event: RefundSucceededEvent): Promise<void> {
    this.logger.log(`Handling refund.succeeded for invoice ID: ${event.invoice.id}`);
    // 1. 현재 인보이스의 전체 환불된 금액을 다시 계산합니다.
    const { prevRefunded } = await this.paymentService.calculateRefundAmounts(event.paymentEvent, event.invoice);
    const totalRefunded = prevRefunded; // calculateRefundAmounts가 이미 모든 환불 이벤트를 합산합니다.

    const invoiceAmount = Number(event.invoice.amount);
    let newStatus = event.invoice.status;

    // 2. 새로운 인보이스 상태를 결정합니다.
    if (totalRefunded === invoiceAmount) {
      newStatus = INVOICE_STATUS.REFUNDED;
    } else if (totalRefunded > 0) {
      newStatus = INVOICE_STATUS.PARTIALLY_REFUNDED;
    }

    // 3. 인보이스 상태와 환불된 금액을 업데이트합니다.
    await this.dbService.db
      .update(invoiceSchema.invoice)
      .set({
        status: newStatus,
        refundedAmount: totalRefunded.toString(),
      })
      .where(eq(invoiceSchema.invoice.id, event.invoice.id));
      
    // 4. 관련 이벤트를 기록합니다.
    await this.dbService.db.insert(invoiceSchema.invoiceEvent).values({
      invoiceId: event.invoice.id,
      eventType: newStatus,
      reason: `Refund of ${event.refundEvent.amount} processed.`,
      occurredAt: new Date(),
      eventUuid: ulid(),
    });
  }

  @OnEvent('refund.failed')
  async handleRefundFailed(event: RefundFailedEvent): Promise<void> {
    this.logger.warn(`Handling refund.failed for invoice ID: ${event.invoice.id}`);
    // 환불 실패 시, 시스템적으로 할 수 있는 일은 많지 않습니다.
    // 운영자가 확인할 수 있도록 로그를 남기거나, 별도의 실패 테이블에 기록할 수 있습니다.
    // 여기서는 간단히 인보이스 이벤트에 기록을 남기는 것으로 처리합니다.
    await this.dbService.db.insert(invoiceSchema.invoiceEvent).values({
      invoiceId: event.invoice.id,
      eventType: 'REFUND_FAILED',
      reason: `Attempt to refund ${event.requestedAmount} failed. Reason: ${event.reason}`,
      occurredAt: new Date(),
      eventUuid: ulid(),
    });
  }
} 