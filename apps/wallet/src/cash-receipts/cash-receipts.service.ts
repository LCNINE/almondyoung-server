import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  CashReceiptType,
  WalletSchema,
  cashReceipts,
  charges,
  paymentIntentItems,
  paymentIntents,
  refunds,
} from '../schema';
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

/**
 * cashReceipts 는 발행·취소 이력이다. 발행은 실패만 빼고(진행 중도 살아 있다), 취소는 완료된 것만 뺀다.
 * 진행 중인 취소를 빼면 그 취소가 실패했을 때 영수증 두 장이 함께 살아 있게 된다.
 */
function hasActiveTossReceipt(payment: TossPaymentQueryResponse): boolean {
  if (!Array.isArray(payment.cashReceipts)) return !!payment.cashReceipt;
  let net = 0;
  for (const r of payment.cashReceipts) {
    if (r.transactionType === 'CANCEL') {
      if (r.issueStatus === 'COMPLETED') net -= r.amount;
    } else if (r.issueStatus !== 'FAILED') {
      net += r.amount;
    }
  }
  return net > 0;
}

/** 응답이 끊겨 토스에 반영됐는지 모르는 영수증 취소. 같은 멱등 키로 다시 보내 결과를 확정한다. */
interface PendingCancel {
  amount: number;
  idempotencyKey: string;
  requestedAt: string;
}

const UNRESOLVED_CANCEL_STATUSES = new Set([401, 403, 408, 429]);

// 토스 멱등 키는 15일 동안만 유효하다. 그 뒤 같은 키로 보내면 새 요청으로 처리돼 또 깎인다.
const PENDING_CANCEL_RESEND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function readPendingCancel(requestPayload: Record<string, unknown> | null): PendingCancel | null {
  const pending = requestPayload?.pendingCancel as Partial<PendingCancel> | undefined;
  if (
    typeof pending?.amount !== 'number' ||
    typeof pending.idempotencyKey !== 'string' ||
    typeof pending.requestedAt !== 'string'
  ) {
    return null;
  }
  return { amount: pending.amount, idempotencyKey: pending.idempotencyKey, requestedAt: pending.requestedAt };
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

    // 환불 행·영수증은 경로에 따라 CAPTURE 와 원래 AUTHORIZE 중 어느 쪽 id 로도 남는다
    const legIds = await this.legChargeIds(charge);

    // 이중발급 방지 (DB partial unique index 와 짝)
    const existing = await this.findActiveByCharges(legIds);
    if (existing) {
      throw new ConflictException({
        error: 'CASH_RECEIPT_ALREADY_ISSUED',
        message: '이미 현금영수증이 발급된 주문입니다.',
      });
    }

    await this.assertNoTossIssuedReceipt(charge);

    // 먼저 부분 환불된 결제는 남은 금액만 발급한다. 진행 중(PENDING) 환불은 성공할 때 cancelForRefund 가 맞춘다.
    const amount = charge.amount - (await this.getSucceededRefundedTotal(legIds));
    if (amount <= 0) {
      throw new BadRequestException({
        error: 'CASH_RECEIPT_NOTHING_TO_ISSUE',
        message: '환불되어 현금영수증을 발급할 금액이 없습니다.',
      });
    }

    const orderName = await this.buildOrderName(dto.intentId);

    const result = await this.tossApiClient.issueCashReceipt({
      amount,
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
          amount,
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
        amount,
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

    // 합계를 읽은 뒤 저장 전에 성공한 환불은 그 환불의 cancelForRefund 가 영수증을 못 찾고 지나갔다.
    // 저장 직후 한 번 더 맞춘다. 발급은 이미 됐으므로 실패해도 되돌리지 않는다.
    await this.cancelForRefund(charge.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cash receipt reconcile after issue failed: receipt=${row.id}, error=${message}`);
    });
    return row;
  }

  /**
   * 환불 성공 뒤 호출 — 그 결제분의 ISSUED 현금영수증을 (결제 금액 − 성공한 환불 합계)에 맞춰 토스에서 취소한다.
   * 받은 환불 금액만큼 빼지 않고 목표에 맞추므로, 발급 때 이미 뺀 환불이 다시 빠지지 않고 여러 번 불려도 같다.
   * 돈은 이미 환불됐으므로 영수증 취소 실패가 환불을 막아선 안 된다 (best-effort, 로깅만).
   *
   * 영수증 행을 잠근 채 조회 → 토스 취소 → 갱신한다. 환불 두 건이 동시에 성공하면 둘 다 같은 취소액을 읽고
   * 목표까지 각자 취소해 토스에서 두 번 깎인다. 뒤에 온 호출은 앞 호출의 갱신을 보고 취소할 게 없어 끝난다.
   *
   * 응답이 끊긴 취소는 canceledAmount 에 안 잡혀 있다. 그대로 목표를 다시 계산하면 이미 깎인 금액을 또 깎으므로,
   * 결과를 모르는 취소는 requestPayload.pendingCancel 에 남기고 다음 호출이 같은 멱등 키로 먼저 확정한다.
   * 확정하지 못하면 더 취소하지 않는다.
   */
  async cancelForRefund(chargeId: string): Promise<void> {
    const charge = await this.chargesService.findById(chargeId);
    if (!charge) return;
    const legIds = await this.legChargeIds(charge);

    await this.dbService.run(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(cashReceipts)
        .where(and(inArray(cashReceipts.chargeId, legIds), eq(cashReceipts.status, 'ISSUED')))
        .limit(1)
        .for('update');
      if (!receipt || !receipt.receiptKey) return;
      const receiptKey = receipt.receiptKey;

      let canceled = receipt.canceledAmount;
      const storedPending = readPendingCancel(receipt.requestPayload);
      let pending = storedPending;
      const save = async () => {
        if (canceled === receipt.canceledAmount && pending === storedPending) return;
        const restPayload = { ...receipt.requestPayload };
        delete restPayload.pendingCancel;
        const fullyCanceled = canceled >= receipt.amount;
        await tx
          .update(cashReceipts)
          .set({
            canceledAmount: canceled,
            status: fullyCanceled ? 'CANCELED' : receipt.status,
            canceledAt: fullyCanceled ? new Date() : receipt.canceledAt,
            requestPayload: pending ? { ...restPayload, pendingCancel: pending } : restPayload,
            updatedAt: new Date(),
          })
          .where(eq(cashReceipts.id, receipt.id));
      };

      if (pending) {
        if (Date.now() - Date.parse(pending.requestedAt) > PENDING_CANCEL_RESEND_WINDOW_MS) {
          this.logger.error(
            `Cash receipt cancel outcome unknown past idempotency window, needs manual check: receipt=${receipt.id}, amount=${pending.amount}`,
          );
          return;
        }
        const outcome = await this.sendCancel(receiptKey, pending, receipt.id);
        if (outcome === 'unknown') return;
        if (outcome === 'applied') canceled += pending.amount;
        pending = null;
      }

      const refunded = await tx
        .select({ amount: refunds.amount })
        .from(refunds)
        .where(and(inArray(refunds.chargeId, legIds), eq(refunds.status, 'SUCCEEDED')));
      const target = Math.max(0, charge.amount - refunded.reduce((total, r) => total + r.amount, 0));
      const cancelAmount = receipt.amount - canceled - target;
      if (cancelAmount > 0) {
        const attempt: PendingCancel = {
          amount: cancelAmount,
          // 결과를 모르면 pendingCancel 이 이 키를 들고 있다. 거절된 키는 토스가 실패 응답까지 캐시하므로 시도마다 새로 만든다.
          idempotencyKey: `wallet:cash-receipt-cancel:${randomUUID()}`,
          requestedAt: new Date().toISOString(),
        };
        const outcome = await this.sendCancel(receiptKey, attempt, receipt.id);
        if (outcome === 'applied') canceled += cancelAmount;
        if (outcome === 'unknown') pending = attempt;
      }
      await save();
    });
  }

  /**
   * 결과를 모르는 취소가 남은 영수증을 다음 환불을 기다리지 않고 확정한다(크론).
   * 멱등 키 유효기간이 지난 건은 cancelForRefund 가 다시 보내지 않으므로 고르지 않는다 — 매 주기 상한을 차지하지 않게.
   */
  async resolvePendingCancels(limit = 50): Promise<{ scanned: number; failed: number }> {
    const windowStart = new Date(Date.now() - PENDING_CANCEL_RESEND_WINDOW_MS).toISOString();
    const rows = await this.dbService.db
      .select({ chargeId: cashReceipts.chargeId })
      .from(cashReceipts)
      .where(
        and(
          eq(cashReceipts.status, 'ISSUED'),
          sql`(${cashReceipts.requestPayload} -> 'pendingCancel' ->> 'requestedAt')::timestamptz > ${windowStart}::timestamptz`,
        ),
      )
      .limit(limit);
    let failed = 0;
    for (const row of rows) {
      await this.cancelForRefund(row.chargeId).catch((error: unknown) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Cash receipt pending cancel resolve failed: charge=${row.chargeId}, error=${message}`);
      });
    }
    return { scanned: rows.length, failed };
  }

  /**
   * 토스가 받았는지 모르는 경우(응답 없음·5xx·이전 멱등 요청 처리 중)는 'unknown'.
   * 같은 키로 다시 보냈을 때 업무 거절(4xx)이면 원래 요청도 반영되지 않은 것이다 — 반영됐다면 토스가 그 응답을 돌려준다.
   * 인증·한도(401·403·408·429)는 멱등 응답을 찾기 전에 막힌 것이라 원래 결과를 말해 주지 않으므로 'unknown'.
   */
  private async sendCancel(
    receiptKey: string,
    attempt: PendingCancel,
    receiptId: string,
  ): Promise<'applied' | 'rejected' | 'unknown'> {
    try {
      const result = await this.tossApiClient.cancelCashReceipt(receiptKey, attempt.amount, attempt.idempotencyKey);
      if (result.ok) return 'applied';
      const unknown =
        result.statusCode >= 500 ||
        UNRESOLVED_CANCEL_STATUSES.has(result.statusCode) ||
        result.error.code === 'IDEMPOTENT_REQUEST_PROCESSING';
      this.logger.error(
        `Cash receipt cancel ${unknown ? 'outcome unknown' : 'failed'} (refund continues): receipt=${receiptId}, amount=${attempt.amount}, error=${result.error.message}`,
      );
      return unknown ? 'unknown' : 'rejected';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Cash receipt cancel outcome unknown: receipt=${receiptId}, amount=${attempt.amount}, error=${message}`,
      );
      return 'unknown';
    }
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

  /** 같은 결제분의 charge id — 원래 AUTHORIZE 와 그것을 캡처한 CAPTURE 들. */
  private async legChargeIds(charge: Charge): Promise<string[]> {
    const authorizeId = ledgerLegChargeId(charge);
    const captures = await this.dbService.db
      .select()
      .from(charges)
      .where(and(eq(charges.intentId, charge.intentId), eq(charges.operation, 'CAPTURE')));
    const captureIds = captures.filter((c) => ledgerLegChargeId(c) === authorizeId).map((c) => c.id);
    return [...new Set([charge.id, authorizeId, ...captureIds])];
  }

  private async getSucceededRefundedTotal(chargeIds: string[]): Promise<number> {
    const rows = await this.dbService.db
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(and(inArray(refunds.chargeId, chargeIds), eq(refunds.status, 'SUCCEEDED')));
    return rows.reduce((total, r) => total + r.amount, 0);
  }

  private async findActiveByCharges(chargeIds: string[]): Promise<CashReceipt | null> {
    const rows = await this.dbService.db
      .select()
      .from(cashReceipts)
      .where(and(inArray(cashReceipts.chargeId, chargeIds), eq(cashReceipts.status, 'ISSUED')))
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
