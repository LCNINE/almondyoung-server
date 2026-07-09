import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, invoices, InvoiceStatus } from '../schema';

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

@Injectable()
export class InvoiceQueryService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

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
