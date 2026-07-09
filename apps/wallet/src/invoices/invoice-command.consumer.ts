import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CreateInvoicePayload, VoidInvoicePayload } from '@packages/event-contracts/streams/wallet-command.stream';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { WalletSchema, invoices, outboxEvents } from '../schema';
import { BillingAgreementService } from '../billing/billing-agreement.service';
import { BillingMethodService } from '../billing/billing-method.service';
import { InvoiceOutcomeService } from './invoice-outcome.service';
import { buildOutboxInsertValues } from '../messaging/outbox-event.util';
import { INVOICE_AGGREGATE_TYPE, InvoiceEventType, invoicePartitionKey } from './invoice-event.builder';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_INTERVAL_HOURS = 72;

/**
 * ADR-0027 §4-1. membership 의 CreateInvoice/VoidInvoice 커맨드를 받아 인보이스를 생성/무효화한다.
 * 생성 이후의 집행(승인 대기·출금·재시도·정산)은 InvoiceExecutorService 가 전담.
 */
@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class InvoiceCommandConsumer {
  private readonly logger = new Logger(InvoiceCommandConsumer.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingAgreementService: BillingAgreementService,
    private readonly billingMethodService: BillingMethodService,
    private readonly invoiceOutcomeService: InvoiceOutcomeService,
  ) {}

  @OnEvent('wallet.commands.v1', 'CreateInvoice')
  async onCreateInvoice(@EventPayload() payload: CreateInvoicePayload) {
    this.logger.log(
      `[CreateInvoice] Received: subscriberRef=${payload.subscriberRef}, period=${payload.periodStart}~${payload.periodEnd}, key=${payload.idempotencyKey}`,
    );

    // 0원 청구는 집행 불가(charge 는 amount > 0) — 컨슈머 검증이 꺼진 배포에서도 stuck 인보이스를 막는다.
    // 조용히 drop 하면 subscriber 가 결과를 영영 못 받아 선적용 자격이 회수되지 않으므로(무료 고착),
    // mandate.rejected 를 멱등 발행해 폐루프를 닫는다.
    if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
      this.logger.error(
        `[CreateInvoice] Invalid amount ${payload.amount} — reject (subscriberRef=${payload.subscriberRef}, key=${payload.idempotencyKey})`,
      );
      await this.emitMandateRejectedWithoutInvoice(payload, null, 'INVALID_AMOUNT', '청구 금액이 유효하지 않습니다');
      return;
    }

    // 결제수단 해석: payload 에 없으면(갱신 주기 발행) 활성 billing_agreement 로 폴백.
    let billingMethodId = payload.billingMethodId ?? null;
    if (!billingMethodId) {
      const agreement = await this.billingAgreementService.findBySubscriberRef(
        payload.subscriberType,
        payload.subscriberRef,
      );
      billingMethodId = agreement?.billingMethodId ?? null;
    }

    const billingMethod = billingMethodId ? await this.billingMethodService.findById(billingMethodId) : undefined;
    if (!billingMethod || billingMethod.status !== 'ACTIVE') {
      // 유효한 결제수단(=mandate) 자체가 없다 — 인보이스 행을 만들 수 없으므로(FK NOT NULL)
      // mandate.rejected 를 직접 발행해 subscriber 가 자격을 회수하게 한다.
      this.logger.error(
        `[CreateInvoice] No usable billing method: subscriberRef=${payload.subscriberRef}, billingMethodId=${billingMethodId ?? '-'}`,
      );
      await this.emitMandateRejectedWithoutInvoice(
        payload,
        billingMethodId,
        'BILLING_METHOD_NOT_ACTIVE',
        '유효한 정기결제 수단이 없습니다',
      );
      return;
    }

    // OPEN 생성 시 next_attempt_at=due_date 초기화 필수(스키마 CHECK 강제, Phase 1 계약).
    const inserted = await this.dbService.db
      .insert(invoices)
      .values({
        subscriberType: payload.subscriberType,
        subscriberRef: payload.subscriberRef,
        billingMethodId: billingMethod.id,
        amountDue: payload.amount,
        currency: payload.currency.toUpperCase(),
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        dueDate: payload.dueDate,
        status: 'OPEN',
        nextAttemptAt: new Date(`${payload.dueDate}T00:00:00+09:00`),
        maxAttempts: payload.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        retryIntervalHours: payload.retryIntervalHours ?? DEFAULT_RETRY_INTERVAL_HOURS,
        idempotencyKey: payload.idempotencyKey,
        metadata: payload.metadata ?? {},
      })
      .onConflictDoNothing({ target: [invoices.idempotencyKey] })
      .returning({ id: invoices.id });

    if (inserted.length === 0) {
      // 터미널 인보이스에 재발행이 온다 = subscriber 가 결과를 못 받았다는 신호 → 자가치유 재발행.
      const [existing] = await this.dbService.db
        .select()
        .from(invoices)
        .where(eq(invoices.idempotencyKey, payload.idempotencyKey))
        .limit(1);
      if (existing && ['PAID', 'UNCOLLECTIBLE', 'MANDATE_REJECTED', 'VOID'].includes(existing.status)) {
        await this.invoiceOutcomeService.reEmitTerminalEvent(existing);
      } else {
        this.logger.log(`[CreateInvoice] Duplicate (key=${payload.idempotencyKey}) — skip`);
      }
      return;
    }
    this.logger.log(`[CreateInvoice] Created invoice ${inserted[0].id} (key=${payload.idempotencyKey})`);
  }

  /**
   * 인보이스 행을 만들 수 없는 거절(결제수단 부재·무효 금액)을 mandate.rejected 로 통지한다.
   * 인보이스가 없어 dedupe 근거가 없으므로, payload 에 실은 멱등키로 이미 발행됐는지 확인해 커맨드
   * 재전달 시 재발행을 억제한다(터미널 인보이스의 reEmit 은 별개 — 여기선 중복 억제). aggregate_id 는
   * UUID 컬럼이라 결정적 문자열을 넣을 수 없어, 멱등키는 payload 로만 라우팅한다.
   */
  private async emitMandateRejectedWithoutInvoice(
    payload: CreateInvoicePayload,
    billingMethodId: string | null,
    reasonCode: string,
    reason: string,
  ): Promise<void> {
    const [existing] = await this.dbService.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, InvoiceEventType.MANDATE_REJECTED),
          sql`${outboxEvents.payload} ->> 'idempotencyKey' = ${payload.idempotencyKey}`,
        ),
      )
      .limit(1);
    if (existing) {
      this.logger.log(`[CreateInvoice] mandate.rejected already emitted (key=${payload.idempotencyKey}) — skip`);
      return;
    }

    await this.dbService.db.insert(outboxEvents).values(
      buildOutboxInsertValues({
        eventType: InvoiceEventType.MANDATE_REJECTED,
        aggregateType: INVOICE_AGGREGATE_TYPE,
        aggregateId: randomUUID(),
        partitionKey: invoicePartitionKey(payload.subscriberType, payload.subscriberRef),
        payload: {
          invoiceId: null,
          idempotencyKey: payload.idempotencyKey,
          billingMethodId,
          subscriberType: payload.subscriberType,
          subscriberRef: payload.subscriberRef,
          reasonCode,
          reason,
          occurredAt: new Date().toISOString(),
        },
      }),
    );
  }

  @OnEvent('wallet.commands.v1', 'VoidInvoice')
  async onVoidInvoice(@EventPayload() payload: VoidInvoicePayload) {
    // ATTEMPTING 은 출금이 이미 나갔을 수 있어 무효화하지 않는다(CMS 환불 불가) — 정산 결과가 반영된다.
    const voided = await this.dbService.db
      .update(invoices)
      .set({ status: 'VOID', finalizedAt: new Date(), nextAttemptAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(invoices.subscriberType, payload.subscriberType),
          eq(invoices.subscriberRef, payload.subscriberRef),
          inArray(invoices.status, ['DRAFT', 'OPEN', 'MANDATE_PENDING', 'PAST_DUE']),
        ),
      )
      .returning({ id: invoices.id });

    this.logger.log(
      `[VoidInvoice] subscriberRef=${payload.subscriberRef}, reason=${payload.reason} — ${voided.length} invoice(s) voided`,
    );

    const attempting = await this.dbService.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriberType, payload.subscriberType),
          eq(invoices.subscriberRef, payload.subscriberRef),
          eq(invoices.status, 'ATTEMPTING'),
        ),
      );
    if (attempting.length > 0) {
      this.logger.warn(
        `[VoidInvoice] 집행 중(ATTEMPTING) 인보이스 ${attempting.map((r) => r.id).join(', ')} 은 무효화하지 않음 — 정산 결과 대기`,
      );
    }
  }
}
