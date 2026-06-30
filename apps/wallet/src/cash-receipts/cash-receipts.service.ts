import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq } from 'drizzle-orm';
import { CashReceiptType, WalletSchema, cashReceipts, paymentIntentItems, paymentIntents } from '../schema';
import { CashReceipt } from '../types';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { TossApiClient } from '../providers/toss/toss-api.client';

// 발급 가능한 인텐트 상태 (결제 완료된 건만)
const PAYABLE_STATUSES = ['CAPTURED', 'SUCCEEDED'] as const;

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
    return this.dbService.db
      .select()
      .from(cashReceipts)
      .where(and(eq(cashReceipts.intentId, intentId), eq(cashReceipts.userId, userId)))
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

  private async findActiveByCharge(chargeId: string): Promise<CashReceipt | null> {
    const rows = await this.dbService.db
      .select()
      .from(cashReceipts)
      .where(and(eq(cashReceipts.chargeId, chargeId), eq(cashReceipts.status, 'ISSUED')))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findIntentOrThrow(intentId: string) {
    const rows = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
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
