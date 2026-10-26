import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq } from 'drizzle-orm';
import { CashReceiptType, WalletSchema, cashReceipts, paymentIntentItems, paymentIntents } from '../schema';
import { Charge, CashReceipt } from '../types';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { TossApiClient, TossPaymentQueryResponse } from '../providers/toss/toss-api.client';
import { usesTossWidget } from '../providers/toss/toss-widget-mode';
import { ledgerLegChargeId } from '../charges/ledger-leg';

// 발급 가능한 인텐트 상태 (결제 완료된 건만)
const PAYABLE_STATUSES = ['CAPTURED', 'SUCCEEDED'] as const;

// intent_id 는 uuid 컬럼. 비-UUID(더미 intentId 등)로 조회하면 postgres 가 uuid 캐스팅에서
// 터져 500 이 난다. 조회 전 형식을 검증해 안전하게 처리한다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** cashReceipts 는 발행·취소 이력이다. 실패 건을 빼고 발행액이 취소액보다 크면 살아 있는 영수증이 있다. */
function hasActiveTossReceipt(payment: TossPaymentQueryResponse): boolean {
  if (!Array.isArray(payment.cashReceipts)) return !!payment.cashReceipt;
  let net = 0;
  for (const r of payment.cashReceipts) {
    if (r.issueStatus === 'FAILED') continue;
    net += r.transactionType === 'CANCEL' ? -r.amount : r.amount;
  }
  return net > 0;
}

@Injectable()
export class CashReceiptsService {
  private readonly logger = new Logger(CashReceiptsService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly tossApiClient: TossApiClient,
  ) {}

  async issue(
    dto: { intentId: string; type: CashReceiptType; customerIdentityNumber: string },
    userId: string,
  ): Promise<CashReceipt> {
    const intent = await this.findIntentOrThrow(dto.intentId);

    if (intent.userId !== userId) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND', message: `Intent not found: ${dto.intentId}` });
    }
    if (!PAYABLE_STATUSES.includes(intent.status as (typeof PAYABLE_STATUSES)[number])) {
      throw new BadRequestException({
        error: 'INTENT_NOT_PAID',
        message: `결제 완료된 주문만 현금영수증을 발급할 수 있습니다: ${intent.status}`,
      });
    }

    // 안전 게이트: 카드(TOSS/NICEPAY)·포인트가 아닌 현금성(무통장) charge 만 발급 대상.
    // 카드는 매출전표가 증빙이라 현금영수증을 또 끊으면 안 됨.
    const charge = await this.findCashChargeOrThrow(dto.intentId);

    // 이중발급 방지 (DB partial unique index 와 짝)
    const existing = await this.findActiveByCharge(charge.id);
    if (existing) {
      throw new ConflictException({
        error: 'CASH_RECEIPT_ALREADY_ISSUED',
        message: '이미 현금영수증이 발급된 주문입니다.',
      });
    }

    await this.assertNoTossIssuedReceipt(charge);

    const orderName = await this.buildOrderName(dto.intentId);

    const result = await this.tossApiClient.issueCashReceipt({
      amount: charge.amount,
      orderId: dto.intentId,
      orderName,
      type: dto.type,
      customerIdentityNumber: dto.customerIdentityNumber,
    });

    if (!result.ok) {
      this.logger.error(`Cash receipt issue failed: intent=${dto.intentId}, error=${result.error.message}`);
      const failed = await this.dbService.db
        .insert(cashReceipts)
        .values({
          chargeId: charge.id,
          intentId: dto.intentId,
          userId,
          type: dto.type,
          customerIdentityNumber: dto.customerIdentityNumber,
          amount: charge.amount,
          currency: charge.currency,
          status: 'FAILED',
          errorCode: result.error.code,
          errorMessage: result.error.message.slice(0, 500),
        })
        .returning();
      throw new BadRequestException({
        error: 'CASH_RECEIPT_ISSUE_FAILED',
        message: result.error.message,
        receiptId: failed[0]?.id,
      });
    }

    const data = result.data;
    const inserted = await this.dbService.db
      .insert(cashReceipts)
      .values({
        chargeId: charge.id,
        intentId: dto.intentId,
        userId,
        type: dto.type,
        customerIdentityNumber: dto.customerIdentityNumber,
        amount: charge.amount,
        currency: charge.currency,
        status: 'ISSUED',
        receiptKey: data.receiptKey,
        issueNumber: data.issueNumber,
        receiptUrl: data.receiptUrl,
        responsePayload: data,
        issuedAt: new Date(),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('CASH_RECEIPT_INSERT_FAILED');
    return row;
  }

  /**
   * 환불 시 호출 — 해당 charge 의 ISSUED 현금영수증을 환불금액만큼 토스에서 취소한다.
   * 돈은 이미 환불됐으므로 영수증 취소 실패가 환불을 막아선 안 된다 (best-effort, 로깅만).
   */
  async cancelForRefund(chargeId: string, amount: number): Promise<void> {
    const receipt = await this.findActiveByCharge(chargeId);
    if (!receipt || !receipt.receiptKey) return;

    const cancelAmount = Math.min(amount, receipt.amount - receipt.canceledAmount);
    if (cancelAmount <= 0) return;

    const result = await this.tossApiClient.cancelCashReceipt(receipt.receiptKey, cancelAmount);
    if (!result.ok) {
      this.logger.error(
        `Cash receipt cancel failed (refund continues): charge=${chargeId}, receipt=${receipt.id}, error=${result.error.message}`,
      );
      return;
    }

    const newCanceled = receipt.canceledAmount + cancelAmount;
    const fullyCanceled = newCanceled >= receipt.amount;
    await this.dbService.db
      .update(cashReceipts)
      .set({
        canceledAmount: newCanceled,
        status: fullyCanceled ? 'CANCELED' : receipt.status,
        canceledAt: fullyCanceled ? new Date() : receipt.canceledAt,
        updatedAt: new Date(),
      })
      .where(eq(cashReceipts.id, receipt.id));
  }

  async findByIntent(intentId: string, userId: string): Promise<CashReceipt[]> {
    if (!UUID_RE.test(intentId)) return [];
    return this.dbService.db
      .select()
      .from(cashReceipts)
      .where(and(eq(cashReceipts.intentId, intentId), eq(cashReceipts.userId, userId)))
      .orderBy(asc(cashReceipts.createdAt));
  }

  // ─── 관리자용 ───
  /** 관리자 발급: 인텐트 소유자(userId)를 조회해 그 사용자 명의로 발급한다. */
  async issueAsAdmin(dto: {
    intentId: string;
    type: CashReceiptType;
    customerIdentityNumber: string;
  }): Promise<CashReceipt> {
    const intent = await this.findIntentOrThrow(dto.intentId);
    if (!intent.userId) {
      throw new BadRequestException({
        error: 'INTENT_HAS_NO_USER',
        message: `주문에 사용자 정보가 없어 현금영수증을 발급할 수 없습니다: ${dto.intentId}`,
      });
    }
    return this.issue(dto, intent.userId);
  }

  /** 관리자 조회: 소유자 스코프 없이 인텐트의 전체 현금영수증. */
  async findByIntentForAdmin(intentId: string): Promise<CashReceipt[]> {
    if (!UUID_RE.test(intentId)) return [];
    return this.dbService.db
      .select()
      .from(cashReceipts)
      .where(eq(cashReceipts.intentId, intentId))
      .orderBy(asc(cashReceipts.createdAt));
  }

  /** 현금영수증 발급 대상 charge = 환불 source charge 중 결제수단이 BANK_TRANSFER(무통장) 인 것. */
  private async findCashChargeOrThrow(intentId: string) {
    const charges = await this.chargesService.findRefundableByIntent(intentId);
    const cashCharges: typeof charges = [];
    for (const charge of charges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (method?.type === 'BANK_TRANSFER') cashCharges.push(charge);
    }
    if (cashCharges.length === 0) {
      throw new BadRequestException({
        error: 'CASH_RECEIPT_NOT_ELIGIBLE',
        message: '현금영수증은 무통장입금 결제만 발급할 수 있습니다. 카드결제는 매출전표가 증빙입니다.',
      });
    }
    // ponytail: intent 당 무통장 charge 는 사실상 1건. 여러 건이면 첫 건으로 발급, 분할발급은 추후.
    return cashCharges[0];
  }

  /**
   * 가상계좌는 입금되면 토스가 현금영수증을 자동 신청해 결제에 붙인다(고객이 결제창에서 고른 용도, 없으면 계약상 자진발급).
   * 우리 발급(POST /cash-receipts)은 결제와 연결되지 않는 독립 발급이라 토스가 중복을 막아 주지 않는다.
   * 조회를 못 하면 중복 여부를 모르므로 발급하지 않는다.
   */
  private async assertNoTossIssuedReceipt(charge: Charge) {
    // CAPTURE charge 엔 발급 스냅샷이 없다 — 환불과 같이 원래 AUTHORIZE charge 에서 읽는다.
    const legId = ledgerLegChargeId(charge);
    const leg = legId === charge.id ? charge : await this.chargesService.findById(legId);
    // providerTransactionId 는 보지 않는다 — 수동 입금확인은 거기에 입금자 메모를 적는다.
    const paymentKey = (leg?.responsePayload as { paymentKey?: unknown } | null | undefined)?.paymentKey;
    if (typeof paymentKey !== 'string' || !paymentKey) return;

    const result = await this.tossApiClient.getPayment(paymentKey, usesTossWidget(leg?.responsePayload));
    if (!result.ok) {
      this.logger.error(`Toss payment lookup failed before cash receipt issue: error=${result.error.message}`);
      throw new BadRequestException({
        error: 'TOSS_PAYMENT_LOOKUP_FAILED',
        message: '토스 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    if (hasActiveTossReceipt(result.data)) {
      throw new ConflictException({
        error: 'CASH_RECEIPT_ISSUED_BY_TOSS',
        message: '토스가 이 결제에 이미 현금영수증을 발급했습니다(고객의 결제창 신청 또는 자동 발급).',
      });
    }
  }

  private async findActiveByCharge(chargeId: string): Promise<CashReceipt | null> {
    const rows = await this.dbService.db
      .select()
      .from(cashReceipts)
      .where(and(eq(cashReceipts.chargeId, chargeId), eq(cashReceipts.status, 'ISSUED')))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findIntentOrThrow(intentId: string) {
    if (!UUID_RE.test(intentId)) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND', message: `Intent not found: ${intentId}` });
    }
    const rows = await this.dbService.db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    const intent = rows[0];
    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND', message: `Intent not found: ${intentId}` });
    }
    return intent;
  }

  private async buildOrderName(intentId: string): Promise<string> {
    const items = await this.dbService.db
      .select({ name: paymentIntentItems.name })
      .from(paymentIntentItems)
      .where(eq(paymentIntentItems.intentId, intentId))
      .orderBy(asc(paymentIntentItems.createdAt));
    if (items.length === 0) return '주문';
    const first = items[0].name;
    const name = items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;
    return name.slice(0, 100);
  }
}
