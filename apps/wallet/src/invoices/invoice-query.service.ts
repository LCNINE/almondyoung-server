import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq } from 'drizzle-orm';
import { WalletSchema, invoices, billingAgreements, InvoiceStatus } from '../schema';

/**
 * 인보이스의 권위 상태를 정규 형태로 반환한다(ADR-0027 §4-3, reconciliation 조회 평면).
 * subscriber(membership)가 자기 소유 멱등키로 되물어 이벤트 유실을 스스로 해소하는 read-side 포트.
 */
export interface InvoiceStatusView {
  invoiceId: string;
  status: InvoiceStatus;
  subscriberType: string;
  subscriberRef: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  /** 성공/실패 시도의 intent — 터미널 결과 반영에 사용. 없으면 null. */
  intentId: string | null;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  reason: string | null;
}

/**
 * 고객(구독자)이 자기 인보이스를 볼 때의 안전 뷰 — 내부 intent/멱등키 등은 노출하지 않는다.
 * userId 는 invoices 에 없으므로 billing_agreements(userId↔subscriber) 브리지로 스코프를 건다.
 */
export interface MyInvoiceView {
  invoiceId: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  amountDue: number;
  currency: string;
  dueDate: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  /** 고객이 즉시 재시도할 수 있는 상태(진짜 실패=PAST_DUE)만 true. 심사대기/진행중은 재시도 불가. */
  isRetryable: boolean;
  createdAt: string;
}

@Injectable()
export class InvoiceQueryService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  /**
   * 고객 소유 인보이스 목록. billing_agreements.userId 로 스코프를 좁혀(subscriberType,subscriberRef) 조인,
   * 최신 청구주기 순. 구독과 무관한 인보이스는 조인에서 자연히 제외된다.
   */
  async findMineByUserId(userId: string, status?: InvoiceStatus): Promise<MyInvoiceView[]> {
    const conditions = [eq(billingAgreements.userId, userId)];
    if (status) conditions.push(eq(invoices.status, status));

    const rows = await this.dbService.db
      .select({
        id: invoices.id,
        status: invoices.status,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        amountDue: invoices.amountDue,
        currency: invoices.currency,
        dueDate: invoices.dueDate,
        attemptCount: invoices.attemptCount,
        maxAttempts: invoices.maxAttempts,
        nextAttemptAt: invoices.nextAttemptAt,
        metadata: invoices.metadata,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .innerJoin(
        billingAgreements,
        and(
          eq(billingAgreements.subscriberType, invoices.subscriberType),
          eq(billingAgreements.subscriberRef, invoices.subscriberRef),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(invoices.periodStart));

    return rows.map((r) => ({
      invoiceId: r.id,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      amountDue: r.amountDue,
      currency: r.currency,
      dueDate: r.dueDate,
      attemptCount: r.attemptCount,
      maxAttempts: r.maxAttempts,
      nextAttemptAt: r.nextAttemptAt ? r.nextAttemptAt.toISOString() : null,
      lastErrorCode: (r.metadata?.lastErrorCode as string | undefined) ?? null,
      isRetryable: r.status === 'PAST_DUE',
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * 소유권 검증용 단건 조회 — 인보이스가 해당 userId 의 약정에 속할 때만 반환(IDOR 방지).
   * 없거나 남의 것이면 null.
   */
  async findOwnedInvoice(userId: string, invoiceId: string): Promise<{ invoiceId: string; status: InvoiceStatus } | null> {
    const [row] = await this.dbService.db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .innerJoin(
        billingAgreements,
        and(
          eq(billingAgreements.subscriberType, invoices.subscriberType),
          eq(billingAgreements.subscriberRef, invoices.subscriberRef),
        ),
      )
      .where(and(eq(invoices.id, invoiceId), eq(billingAgreements.userId, userId)))
      .limit(1);
    return row ? { invoiceId: row.id, status: row.status } : null;
  }

  /** 멱등키로 인보이스 권위 상태 조회. 없으면 null(= 아직 미발행/커맨드 미도달). */
  async findByIdempotencyKey(idempotencyKey: string): Promise<InvoiceStatusView | null> {
    const [invoice] = await this.dbService.db
      .select()
      .from(invoices)
      .where(eq(invoices.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!invoice) return null;

    const meta = invoice.metadata;
    const intentId =
      (meta.lastPaidIntentId as string | undefined) ?? (meta.lastFailedIntentId as string | undefined) ?? null;

    return {
      invoiceId: invoice.id,
      status: invoice.status,
      subscriberType: invoice.subscriberType,
      subscriberRef: invoice.subscriberRef,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      amount: invoice.amountDue,
      currency: invoice.currency,
      intentId,
      attemptCount: invoice.attemptCount,
      maxAttempts: invoice.maxAttempts,
      errorCode: (meta.lastErrorCode as string | undefined) ?? null,
      reason: (meta.lastErrorMessage as string | undefined) ?? null,
    };
  }
}
