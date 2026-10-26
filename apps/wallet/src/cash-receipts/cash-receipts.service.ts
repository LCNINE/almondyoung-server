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

// 같은 키로 다시 보내도 결과를 모르면 토스 거래 목록으로 판정한다. 토스는 취소에 늘 IN_PROGRESS 로 답하고 목록엔 수 초 뒤
// COMPLETED 로 찍힌다(2026-10-26 샌드박스 실측) — 첫 크론 주기에 확정되게 짧게 둔다. 보내는 중인 취소는 합계가 그대로라 모름으로 남는다.
const CANCEL_LOOKUP_AFTER_MS = 60 * 1000;
// 목록의 완료 합계가 끝내 늘지 않으면 반영되지 않은 것으로 본다
const CANCEL_LOOKUP_NOT_FOUND_AFTER_MS = 60 * 60 * 1000;

/** from~to 의 KST 날짜(yyyy-MM-dd) — 토스 현금영수증 목록의 requestDate 단위 */
function kstDatesBetween(from: Date, to: Date): string[] {
  const kst = (t: number) => new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dates: string[] = [];
  const last = kst(to.getTime());
  for (let t = from.getTime(); dates.at(-1) !== last; t += 24 * 60 * 60 * 1000) {
    const d = kst(Math.min(t, to.getTime()));
    if (dates.at(-1) !== d) dates.push(d);
  }
  return dates;
}

/** 확정 뒤 최신 환불 합계로 다시 맞춰야 하는 영수증 표식. 다음 취소를 준비하기 전에 프로세스가 죽어도 크론이 이어받는다. */
const RECONCILE_MARKER = 'reconcileRequestedAt';

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
   * 취소는 «남긴다 → 보낸다 → 확정한다» 세 걸음이다. 보내기 전에 금액·멱등 키를 requestPayload.pendingCancel 에
   * 커밋해 두므로, 토스가 반영한 뒤 프로세스가 죽거나 응답이 끊겨도 다음 호출이 같은 키로 다시 보내 확정한다
   * (반영됐으면 토스가 저장해 둔 응답을 돌려준다). 남은 취소가 있으면 새 취소를 만들지 않는다.
   *
   * 토스 호출 중에는 행을 잠그지 않는다. 동시에 들어온 호출은 남은 취소를 같은 키로 보내므로 두 번 깎이지 않고,
   * 확정은 행을 다시 잠가 키가 그대로일 때만 한다 — 먼저 확정한 쪽만 취소액을 더한다.
   */
  async cancelForRefund(chargeId: string): Promise<void> {
    const charge = await this.chargesService.findById(chargeId);
    if (!charge) return;
    const legIds = await this.legChargeIds(charge);

    // 확정할 때마다 최신 환불 합계로 다시 맞춘다. 겹친 환불은 이 호출의 키를 받아 '처리 중'으로 물러나므로,
    // 여기서 다시 보지 않으면 그 환불분이 남은 취소 기록도 없이 빠진다. 새 취소가 거절되면 곧바로 다시 보내지 않는다.
    // ponytail: 라운드 상한 5 — 환불이 그보다 많이 겹치면 남은 몫은 확정 때 남긴 표식으로 크론이 이어서 맞춘다
    for (let round = 0; round < 5; round++) {
      const prepared = await this.prepareCancel(charge.amount, legIds);
      if (!prepared) return;
      let outcome = await this.sendCancel(prepared.receiptKey, prepared.attempt, prepared.receiptId);
      // 토스는 첫 응답(5xx·처리 중 포함)을 같은 키에 그대로 재생하므로, 다시 보내도 모르면 거래 목록에 묻는다
      if (outcome === 'unknown' && prepared.resumed) {
        outcome = await this.lookupCancel(prepared.receiptKey, prepared.attempt, prepared.receiptId);
      }
      await this.settleCancel(prepared.receiptId, prepared.attempt, outcome, prepared.resumed);
      if (outcome === 'unknown' || (outcome === 'rejected' && !prepared.resumed)) return;
    }
  }

  /** 보낼 취소를 정해 커밋한다 — 남은 취소가 있으면 그것, 없으면 목표까지의 새 취소. 보낼 게 없으면 null. */
  private async prepareCancel(
    chargeAmount: number,
    legIds: string[],
  ): Promise<{ receiptId: string; receiptKey: string; attempt: PendingCancel; resumed: boolean } | null> {
    return this.dbService.run(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(cashReceipts)
        .where(and(inArray(cashReceipts.chargeId, legIds), eq(cashReceipts.status, 'ISSUED')))
        .limit(1)
        .for('update');
      if (!receipt || !receipt.receiptKey) return null;

      const pending = readPendingCancel(receipt.requestPayload);
      if (pending) {
        if (Date.now() - Date.parse(pending.requestedAt) > PENDING_CANCEL_RESEND_WINDOW_MS) {
          this.logger.error(
            `Cash receipt cancel outcome unknown past idempotency window, needs manual check: receipt=${receipt.id}, amount=${pending.amount}`,
          );
          return null;
        }
        return { receiptId: receipt.id, receiptKey: receipt.receiptKey, attempt: pending, resumed: true };
      }

      const refunded = await tx
        .select({ amount: refunds.amount })
        .from(refunds)
        .where(and(inArray(refunds.chargeId, legIds), eq(refunds.status, 'SUCCEEDED')));
      const target = Math.max(0, chargeAmount - refunded.reduce((total, r) => total + r.amount, 0));
      const cancelAmount = receipt.amount - receipt.canceledAmount - target;
      if (cancelAmount <= 0) {
        if (receipt.requestPayload && RECONCILE_MARKER in receipt.requestPayload) {
          const restPayload = { ...receipt.requestPayload };
          delete restPayload[RECONCILE_MARKER];
          await tx
            .update(cashReceipts)
            .set({ requestPayload: restPayload, updatedAt: new Date() })
            .where(eq(cashReceipts.id, receipt.id));
        }
        return null;
      }

      const attempt: PendingCancel = {
        amount: cancelAmount,
        // 거절된 키는 토스가 실패 응답까지 캐시하므로 새 취소마다 새로 만든다
        idempotencyKey: `wallet:cash-receipt-cancel:${randomUUID()}`,
        requestedAt: new Date().toISOString(),
      };
      await tx
        .update(cashReceipts)
        .set({ requestPayload: { ...receipt.requestPayload, pendingCancel: attempt }, updatedAt: new Date() })
        .where(eq(cashReceipts.id, receipt.id));
      return { receiptId: receipt.id, receiptKey: receipt.receiptKey, attempt, resumed: false };
    });
  }

  /** 보낸 취소의 결과를 반영한다. 그 사이 다른 호출이 같은 취소를 확정했으면(키가 바뀜) 아무것도 안 한다. */
  private async settleCancel(
    receiptId: string,
    attempt: PendingCancel,
    outcome: 'applied' | 'rejected' | 'unknown',
    resumed: boolean,
  ): Promise<void> {
    await this.dbService.run(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(cashReceipts)
        .where(eq(cashReceipts.id, receiptId))
        .limit(1)
        .for('update');
      if (!receipt || readPendingCancel(receipt.requestPayload)?.idempotencyKey !== attempt.idempotencyKey) return;

      if (outcome === 'unknown') {
        // 크론이 updated_at 오래된 순으로 고른다 — 시도한 건을 뒤로 보내 같은 50건만 계속 고르지 않게
        await tx.update(cashReceipts).set({ updatedAt: new Date() }).where(eq(cashReceipts.id, receipt.id));
        return;
      }

      const restPayload: Record<string, unknown> = { ...receipt.requestPayload };
      delete restPayload.pendingCancel;
      // cancelForRefund 는 이어서 다음 취소를 준비한다(거절된 새 취소만 멈춘다). 그 사이에 죽으면 크론이 이 표식으로 다시 맞춘다.
      if (outcome === 'applied' || resumed) restPayload[RECONCILE_MARKER] = new Date().toISOString();
      else delete restPayload[RECONCILE_MARKER];
      const canceled = receipt.canceledAmount + (outcome === 'applied' ? attempt.amount : 0);
      const fullyCanceled = canceled >= receipt.amount;
      await tx
        .update(cashReceipts)
        .set({
          canceledAmount: canceled,
          status: fullyCanceled ? 'CANCELED' : receipt.status,
          canceledAt: fullyCanceled ? new Date() : receipt.canceledAt,
          requestPayload: restPayload,
          updatedAt: new Date(),
        })
        .where(eq(cashReceipts.id, receipt.id));
    });
  }

  /**
   * 결과를 모르는 취소가 남았거나 확정 뒤 다시 맞추다 끊긴 영수증을 다음 환불을 기다리지 않고 맞춘다(크론).
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
          sql`((${cashReceipts.requestPayload} -> 'pendingCancel' ->> 'requestedAt')::timestamptz > ${windowStart}::timestamptz
            or (${cashReceipts.requestPayload} ? ${RECONCILE_MARKER} and not ${cashReceipts.requestPayload} ? 'pendingCancel'))`,
        ),
      )
      .orderBy(asc(cashReceipts.updatedAt))
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
      // 접수만 된 취소(IN_PROGRESS)는 실패로 끝날 수 있다 — 확정하지 않고 거래 목록으로 판정한다
      if (result.ok && result.data.issueStatus === 'IN_PROGRESS') return 'unknown';
      if (result.ok && result.data.issueStatus === 'FAILED') return 'rejected';
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

  /**
   * 토스 거래 목록의 완료된 취소 합계를 DB 취소액과 대조해 판정한다. 부분 취소는 같은 receiptKey(`c_` 접두)·같은 금액으로
   * 여러 번 나올 수 있어 거래 하나를 이 시도와 짝지을 수 없다 — 합계로만 본다.
   * 처리 중인 취소가 있거나 합계가 어중간하면 모름. 늘지 않았으면 오래 지난 뒤에만 미반영. 조회가 실패해도 모름.
   * 목록은 요청일(KST) 단위라 영수증 발급일부터 오늘까지 모두 본다(자정을 넘긴 접수도 놓치지 않게).
   * ponytail: 발급일부터 날짜마다 한 번씩 부른다(오래된 영수증이면 수백 번). 무통장 환불 취소가 결과를 모를 때만 오므로 감수 —
   * 많아지면 날짜·합계 체크포인트를 requestPayload 에 남겨 이어 본다.
   */
  private async lookupCancel(
    receiptKey: string,
    attempt: PendingCancel,
    receiptId: string,
  ): Promise<'applied' | 'rejected' | 'unknown'> {
    const age = Date.now() - Date.parse(attempt.requestedAt);
    if (age < CANCEL_LOOKUP_AFTER_MS) return 'unknown';

    const [receipt] = await this.dbService.db
      .select({ canceledAmount: cashReceipts.canceledAmount, createdAt: cashReceipts.createdAt })
      .from(cashReceipts)
      .where(eq(cashReceipts.id, receiptId))
      .limit(1);
    if (!receipt) return 'unknown';

    const dates = kstDatesBetween(receipt.createdAt, new Date());
    let completed = 0;
    for (const requestDate of dates) {
      let cursor: number | undefined;
      do {
        const page = await this.tossApiClient.listCashReceipts(requestDate, cursor).catch(() => null);
        if (!page?.ok) {
          this.logger.error(`Cash receipt cancel lookup failed: receipt=${receiptId}, error=${page?.error.message}`);
          return 'unknown';
        }
        for (const r of page.data.data) {
          if (r.transactionType !== 'CANCEL' || r.receiptKey !== `c_${receiptKey}`) continue;
          if (r.issueStatus === 'IN_PROGRESS') return 'unknown';
          if (r.issueStatus === 'COMPLETED') completed += r.amount;
        }
        cursor = page.data.hasNext && page.data.lastCursor !== null ? page.data.lastCursor : undefined;
      } while (cursor !== undefined);
    }

    if (completed === receipt.canceledAmount + attempt.amount) return 'applied';
    if (completed === receipt.canceledAmount && age >= CANCEL_LOOKUP_NOT_FOUND_AFTER_MS) {
      this.logger.error(
        `Cash receipt cancel not applied per Toss lookup: receipt=${receiptId}, amount=${attempt.amount}`,
      );
      return 'rejected';
    }
    if (completed !== receipt.canceledAmount) {
      this.logger.error(
        `Cash receipt cancel total mismatch, needs manual check: receipt=${receiptId}, toss=${completed}, db=${receipt.canceledAmount}, pending=${attempt.amount}`,
      );
    }
    return 'unknown';
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
