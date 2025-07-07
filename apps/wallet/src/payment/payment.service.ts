import { ConflictException, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentMethodService } from '../payment-method/payment-method.service';
import { CreatePaymentDto, RefundPaymentDto, FullRefundPaymentDto, PartialRefundPaymentDto } from './dto/create-payment.dto';
import { paymentEvents, refundEvents } from './schema';
import * as schema from './schema';
import * as invoiceSchema from '../invoice/schema';
import { eq } from 'drizzle-orm';
import { HmsAPI } from 'hms-api-wrapper';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import type { PaymentTransactionRequest } from 'hms-api-wrapper';
import { UpdateInvoiceStatusDto } from '../invoice/dto/update-invoice-status.dto';
import { ulid } from 'ulid';
import { inArray } from 'drizzle-orm';

// --- 상수 선언 ---
const ERROR_MSG = {
  INVOICE_NOT_FOUND: 'Invoice not found',
  PAYMENT_METHOD_NOT_FOUND: 'Payment method not found',
  INVALID_AMOUNT: 'Invalid invoice amount',
  ALREADY_PAID: 'Invoice already paid',
  PAYMENT_FAILED: 'Payment failed',
} as const;

const EVENT_TYPE = {
  DUPLICATE_ATTEMPT: 'DUPLICATE_ATTEMPT',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

type EventType = typeof EVENT_TYPE[keyof typeof EVENT_TYPE];

const INVOICE_STATUS = {
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;

type InvoiceStatus = typeof INVOICE_STATUS[keyof typeof INVOICE_STATUS];

type PaymentEventRow = typeof paymentEvents.$inferSelect;
type RefundEventRow = typeof refundEvents.$inferSelect;

interface PaymentEvent {
  id: string;
  invoiceId: number;
  paymentMethodId: string;
  amount: string;
  status: typeof EVENT_TYPE.SUCCESS | typeof EVENT_TYPE.FAILED;
  pgTransactionId?: string;
  pgResponse?: string;
  actor: string;
  createdAt?: Date;
}

@Injectable()
export class PaymentService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly invoiceService: InvoiceService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly hmsApi: HmsAPI,
  ) {}

  /**
   * Create and process a payment for an invoice.
   * @param dto Payment creation DTO
   * @returns Payment event DB row
   * @throws ConflictException if invoice is already paid
   * @throws NotFoundException if invoice or payment method is not found
   * @throws BadRequestException for invalid amounts or payment failures
   */
  async createPayment(dto: CreatePaymentDto): Promise<PaymentEventRow> {
    const { invoice, paymentMethod } = await this.validatePaymentRequest(dto);

    if (invoice.status === INVOICE_STATUS.PAID) {
      await this.recordDuplicateAttemptEvent(invoice.id);
      throw new ConflictException(ERROR_MSG.ALREADY_PAID);
    }

    const request = this.buildPaymentRequest(invoice, dto);

    try {
      const paymentResult = await this.hmsApi.paymentTryansactions.requestTryansaction(request);

      if (!this.isPaymentSuccess(paymentResult)) {
        await this.handlePaymentFailure(invoice, paymentMethod, request, paymentResult);
      }

      const paymentEvent = await this.recordPaymentEvent(invoice, paymentMethod, request, paymentResult, EVENT_TYPE.SUCCESS);
      await this.invoiceService.updateStatus(invoice.id, { status: INVOICE_STATUS.PAID, reason: 'Payment completed' });
      return paymentEvent;
    } catch (error) {
      await this.handlePaymentException(invoice, paymentMethod, error);
      throw error;
    }
  }

  /**
   * Validate payment request and fetch invoice/payment method.
   */
  private async validatePaymentRequest(dto: CreatePaymentDto): Promise<{ invoice: any; paymentMethod: any }> {
    const invoice = await this.invoiceService.findOne(dto.invoiceId);
    if (!invoice) {
      throw new NotFoundException(ERROR_MSG.INVOICE_NOT_FOUND);
    }
    const paymentMethod = await this.paymentMethodService.findById(dto.paymentMethodId);
    if (!paymentMethod) {
      throw new NotFoundException(ERROR_MSG.PAYMENT_METHOD_NOT_FOUND);
    }
    const invoiceAmount = Number(invoice.amount);
    if (isNaN(invoiceAmount)) {
      throw new BadRequestException(ERROR_MSG.INVALID_AMOUNT);
    }
    return { invoice, paymentMethod };
  }

  /**
   * Build payment request for HMS API.
   */
  private buildPaymentRequest(invoice: any, dto: CreatePaymentDto): PaymentTransactionRequest {
    return {
      transactionId: `tx_${Date.now()}`,
      memberId: invoice.userId.toString(),
      callAmount: Number(invoice.amount),
      cardPointFlag: 'N',
    };
  }

  /**
   * Check if payment result is success.
   */
  private isPaymentSuccess(paymentResult: any): boolean {
    return paymentResult.payment?.result?.flag === 'Y';
  }

  /**
   * Record a payment event (success or failed).
   * @returns PaymentEventRow (DB row)
   */
  private async recordPaymentEvent(
    invoice: any,
    paymentMethod: any,
    request: PaymentTransactionRequest,
    paymentResult: any,
    status: typeof EVENT_TYPE.SUCCESS | typeof EVENT_TYPE.FAILED,
  ): Promise<PaymentEventRow> {
    const [event] = await this.dbService.db.insert(schema.paymentEvents).values({
      invoiceId: invoice.id,
      paymentMethodId: paymentMethod.id,
      amount: invoice.amount.toString(),
      status,
      pgTransactionId: request.transactionId,
      pgResponse: JSON.stringify(paymentResult),
      actor: 'USER',
    }).returning();
    return event;
  }

  /**
   * Record a duplicate payment attempt event.
   */
  private async recordDuplicateAttemptEvent(invoiceId: number): Promise<void> {
    await this.dbService.db.insert(invoiceSchema.invoiceEvent).values({
      invoiceId,
      eventType: EVENT_TYPE.DUPLICATE_ATTEMPT,
      reason: 'Duplicate payment attempt detected',
      occurredAt: new Date(),
      eventUuid: ulid(),
    });
  }

  /**
   * Handle payment failure: record event, update invoice status, throw exception.
   */
  private async handlePaymentFailure(
    invoice: any,
    paymentMethod: any,
    request: PaymentTransactionRequest,
    paymentResult: any,
  ): Promise<void> {
    await this.recordPaymentEvent(invoice, paymentMethod, request, paymentResult, EVENT_TYPE.FAILED);
    await this.invoiceService.updateStatus(invoice.id, {
      status: INVOICE_STATUS.FAILED,
      reason: paymentResult.payment?.result?.message || ERROR_MSG.PAYMENT_FAILED,
    });
    throw new BadRequestException(paymentResult.payment?.result?.message || ERROR_MSG.PAYMENT_FAILED);
  }

  /**
   * Handle payment exception (network, etc): record event, update invoice status.
   */
  private async handlePaymentException(
    invoice: any,
    paymentMethod: any,
    error: any,
  ): Promise<void> {
    await this.dbService.db.insert(schema.paymentEvents).values({
      invoiceId: invoice.id,
      paymentMethodId: paymentMethod.id,
      amount: invoice.amount.toString(),
      status: EVENT_TYPE.FAILED,
      pgResponse: JSON.stringify(error.response || error.message),
      actor: 'USER',
    });
    await this.invoiceService.updateStatus(invoice.id, {
      status: INVOICE_STATUS.FAILED,
      reason: error.message || ERROR_MSG.PAYMENT_FAILED,
    });
  }

  /**
   * 전액 환불 처리
   * @param dto FullRefundPaymentDto
   * @returns RefundEventRow (DB row)
   */
  async refundFullPayment(dto: FullRefundPaymentDto): Promise<RefundEventRow> {
    // 1. 결제 이벤트 조회
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, dto.paymentEventId),
    });
    if (!paymentEvent) {
      throw new NotFoundException('Payment event not found');
    }
    // 2. 환불 대상 invoice 조회
    const [invoice] = await this.dbService.db
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, Number(paymentEvent.invoiceId)));
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // 3. 기존 환불 금액 계산
    const allRefundEvents = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.paymentEventId, dto.paymentEventId));
    const prevRefunded = allRefundEvents
      .filter((e) => e.status === 'SUCCESS')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const invoiceAmount = Number(invoice.amount);
    const refundAmount = invoiceAmount - prevRefunded;
    if (refundAmount <= 0) throw new ConflictException('이미 전액 환불되었습니다.');
    // 4. 공통 환불 처리
    return this._processRefund({
      paymentEventId: dto.paymentEventId,
      amount: refundAmount,
      reason: dto.reason,
      invoice,
      prevRefunded,
    });
  }

  /**
   * 부분 환불 처리
   * @param dto PartialRefundPaymentDto
   * @returns RefundEventRow (DB row)
   */
  async refundPartialPayment(dto: PartialRefundPaymentDto): Promise<RefundEventRow> {
    // 1. 결제 이벤트 조회
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, dto.paymentEventId),
    });
    if (!paymentEvent) {
      throw new NotFoundException('Payment event not found');
    }
    // 2. 환불 대상 invoice 조회
    const [invoice] = await this.dbService.db
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, Number(paymentEvent.invoiceId)));
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // 3. 기존 환불 금액 계산
    const allRefundEvents = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.paymentEventId, dto.paymentEventId));
    const prevRefunded = allRefundEvents
      .filter((e) => e.status === 'SUCCESS')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    // 4. 공통 환불 처리
    return this._processRefund({
      paymentEventId: dto.paymentEventId,
      amount: dto.amount,
      reason: dto.reason,
      invoice,
      prevRefunded,
    });
  }

  /**
   * 공통 환불 처리 로직 (부분/전액 환불)
   */
  private async _processRefund({ paymentEventId, amount, reason, invoice, prevRefunded }: {
    paymentEventId: string;
    amount: number;
    reason?: string;
    invoice: any;
    prevRefunded: number;
  }): Promise<RefundEventRow> {
    const totalRefunded = prevRefunded + amount;
    const invoiceAmount = Number(invoice.amount);
    if (amount <= 0) throw new BadRequestException('환불 금액이 0보다 커야 합니다.');
    if (totalRefunded > invoiceAmount) throw new ConflictException('환불 금액이 청구 금액을 초과할 수 없습니다.');
    let newStatus = invoice.status;
    if (totalRefunded === invoiceAmount) {
      newStatus = 'REFUNDED';
    } else if (totalRefunded > 0 && totalRefunded < invoiceAmount) {
      newStatus = 'PARTIALLY_REFUNDED';
    }
    const result = await this.dbService.db.transaction(async (tx) => {
      const [refundEvent] = await tx.insert(refundEvents).values({
        paymentEventId,
        amount: amount.toString(),
        status: 'SUCCESS',
        reason: reason || '환불 성공',
      }).returning();
      await tx.update(invoiceSchema.invoice)
        .set({ refundedAmount: totalRefunded.toString(), status: newStatus })
        .where(eq(invoiceSchema.invoice.id, Number(invoice.id)));
      await tx.insert(invoiceSchema.invoiceEvent).values({
        invoiceId: invoice.id,
        eventType: newStatus,
        reason: reason || '환불 성공',
        occurredAt: new Date(),
        eventUuid: ulid(),
      });
      return refundEvent;
    });
    return result;
  }

  /**
   * 특정 결제 이벤트에 대한 환불 이벤트 목록 조회
   * @param paymentEventId 결제 이벤트 ID
   * @returns 환불 이벤트 + 결제 이벤트 정보 배열
   */
  async getRefundsByPaymentEventId(paymentEventId: string): Promise<Array<any>> {
    // 환불 이벤트 목록 조회
    const refundList = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.paymentEventId, paymentEventId));
    if (!refundList.length) return [];
    // 결제 이벤트 정보 조회
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, paymentEventId),
    });
    // 결제 이벤트 정보가 없으면 환불만 반환
    return refundList.map(refund => ({
      ...refund,
      payment: paymentEvent
        ? {
            amount: paymentEvent.amount,
            createdAt: paymentEvent.createdAt,
            paymentMethodId: paymentEvent.paymentMethodId,
            invoiceId: paymentEvent.invoiceId,
          }
        : undefined,
    }));
  }

  /**
   * 특정 userId의 전체 환불 내역 조회
   * @param userId 유저 ID
   * @returns 환불 이벤트 + 결제 이벤트 정보 배열
   */
  async getRefundsByUserId(userId: string | number): Promise<Array<any>> {
    const numericUserId = typeof userId === 'string' ? Number(userId) : userId;
    const invoices = await this.dbService.db
      .select({ id: invoiceSchema.invoice.id })
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.userId, numericUserId));
    console.log('invoices:', invoices);
    if (!invoices.length) return [];
    const invoiceIds = invoices.map(inv => inv.id);

    const paymentEventsList = await this.dbService.db
      .select()
      .from(paymentEvents)
      .where(inArray(paymentEvents.invoiceId, invoiceIds));
    console.log('paymentEventsList:', paymentEventsList);
    if (!paymentEventsList.length) return [];
    const paymentEventIds = paymentEventsList.map(pe => pe.id);

    const refundList = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(inArray(refundEvents.paymentEventId, paymentEventIds));
    console.log('refundList:', refundList);
    if (!refundList.length) return [];
    
    const paymentEventMap = Object.fromEntries(paymentEventsList.map(pe => [pe.id, pe]));
    const result = refundList.map(refund => ({
      ...refund,
      payment: paymentEventMap[refund.paymentEventId]
        ? {
            amount: paymentEventMap[refund.paymentEventId].amount,
            createdAt: paymentEventMap[refund.paymentEventId].createdAt,
            paymentMethodId: paymentEventMap[refund.paymentEventId].paymentMethodId,
            invoiceId: paymentEventMap[refund.paymentEventId].invoiceId,
          }
        : undefined,
    }));
    console.log('result:', result);
    return result;
  }
}
