import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { and, eq, inArray } from 'drizzle-orm';
import { InvoiceService } from '../invoice/invoice.service';
import * as invoiceSchema from '../invoice/schema';
import { PaymentMethodService } from '../payment-method/payment-method.service';
import * as paymentMethodSchema from '../payment-method/schema';
import {
  CreatePaymentDto,
  FullRefundPaymentDto,
  PartialPaymentDto,
  PartialRefundPaymentDto,
} from './dto/create-payment.dto';
import { CreateBnplPaymentDto } from './dto/create-bnpl-payment.dto';
import { BNPLTransactionResponseDto } from './dto/bnpl-transaction.response.dto';
import {
  DuplicatePaymentAttemptedEvent,
  PaymentFailedEvent,
  PaymentSucceededEvent,
  RefundFailedEvent,
  RefundSucceededEvent,
} from './events/payment.events';
import * as schema from './schema';
import { paymentEvents, refundEvents } from './schema';
import { CardPaymentStrategy } from './strategies/card-payment.strategy';
import { BnplPaymentStrategy } from './strategies/bnpl-payment.strategy';
import { PaymentStrategy } from './strategies/payment.strategy';
import {
  PaymentEventRow,
  RefundEventRow,
  RefundWithPaymentDetails,
} from './types/payment.types';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PgService } from './pg.service';

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
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  DUPLICATE_ATTEMPT: 'DUPLICATE_ATTEMPT',
} as const;

const INVOICE_STATUS = {
  PAID: 'PAID',
} as const;

@Injectable()
export class PaymentService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly invoiceService: InvoiceService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly cardPaymentStrategy: CardPaymentStrategy,
    private readonly bnplPaymentStrategy: BnplPaymentStrategy,
    private readonly eventEmitter: EventEmitter2,
    private readonly pgService: PgService,
  ) {}

  private getPaymentStrategy(
    paymentMethod: typeof paymentMethodSchema.paymentMethod.$inferSelect,
  ): PaymentStrategy {
    // NOTE: 현재는 카드 결제만 지원합니다.
    // 추후 paymentMethod.type에 따라 다른 전략을 반환하도록 확장할 수 있습니다.
    // 예: switch (paymentMethod.type) { case 'BANK_TRANSFER': ... }

    switch (paymentMethod.methodType) {
      case 'CARD':
        return this.cardPaymentStrategy;
      case 'BNPL':
        return this.bnplPaymentStrategy;
      default:
        return this.cardPaymentStrategy;
    }
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
    const [requestedEvent] = await this.dbService.db
      .insert(schema.paymentEvents)
      .values({
        invoiceId: invoice.id,
        paymentMethodId: paymentMethod.id,
        amount: invoice.amount.toString(),
        status: EVENT_TYPE.REQUESTED,
        actor: 'USER',
      })
      .returning();

    // 2. PG사 연동 (전략 객체 위임)
    const payResult = await strategy.pay({ invoice, paymentMethod });

    // 3. 결과에 따라 status 업데이트 및 이벤트 발행
    if (payResult.success) {
      const successEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.CAPTURED,
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
  private async validatePaymentRequest(
    dto: CreatePaymentDto | PartialPaymentDto,
  ): Promise<{
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
    const paymentMethod = await this.paymentMethodService.findById(
      dto.paymentMethodId,
    );
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

    const { prevRefunded } = await this.calculateRefundAmounts(
      paymentEvent,
      invoice,
    );
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
  async refundPartialPayment(
    dto: PartialRefundPaymentDto,
  ): Promise<RefundEventRow> {
    const paymentEvent = await this.findPaymentEvent(dto.paymentEventId);
    const invoice = await this.findInvoiceForPayment(paymentEvent);
    const { prevRefunded, invoiceAmount } = await this.calculateRefundAmounts(
      paymentEvent,
      invoice,
    );
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

  private async findPaymentEvent(
    paymentEventId: string,
  ): Promise<PaymentEventRow> {
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, paymentEventId),
    });
    if (!paymentEvent) {
      throw new NotFoundException('Payment event not found');
    }
    return paymentEvent;
  }

  private async findInvoiceForPayment(
    paymentEvent: PaymentEventRow,
  ): Promise<typeof invoiceSchema.invoice.$inferSelect> {
    const [invoice] = await this.dbService.db
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, Number(paymentEvent.invoiceId)));
    if (!invoice) {
      throw new NotFoundException('Invoice not found for the payment');
    }
    return invoice;
  }

  public async calculateRefundAmounts(
    paymentEvent: PaymentEventRow,
    invoice: typeof invoiceSchema.invoice.$inferSelect,
  ) {
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
  private async _processRefund({
    paymentEvent,
    amount,
    reason,
    invoice,
  }: {
    paymentEvent: PaymentEventRow;
    amount: number;
    reason?: string;
    invoice: typeof invoiceSchema.invoice.$inferSelect;
  }): Promise<RefundEventRow> {
    const paymentMethod = await this.paymentMethodService.findById(
      paymentEvent.paymentMethodId,
    );
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
      await this.dbService.db
        .insert(refundEvents)
        .values({
          paymentEventId: paymentEvent.id,
          amount: amount.toString(),
          status: 'FAILED',
          reason: reason || ERROR_MSG.REFUND_FAILED,
          // pgResponse and pgTransactionId should be added to refundEvents schema
        })
        .returning();

      this.eventEmitter.emit(
        'refund.failed',
        new RefundFailedEvent(
          invoice,
          paymentEvent,
          amount,
          refundResult.pgResponse,
        ),
      );
      throw new BadRequestException(ERROR_MSG.REFUND_FAILED);
    }

    // 환불 성공 이벤트 기록
    const [refundEvent] = await this.dbService.db
      .insert(refundEvents)
      .values({
        paymentEventId: paymentEvent.id,
        amount: amount.toString(),
        status: 'SUCCESS',
        reason: reason || 'Refund successful',
        // pgResponse and pgTransactionId should be added to refundEvents schema
      })
      .returning();

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
  async getRefundsByPaymentEventId(
    paymentEventId: string,
  ): Promise<RefundWithPaymentDetails[]> {
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
    return refundList.map((refund) => ({
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
  async getRefundsByUserId(
    userId: string | number,
  ): Promise<RefundWithPaymentDetails[]> {
    const numericUserId = typeof userId === 'string' ? Number(userId) : userId;
    const invoices = await this.dbService.db
      .select({ id: invoiceSchema.invoice.id })
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.userId, numericUserId));
    if (!invoices.length) return [];
    const invoiceIds = invoices.map((inv) => inv.id);

    const paymentEventsList = await this.dbService.db
      .select()
      .from(paymentEvents)
      .where(inArray(paymentEvents.invoiceId, invoiceIds));
    if (!paymentEventsList.length) return [];
    const paymentEventIds = paymentEventsList.map((pe) => pe.id);

    const refundList = await this.dbService.db
      .select()
      .from(refundEvents)
      .where(inArray(refundEvents.paymentEventId, paymentEventIds));
    if (!refundList.length) return [];

    const paymentEventMap = new Map(paymentEventsList.map((pe) => [pe.id, pe]));

    const result: RefundWithPaymentDetails[] = refundList.map((refund) => {
      const paymentEvent = paymentEventMap.get(refund.paymentEventId);
      return {
        ...refund,
        payment: paymentEvent
          ? {
              amount: paymentEvent.amount,
              createdAt: paymentEvent.createdAt,
              paymentMethodId: paymentEvent.paymentMethodId,
              invoiceId: paymentEvent.invoiceId,
            }
          : undefined,
      };
    });
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
          eq(paymentEvents.status, 'CAPTURED'),
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
      throw new ConflictException(
        '결제 금액이 청구 금액을 초과할 수 없습니다.',
      );
    }

    // 4. createPayment와 동일한 흐름으로 결제 처리
    const strategy = this.getPaymentStrategy(paymentMethod);

    // 4-1. 결제 요청 이벤트 기록 (REQUESTED)
    // 부분 결제이므로 요청 금액은 dto.amount를 사용
    const [requestedEvent] = await this.dbService.db
      .insert(paymentEvents)
      .values({
        invoiceId: invoice.id,
        paymentMethodId: dto.paymentMethodId,
        amount: dto.amount.toString(),
        status: 'REQUESTED',
        actor: 'USER',
      })
      .returning();

    // 4-2. PG사 연동 (전략 객체 위임)
    // 부분 결제 금액으로 임시 invoice 객체를 만들어 전달
    const tempInvoiceForPay = { ...invoice, amount: dto.amount.toString() };
    const payResult = await strategy.pay({
      invoice: tempInvoiceForPay,
      paymentMethod,
    });

    // 4-3. 결과에 따라 status 업데이트 및 이벤트 발행
    if (payResult.success) {
      const successEvent = await this.updatePaymentEvent(requestedEvent.id, {
        status: EVENT_TYPE.CAPTURED,
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

  // ────────────────────────────────────────────
  // BNPL 결제 처리 메서드들
  // ────────────────────────────────────────────

  /**
   * BNPL을 사용하여 인보이스를 결제합니다.
   * 외부 PG사 연동 없이 내부 신용 거래로 처리됩니다.
   * @param dto BNPL 결제 생성 DTO
   * @param actor 행위자 (USER, ADMIN, SYSTEM)
   * @returns BNPL 거래 정보
   */
  async createBnplPayment(
    dto: CreateBnplPaymentDto,
    actor: string,
  ): Promise<BNPLTransactionResponseDto> {
    console.log('🔵 [BNPL CREATE] BNPL 결제 생성 시작');
    console.log(
      `🔵 [BNPL CREATE] Invoice ID: ${dto.invoiceId}, Payment Method ID: ${dto.paymentMethodId}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. 데이터 조회 및 초기 검증
      const { paymentMethod, invoice, bnplAccount } =
        await this.validateBnplPaymentRequest(dto, tx);

      // 2. 동시성 제어 및 신용 한도 검증
      const lockedBnplAccount = await this.validateCreditLimit(
        bnplAccount.id,
        invoice.amount,
        tx,
      );

      // 3. 다단계 트랜잭션 실행
      // 3-1. PaymentEvent 생성 (REQUESTED)
      const [requestedEvent] = await tx
        .insert(schema.paymentEvents)
        .values({
          invoiceId: invoice.id,
          paymentMethodId: paymentMethod.id,
          amount: invoice.amount.toString(),
          status: 'REQUESTED',
          actor: 'USER',
        })
        .returning();

      // 3-2. PaymentEvent 상태를 AUTHORIZED로 변경 (BNPL 승인)
      const [authorizedEvent] = await tx
        .update(schema.paymentEvents)
        .set({
          status: 'AUTHORIZED',
        })
        .where(eq(schema.paymentEvents.id, requestedEvent.id))
        .returning();

      // 3-3. 잔액 업데이트
      const newBalance =
        Number(lockedBnplAccount.currentBalance) + Number(invoice.amount);
      const [updatedBnplAccount] = await tx
        .update(paymentMethodSchema.bnplAccount)
        .set({
          currentBalance: newBalance,
          version: lockedBnplAccount.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(paymentMethodSchema.bnplAccount.id, lockedBnplAccount.id))
        .returning();

      // 3-4. BNPL 거래 내역 생성 (내부 관리용)
      const [newTransaction] = await tx
        .insert(schema.bnplTransaction)
        .values({
          bnplAccountId: lockedBnplAccount.id,
          invoiceId: invoice.id,
          transactionType: 'DEBIT',
          status: 'AUTHORIZED', // 최초에는 AUTHORIZED로 저장
          amount: Number(invoice.amount),
        })
        .returning();

      // 3-5. Settlement Batch에 거래 추가
      await this.addTransactionToSettlementBatch(
        lockedBnplAccount.id,
        newTransaction.id,
        invoice.id,
        Number(invoice.amount),
        tx,
      );

      // 4. 이벤트 발행 (트랜잭션 커밋 후)
      this.eventEmitter.emit(
        'payment.succeeded',
        new PaymentSucceededEvent(invoice, authorizedEvent),
      );

      return {
        id: newTransaction.id,
        bnplAccountId: newTransaction.bnplAccountId,
        invoiceId: newTransaction.invoiceId,
        transactionType: newTransaction.transactionType,
        status: newTransaction.status,
        amount: Number(newTransaction.amount),
        createdAt: newTransaction.createdAt,
      };
    });
  }

  /**
   * BNPL 결제 요청을 검증하고 필요한 데이터를 조회합니다.
   */
  private async validateBnplPaymentRequest(
    dto: CreateBnplPaymentDto,
    tx: any,
  ): Promise<{
    paymentMethod: typeof paymentMethodSchema.paymentMethod.$inferSelect;
    invoice: typeof invoiceSchema.invoice.$inferSelect;
    bnplAccount: typeof paymentMethodSchema.bnplAccount.$inferSelect;
  }> {
    // 1. 결제수단 조회 및 검증
    const paymentMethod = await this.paymentMethodService.findById(
      dto.paymentMethodId,
    );
    if (!paymentMethod) {
      throw new NotFoundException('결제수단을 찾을 수 없습니다.');
    }

    // 2. 인보이스 조회 및 검증
    const [invoice] = await tx
      .select()
      .from(invoiceSchema.invoice)
      .where(eq(invoiceSchema.invoice.id, dto.invoiceId));
    if (!invoice) {
      throw new NotFoundException('인보이스를 찾을 수 없습니다.');
    }
    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      throw new BadRequestException('결제할 수 없는 인보이스입니다.');
    }

    // 3. BNPL 계정 조회 및 검증
    const [bnplAccount] = await tx
      .select()
      .from(paymentMethodSchema.bnplAccount)
      .where(eq(paymentMethodSchema.bnplAccount.userId, paymentMethod.userId));
    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }
    if (bnplAccount.status !== 'ACTIVE') {
      throw new BadRequestException('활성화되지 않은 BNPL 계정입니다.');
    }

    return { paymentMethod, invoice, bnplAccount };
  }

  /**
   * 동시성 제어를 통해 신용 한도를 검증합니다.
   */
  private async validateCreditLimit(
    bnplAccountId: string,
    invoiceAmount: string,
    tx: any,
  ): Promise<typeof paymentMethodSchema.bnplAccount.$inferSelect> {
    // Pessimistic Lock으로 동시성 제어
    const [lockedBnplAccount] = await tx
      .select()
      .from(paymentMethodSchema.bnplAccount)
      .where(eq(paymentMethodSchema.bnplAccount.id, bnplAccountId))
      .for('update');

    if (!lockedBnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    const currentBalance = Number(lockedBnplAccount.currentBalance);
    const creditLimit = Number(lockedBnplAccount.creditLimit);
    const amount = Number(invoiceAmount);

    if (currentBalance + amount > creditLimit) {
      throw new ForbiddenException('신용 한도를 초과했습니다.');
    }

    return lockedBnplAccount;
  }

  /**
   * BNPL 거래를 settlement batch에 추가합니다.
   */
  private async addTransactionToSettlementBatch(
    bnplAccountId: string,
    bnplTransactionId: string,
    invoiceId: number,
    amount: number,
    tx: any,
  ): Promise<void> {
    // 1. 현재 월의 settlement batch 조회 또는 생성
    const currentDate = new Date();
    const batchNumber = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    let [settlementBatch] = await tx
      .select()
      .from(schema.settlementBatch)
      .where(
        and(
          eq(schema.settlementBatch.batchNumber, batchNumber),
          eq(schema.settlementBatch.bnplAccountId, bnplAccountId),
        ),
      );

    if (!settlementBatch) {
      // 새로운 settlement batch 생성
      const batchPeriodStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1,
      );
      const batchPeriodEnd = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0,
      );
      const dueDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        15,
      ); // 다음 달 15일

      [settlementBatch] = await tx
        .insert(schema.settlementBatch)
        .values({
          bnplAccountId,
          batchNumber,
          totalAmount: 0,
          dueDate,
          batchPeriodStart,
          batchPeriodEnd,
        })
        .returning();
    }

    // 2. settlement batch item 추가
    await tx.insert(schema.settlementBatchItem).values({
      batchId: settlementBatch.id,
      bnplTransactionId,
      invoiceId,
      amount,
      transactionDate: new Date(),
    });

    // 3. settlement batch 총액 업데이트
    await tx
      .update(schema.settlementBatch)
      .set({
        totalAmount: Number(settlementBatch.totalAmount) + amount,
        updatedAt: new Date(),
      })
      .where(eq(schema.settlementBatch.id, settlementBatch.id));
  }

  /**
   * 5분마다 AUTHORIZED 상태의 BNPL 거래를 CAPTURED로 변경
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async captureAuthorizedBnplTransactions() {
    // 5분 이상 지난 AUTHORIZED 거래만 대상으로 함
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 1. PaymentEvent의 AUTHORIZED 상태를 CAPTURED로 변경
    const authorizedPaymentEvents =
      await this.dbService.db.query.paymentEvents.findMany({
        where: (fields, operators) =>
          operators.and(
            operators.eq(fields.status, 'AUTHORIZED'),
            operators.lte(fields.createdAt, fiveMinutesAgo),
          ),
      });

    console.log(
      `Found ${authorizedPaymentEvents.length} BNPL payment events to capture`,
    );

    for (const paymentEvent of authorizedPaymentEvents) {
      try {
        console.log(
          `🟡 [BNPL CAPTURE] Payment Event ID: ${paymentEvent.id} 처리 시작`,
        );

        // PaymentEvent에서 결제수단을 통해 사용자 ID 조회
        const paymentMethod = await this.paymentMethodService.findById(
          paymentEvent.paymentMethodId,
        );

        if (!paymentMethod) {
          console.error(
            `Payment method not found for payment event: ${paymentEvent.id}`,
          );
          continue;
        }

        console.log(
          `🟡 [BNPL CAPTURE] HMS API 호출 시작 - User ID: ${paymentMethod.userId}, Amount: ${paymentEvent.amount}`,
        );

        // HMS API를 통해 실제 정산 처리
        const captureResult = await this.pgService.approvePayment({
          amount: Number(paymentEvent.amount),
          userId: paymentMethod.userId,
        });

        if (captureResult.success) {
          console.log(`🟢 [BNPL CAPTURE] HMS API 호출 성공!`);
          console.log(
            `🟢 [BNPL CAPTURE] HMS Transaction ID: ${captureResult.pgTransactionId}`,
          );
          console.log(
            `🟢 [BNPL CAPTURE] HMS Response: ${captureResult.pgResponse}`,
          );

          // 정산 성공 시 CAPTURED로 변경
          await this.dbService.db
            .update(schema.paymentEvents)
            .set({
              status: 'CAPTURED',
              pgTransactionId: captureResult.pgTransactionId,
              pgResponse: captureResult.pgResponse,
            })
            .where(eq(schema.paymentEvents.id, paymentEvent.id));

          console.log(
            `🟢 [BNPL CAPTURE] Payment Event 상태 변경 완료: ${paymentEvent.id} → CAPTURED`,
          );
        } else {
          console.error(
            `🔴 [BNPL CAPTURE] HMS API 호출 실패: ${paymentEvent.id}`,
            captureResult.pgResponse,
          );
        }
      } catch (error) {
        console.error(
          `Error capturing payment event: ${paymentEvent.id}`,
          error,
        );
      }
    }

    // 2. bnplTransaction의 AUTHORIZED 상태를 CAPTURED로 변경
    const authorizedTxs =
      await this.dbService.db.query.bnplTransaction.findMany({
        where: (fields, operators) =>
          operators.and(
            operators.eq(fields.status, 'AUTHORIZED'),
            operators.lte(fields.createdAt, fiveMinutesAgo),
          ),
      });

    console.log(`Found ${authorizedTxs.length} BNPL transactions to capture`);

    for (const tx of authorizedTxs) {
      await this.dbService.db
        .update(schema.bnplTransaction)
        .set({ status: 'CAPTURED' })
        .where(eq(schema.bnplTransaction.id, tx.id));

      console.log(
        `Captured BNPL transaction: ${tx.id} for invoice: ${tx.invoiceId}`,
      );
    }
  }

  /**
   * 매일 자정에 실행되어 billingCycleDay에 맞춰 월별 정산을 처리
   */
  @Cron('0 0 * * *') // 매일 자정
  async processMonthlySettlementBatches() {
    const today = new Date();
    const currentDay = today.getDate();

    // 모든 BNPL 계정 조회
    const bnplAccounts = await this.dbService.db
      .select()
      .from(paymentMethodSchema.bnplAccount)
      .where(eq(paymentMethodSchema.bnplAccount.status, 'ACTIVE'));

    for (const account of bnplAccounts) {
      // billingCycleDay와 일치하는 경우에만 처리
      if (account.billingCycleDay === currentDay) {
        await this.processSettlementBatchForAccount(account);
      }
    }
  }

  /**
   * 특정 BNPL 계정의 월별 정산을 처리합니다.
   */
  private async processSettlementBatchForAccount(account: any): Promise<void> {
    const currentDate = new Date();
    const lastMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1,
    );
    const batchNumber = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    // 지난 달 settlement batch 조회
    const settlementBatches = await this.dbService.db
      .select()
      .from(schema.settlementBatch)
      .where(
        and(
          eq(schema.settlementBatch.batchNumber, batchNumber),
          eq(schema.settlementBatch.bnplAccountId, account.id),
        ),
      );

    const settlementBatch = settlementBatches[0];

    if (settlementBatch && settlementBatch.status === 'PENDING') {
      try {
        // HMS API를 통해 월별 정산 처리
        const settlementResult = await this.pgService.approvePayment({
          amount: Number(settlementBatch.totalAmount),
          userId: account.userId,
        });

        if (settlementResult.success) {
          // 정산 성공 시 상태 업데이트
          await this.dbService.db
            .update(schema.settlementBatch)
            .set({
              status: 'SETTLED',
              updatedAt: new Date(),
            })
            .where(eq(schema.settlementBatch.id, settlementBatch.id));

          // 관련된 모든 BNPL 거래를 CAPTURED로 변경
          const batchItems = await this.dbService.db
            .select()
            .from(schema.settlementBatchItem)
            .where(eq(schema.settlementBatchItem.batchId, settlementBatch.id));

          for (const item of batchItems) {
            await this.dbService.db
              .update(schema.bnplTransaction)
              .set({ status: 'CAPTURED' })
              .where(eq(schema.bnplTransaction.id, item.bnplTransactionId));
          }

          console.log(
            `Monthly settlement completed for account: ${account.id}, amount: ${settlementBatch.totalAmount}`,
          );
        } else {
          console.error(
            `Failed to settle batch: ${settlementBatch.id}`,
            settlementResult.pgResponse,
          );
        }
      } catch (error) {
        console.error(
          `Error processing settlement batch: ${settlementBatch.id}`,
          error,
        );
      }
    }
  }
}
