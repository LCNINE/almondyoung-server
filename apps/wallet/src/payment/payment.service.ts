import { ConflictException, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentMethodService } from '../payment-method/payment-method.service';
import { CreatePaymentDto, RefundPaymentDto, FullRefundPaymentDto, PartialRefundPaymentDto, PartialPaymentDto } from './dto/create-payment.dto';
import { paymentEvents, refundEvents } from './schema';
import * as schema from './schema';
import * as invoiceSchema from '../invoice/schema';
import * as paymentMethodSchema from '../payment-method/schema';
import { eq, and } from 'drizzle-orm';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { UpdateInvoiceStatusDto } from '../invoice/dto/update-invoice-status.dto';
import { ulid } from 'ulid';
import { inArray } from 'drizzle-orm';
import { PaymentStrategy } from './strategies/payment.strategy';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DuplicatePaymentAttemptedEvent, PaymentFailedEvent, PaymentSucceededEvent, RefundFailedEvent, RefundSucceededEvent } from './events/payment.events';

// --- 상수 선언 ---
const ERROR_MSG = {
  INVOICE_NOT_FOUND: 'Invoice not found',
  PAYMENT_METHOD_NOT_FOUND: 'Payment method not found',
  INVALID_AMOUNT: 'Invalid invoice amount',
  ALREADY_PAID: 'Invoice already paid',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_FAILED: 'Refund failed',
  OVER_REFUND_AMOUNT: 'Refund amount cannot exceed the paid amount.',
  ALREADY_FULLY_REFUNDED: 'The payment has already been fully refunded.',
  INVALID_REFUND_AMOUNT: 'Refund amount must be greater than 0.',
} as const;

const EVENT_TYPE = {
  REQUESTED: 'REQUESTED',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  DUPLICATE_ATTEMPT: 'DUPLICATE_ATTEMPT',
} as const;

type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

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
    private readonly cardPaymentStrategy: CardPaymentStrategy,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private getPaymentStrategy(
    paymentMethod: typeof paymentMethodSchema.paymentMethod.$inferSelect,
  ): PaymentStrategy {
    // NOTE: 현재는 카드 결제만 지원합니다.
    // 추후 paymentMethod.type에 따라 다른 전략을 반환하도록 확장할 수 있습니다.
    // 예: switch (paymentMethod.type) { case 'BANK_TRANSFER': ... }
    return this.cardPaymentStrategy;
  }

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
      this.eventEmitter.emit(
        'payment.duplicate.attempted',
        new DuplicatePaymentAttemptedEvent(invoice),
      );
      throw new ConflictException(ERROR_MSG.ALREADY_PAID);
    }

    const strategy = this.getPaymentStrategy(paymentMethod);

    // 1. 결제 요청 이벤트 기록 (REQUESTED)
    const [requestedEvent] = await this.dbService.db.insert(schema.paymentEvents).values({
      invoiceId: invoice.id,
      paymentMethodId: paymentMethod.id,
      amount: invoice.amount.toString(),
      status: EVENT_TYPE.REQUESTED,
      actor: 'USER',
    }).returning();

    // 2. PG사 연동 (전략 객체 위임)
    const payResult = await strategy.pay({ invoice, paymentMethod });
    
    // 3. 결과에 따라 status 업데이트 및 이벤트 발행
    if (payResult.success) {
      const successEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.SUCCESS,
        pgTransactionId: payResult.pgTransactionId,
        pgResponse: payResult.pgResponse,
      });
      this.eventEmitter.emit(
        'payment.succeeded',
        new PaymentSucceededEvent(invoice, successEvent),
      );
      return successEvent;
    } else {
      const failedEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.FAILED,
        pgTransactionId: payResult.pgTransactionId,
        pgResponse: payResult.pgResponse,
      });
      this.eventEmitter.emit(
        'payment.failed',
        new PaymentFailedEvent(invoice, failedEvent),
      );
      throw new BadRequestException(ERROR_MSG.PAYMENT_FAILED);
    }
  }

  private async updatePaymentEvent(
    eventId: string,
    data: Partial<PaymentEventRow>,
  ): Promise<PaymentEventRow> {
    const [updatedEvent] = await this.dbService.db
      .update(schema.paymentEvents)
      .set(data)
      .where(eq(schema.paymentEvents.id, eventId))
      .returning();

    if (!updatedEvent) {
      throw new Error('Payment event not found after update');
    }
    return updatedEvent;
  }

  /**
   * Validate payment request and fetch invoice/payment method.
   */
  private async validatePaymentRequest(dto: CreatePaymentDto | PartialPaymentDto): Promise<{
    invoice: typeof invoiceSchema.invoice.$inferSelect;
    paymentMethod: typeof paymentMethodSchema.paymentMethod.$inferSelect;
  }> {
    const [invoice] = await this.dbService.db
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, dto.invoiceId));
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
   * 전액 환불 처리
   * @param dto FullRefundPaymentDto
   * @returns RefundEventRow (DB row)
   */
  async refundFullPayment(dto: FullRefundPaymentDto): Promise<RefundEventRow> {
    const paymentEvent = await this.findPaymentEvent(dto.paymentEventId);
    const invoice = await this.findInvoiceForPayment(paymentEvent);

    const { prevRefunded } = await this.calculateRefundAmounts(paymentEvent, invoice);
    const refundAmount = Number(invoice.amount) - prevRefunded;

    if (refundAmount <= 0) {
      throw new ConflictException(ERROR_MSG.ALREADY_FULLY_REFUNDED);
    }

    return this._processRefund({
      paymentEvent,
      invoice,
      amount: refundAmount,
      reason: dto.reason,
    });
  }

  /**
   * 부분 환불 처리
   * @param dto PartialRefundPaymentDto
   * @returns RefundEventRow (DB row)
   */
  async refundPartialPayment(dto: PartialRefundPaymentDto): Promise<RefundEventRow> {
    const paymentEvent = await this.findPaymentEvent(dto.paymentEventId);
    const invoice = await this.findInvoiceForPayment(paymentEvent);
    const { prevRefunded, invoiceAmount } = await this.calculateRefundAmounts(paymentEvent, invoice);
    const requestedAmount = dto.amount;

    if (requestedAmount <= 0) {
      throw new BadRequestException(ERROR_MSG.INVALID_REFUND_AMOUNT);
    }
    if (prevRefunded + requestedAmount > invoiceAmount) {
      throw new ConflictException(ERROR_MSG.OVER_REFUND_AMOUNT);
    }
    
    return this._processRefund({
      paymentEvent,
      invoice,
      amount: requestedAmount,
      reason: dto.reason,
    });
  }

  private async findPaymentEvent(paymentEventId: string): Promise<PaymentEventRow> {
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, paymentEventId),
    });
    if (!paymentEvent) {
      throw new NotFoundException('Payment event not found');
    }
    return paymentEvent;
  }
  
  private async findInvoiceForPayment(paymentEvent: PaymentEventRow): Promise<typeof invoiceSchema.invoice.$inferSelect> {
    const [invoice] = await this.dbService.db
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, Number(paymentEvent.invoiceId)));
    if (!invoice) {
      throw new NotFoundException('Invoice not found for the payment');
    }
    return invoice;
  }

  public async calculateRefundAmounts(paymentEvent: PaymentEventRow, invoice: typeof invoiceSchema.invoice.$inferSelect) {
    const allRefundEvents = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.paymentEventId, paymentEvent.id));
      
    const prevRefunded = allRefundEvents
      .filter((e) => e.status === 'SUCCESS')
      .reduce((sum, e) => sum + Number(e.amount), 0);
      
    const invoiceAmount = Number(invoice.amount);
    return { prevRefunded, invoiceAmount };
  }

  /**
   * 공통 환불 처리 로직 (부분/전액 환불)
   */
  private async _processRefund({ paymentEvent, amount, reason, invoice }: {
    paymentEvent: PaymentEventRow;
    amount: number;
    reason?: string;
    invoice: typeof invoiceSchema.invoice.$inferSelect;
  }): Promise<RefundEventRow> {
    const paymentMethod = await this.paymentMethodService.findById(paymentEvent.paymentMethodId);
    if (!paymentMethod) {
      throw new NotFoundException(ERROR_MSG.PAYMENT_METHOD_NOT_FOUND);
    }
    const strategy = this.getPaymentStrategy(paymentMethod);
    
    // PG사 환불 요청
    const refundResult = await strategy.refund({
      paymentEventToRefund: paymentEvent,
      invoice,
      amount,
      reason,
    });
    
    if (!refundResult.success) {
      const failedEvent = await this.dbService.db.insert(refundEvents).values({
        paymentEventId: paymentEvent.id,
        amount: amount.toString(),
        status: 'FAILED',
        reason: reason || ERROR_MSG.REFUND_FAILED,
        // pgResponse and pgTransactionId should be added to refundEvents schema
      }).returning();
      
      this.eventEmitter.emit(
        'refund.failed',
        new RefundFailedEvent(invoice, paymentEvent, amount, refundResult.pgResponse),
      );
      throw new BadRequestException(ERROR_MSG.REFUND_FAILED);
    }

    // 환불 성공 이벤트 기록
    const [refundEvent] = await this.dbService.db.insert(refundEvents).values({
      paymentEventId: paymentEvent.id,
      amount: amount.toString(),
      status: 'SUCCESS',
      reason: reason || 'Refund successful',
      // pgResponse and pgTransactionId should be added to refundEvents schema
    }).returning();

    // 이벤트 발행
    this.eventEmitter.emit(
      'refund.succeeded',
      new RefundSucceededEvent(invoice, paymentEvent, refundEvent),
    );

    return refundEvent;
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

  /**
   * 집계 쿼리 기반 누적 결제 금액 계산
   */
  async getPaidAmount(invoiceId: number): Promise<number> {
    const events = await this.dbService.db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.invoiceId, invoiceId),
          eq(paymentEvents.status, 'SUCCESS'),
        ),
      );
    return events.reduce((sum, e) => sum + Number(e.amount), 0);
  }

  /**
   * 부분결제 처리 (정합성 우선)
   */
  async partialPayment(dto: PartialPaymentDto): Promise<PaymentEventRow> {
    // 1. invoice, paymentMethod 조회 및 유효성 검사
    const { invoice, paymentMethod } = await this.validatePaymentRequest(dto);

    // 2. 누적 결제 금액 집계
    const paidAmount = await this.getPaidAmount(invoice.id);

    // 3. 초과 결제 방지
    if (paidAmount + dto.amount > Number(invoice.amount)) {
      throw new ConflictException('결제 금액이 청구 금액을 초과할 수 없습니다.');
    }

    // 4. createPayment와 동일한 흐름으로 결제 처리
    const strategy = this.getPaymentStrategy(paymentMethod);
    
    // 4-1. 결제 요청 이벤트 기록 (REQUESTED)
    // 부분 결제이므로 요청 금액은 dto.amount를 사용
    const [requestedEvent] = await this.dbService.db.insert(paymentEvents).values({
      invoiceId: invoice.id,
      paymentMethodId: dto.paymentMethodId,
      amount: dto.amount.toString(),
      status: 'REQUESTED',
      actor: 'USER',
    }).returning();

    // 4-2. PG사 연동 (전략 객체 위임)
    // 부분 결제 금액으로 임시 invoice 객체를 만들어 전달
    const tempInvoiceForPay = { ...invoice, amount: dto.amount.toString() };
    const payResult = await strategy.pay({
        invoice: tempInvoiceForPay,
        paymentMethod
    });
    
    // 4-3. 결과에 따라 status 업데이트 및 이벤트 발행
    if (payResult.success) {
      const successEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.SUCCESS,
        pgTransactionId: payResult.pgTransactionId,
        pgResponse: payResult.pgResponse,
      });
      this.eventEmitter.emit(
        'payment.succeeded',
        new PaymentSucceededEvent(invoice, successEvent),
      );
      return successEvent;
    } else {
      const failedEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.FAILED,
        pgTransactionId: payResult.pgTransactionId,
        pgResponse: payResult.pgResponse,
      });
      this.eventEmitter.emit(
        'payment.failed',
        new PaymentFailedEvent(invoice, failedEvent),
      );
      throw new BadRequestException(ERROR_MSG.PAYMENT_FAILED);
    }
  }
}