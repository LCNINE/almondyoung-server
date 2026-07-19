import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { addHours } from 'date-fns';
import { WalletSchema, invoices, outboxEvents, billingAgreements, billingMethods, InvoiceStatus } from '../schema';
import { Invoice, DbTx } from '../types';
import { buildOutboxInsertValues } from '../messaging/outbox-event.util';
import {
  INVOICE_AGGREGATE_TYPE,
  InvoiceEventType,
  buildInvoicePaidPayload,
  buildInvoicePaymentFailedPayload,
  buildInvoiceUncollectiblePayload,
  buildMandateRejectedPayload,
  buildInvoiceVoidedPayload,
  invoicePartitionKey,
} from './invoice-event.builder';

/** 터미널이 아닌 상태 — 결과 반영이 허용되는 집합. 터미널 도달 후 재반영은 전부 no-op. */
const NON_TERMINAL_STATUSES: InvoiceStatus[] = ['DRAFT', 'OPEN', 'MANDATE_PENDING', 'ATTEMPTING', 'PAST_DUE'];

/**
 * 인보이스 상태머신의 전이 + 결과 이벤트 발행(ADR-0027 §3-1). 모든 전이는 비터미널 행잠금
 * 조건부 UPDATE 이고, 전이된 경우에만 같은 tx 에서 outbox 를 적재한다 — 재전달/동시 실행에 멱등.
 */
@Injectable()
export class InvoiceOutcomeService {
  private readonly logger = new Logger(InvoiceOutcomeService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  /** 출금(승인) 성공 → PAID + invoice.paid. */
  async markPaid(invoiceId: string, intentId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const invoice = await this.lockNonTerminal(tx, invoiceId);
      if (!invoice) return;

      await tx
        .update(invoices)
        .set({
          status: 'PAID',
          finalizedAt: new Date(),
          nextAttemptAt: null,
          updatedAt: new Date(),
          // 결과 재발행(reEmitTerminalEvent)이 성공 intent 를 알 수 있도록 기록
          metadata: { ...invoice.metadata, lastPaidIntentId: intentId },
        })
        .where(eq(invoices.id, invoiceId));

      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: InvoiceEventType.PAID,
          aggregateType: INVOICE_AGGREGATE_TYPE,
          aggregateId: invoice.id,
          partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
          payload: { ...buildInvoicePaidPayload(invoice, intentId) },
        }),
      );

      this.logger.log(`Invoice ${invoiceId} PAID (intentId=${intentId})`);
    });
  }

  /**
   * 진짜 결제 실패(잔액부족 등) — MANDATE_PENDING 대기와 달리 여기서만 attempt_count 가 오른다.
   * 재시도 여지가 있으면 PAST_DUE + invoice.payment_failed, 소진이면 UNCOLLECTIBLE + invoice.uncollectible.
   */
  async registerAttemptFailure(
    invoiceId: string,
    intentId: string | null,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const invoice = await this.lockNonTerminal(tx, invoiceId);
      if (!invoice) return;

      // 구독 취소(VoidInvoice)가 이 인보이스의 집행 중에 도착해 void 마커가 남아 있으면,
      // 실패를 재시도(더닝)로 이어가지 않고 VOID 로 종결한다 — 해지된 구독의 계좌에서
      // 재출금되는 것을 막는다. (정산 성공은 markPaid 가 그대로 PAID 처리; 대금은 정당.)
      if (invoice.metadata.voidRequested) {
        const reason = (invoice.metadata.voidReason as string | undefined) ?? 'SUBSCRIPTION_CANCELLED';
        await tx
          .update(invoices)
          .set({
            status: 'VOID',
            finalizedAt: new Date(),
            nextAttemptAt: null,
            updatedAt: new Date(),
            metadata: { ...invoice.metadata, voidReason: reason, lastFailedIntentId: intentId },
          })
          .where(eq(invoices.id, invoiceId));

        await tx.insert(outboxEvents).values(
          buildOutboxInsertValues({
            eventType: InvoiceEventType.VOIDED,
            aggregateType: INVOICE_AGGREGATE_TYPE,
            aggregateId: invoice.id,
            partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
            payload: { ...buildInvoiceVoidedPayload(invoice, { reason, canceledIntentId: intentId }) },
          }),
        );

        this.logger.warn(`Invoice ${invoiceId} VOID — 집행 중 취소 요청된 인보이스의 정산 실패 (reason=${reason})`);
        return;
      }

      // 같은 시도(intent)의 실패가 두 경로(정산 폴러/stale reconcile)로 중복 도착해도
      // attempt_count 는 한 번만 오른다 — 조기 UNCOLLECTIBLE 방지.
      if (intentId && invoice.metadata.lastFailedIntentId === intentId) {
        this.logger.log(`Invoice ${invoiceId} failure for intent ${intentId} already counted — skip`);
        return;
      }
      const failureMeta = {
        ...invoice.metadata,
        lastFailedIntentId: intentId,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      };

      const attemptCount = invoice.attemptCount + 1;

      if (attemptCount >= invoice.maxAttempts) {
        await tx
          .update(invoices)
          .set({
            status: 'UNCOLLECTIBLE',
            attemptCount,
            finalizedAt: new Date(),
            nextAttemptAt: null,
            updatedAt: new Date(),
            metadata: failureMeta,
          })
          .where(eq(invoices.id, invoiceId));

        await tx.insert(outboxEvents).values(
          buildOutboxInsertValues({
            eventType: InvoiceEventType.UNCOLLECTIBLE,
            aggregateType: INVOICE_AGGREGATE_TYPE,
            aggregateId: invoice.id,
            partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
            payload: { ...buildInvoiceUncollectiblePayload(invoice, { intentId, errorCode, errorMessage }) },
          }),
        );

        this.logger.warn(
          `Invoice ${invoiceId} UNCOLLECTIBLE — 재시도 소진 (${attemptCount}/${invoice.maxAttempts}, errorCode=${errorCode})`,
        );
        return;
      }

      const nextAttemptAt = addHours(new Date(), invoice.retryIntervalHours);
      await tx
        .update(invoices)
        .set({ status: 'PAST_DUE', attemptCount, nextAttemptAt, updatedAt: new Date(), metadata: failureMeta })
        .where(eq(invoices.id, invoiceId));

      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: InvoiceEventType.PAYMENT_FAILED,
          aggregateType: INVOICE_AGGREGATE_TYPE,
          aggregateId: invoice.id,
          partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
          payload: {
            ...buildInvoicePaymentFailedPayload(invoice, {
              intentId,
              attemptCount,
              nextAttemptAt,
              errorCode,
              errorMessage,
            }),
          },
        }),
      );

      this.logger.warn(
        `Invoice ${invoiceId} PAST_DUE (${attemptCount}/${invoice.maxAttempts}, next=${nextAttemptAt.toISOString()}, errorCode=${errorCode})`,
      );
    });
  }

  /** 결제수단 심사 최종 거절 → MANDATE_REJECTED + mandate.rejected (선적용 자격 회수 트리거, ADR §7). */
  async rejectMandate(invoiceId: string, reasonCode: string | null, reason: string | null): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const invoice = await this.lockNonTerminal(tx, invoiceId);
      if (!invoice) return;
      await this.rejectMandateInTx(tx, invoice, reasonCode, reason);
    });
  }

  /**
   * 심사 실패 결제수단의 비터미널 인보이스 거절 처리(ATTEMPTING 은 정산 결과가 담당).
   * 활성 agreement 가 다른 살아있는 수단을 가리키면 거절 대신 재지정 — 계좌 교체가 자격 회수로 번지지 않게.
   */
  async rejectMandateForBillingMethod(
    billingMethodId: string,
    reasonCode: string | null,
    reason: string | null,
  ): Promise<number> {
    return this.dbService.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.billingMethodId, billingMethodId),
            inArray(invoices.status, ['DRAFT', 'OPEN', 'MANDATE_PENDING', 'PAST_DUE']),
          ),
        )
        .for('update');

      let rejected = 0;
      for (const invoice of rows) {
        const [replacement] = await tx
          .select({ methodId: billingMethods.id })
          .from(billingAgreements)
          .innerJoin(billingMethods, eq(billingMethods.id, billingAgreements.billingMethodId))
          .where(
            and(
              eq(billingAgreements.subscriberType, invoice.subscriberType),
              eq(billingAgreements.subscriberRef, invoice.subscriberRef),
              eq(billingAgreements.status, 'ACTIVE'),
              eq(billingMethods.status, 'ACTIVE'),
            ),
          )
          .limit(1);

        if (replacement && replacement.methodId !== billingMethodId) {
          await tx
            .update(invoices)
            .set({ billingMethodId: replacement.methodId, nextAttemptAt: new Date(), updatedAt: new Date() })
            .where(eq(invoices.id, invoice.id));
          this.logger.log(
            `Invoice ${invoice.id} rerouted to replacement method ${replacement.methodId} (원 수단 심사 실패, 교체 수단 존재)`,
          );
          continue;
        }

        await this.rejectMandateInTx(tx, invoice, reasonCode, reason);
        rejected += 1;
      }
      return rejected;
    });
  }

  /** cms-member-poller PENDING→REGISTERED 훅: 심사 대기 인보이스의 다음 시도를 즉시로 당긴다. */
  async pullForwardMandatePending(billingMethodId: string): Promise<number> {
    const rows = await this.dbService.db
      .update(invoices)
      .set({ nextAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.billingMethodId, billingMethodId), eq(invoices.status, 'MANDATE_PENDING')))
      .returning({ id: invoices.id });
    if (rows.length > 0) {
      this.logger.log(
        `Mandate registered — ${rows.length} invoice(s) pulled forward (billingMethodId=${billingMethodId})`,
      );
    }
    return rows.length;
  }

  private async rejectMandateInTx(
    tx: DbTx,
    invoice: Invoice,
    reasonCode: string | null,
    reason: string | null,
  ): Promise<void> {
    await tx
      .update(invoices)
      .set({
        status: 'MANDATE_REJECTED',
        finalizedAt: new Date(),
        nextAttemptAt: null,
        updatedAt: new Date(),
        metadata: { ...invoice.metadata, lastErrorCode: reasonCode, lastErrorMessage: reason },
      })
      .where(eq(invoices.id, invoice.id));

    await tx.insert(outboxEvents).values(
      buildOutboxInsertValues({
        eventType: InvoiceEventType.MANDATE_REJECTED,
        aggregateType: INVOICE_AGGREGATE_TYPE,
        aggregateId: invoice.id,
        partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
        payload: { ...buildMandateRejectedPayload(invoice, { reasonCode, reason }) },
      }),
    );

    this.logger.warn(`Invoice ${invoice.id} MANDATE_REJECTED (reasonCode=${reasonCode})`);
  }

  /**
   * 명시 intent 취소 인보이스를 VOID 종결 + invoice.voided 발행 — 재스케줄하면 취소를 배반하고,
   * 통지 없이 닫으면 선적용 자격이 무료 고착된다.
   */
  async voidAfterExplicitCancel(invoiceId: string, canceledIntentId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const invoice = await this.lockNonTerminal(tx, invoiceId);
      if (!invoice) return;

      await tx
        .update(invoices)
        .set({
          status: 'VOID',
          finalizedAt: new Date(),
          nextAttemptAt: null,
          updatedAt: new Date(),
          metadata: { ...invoice.metadata, voidReason: 'EXPLICIT_INTENT_CANCEL', canceledIntentId },
        })
        .where(eq(invoices.id, invoiceId));

      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: InvoiceEventType.VOIDED,
          aggregateType: INVOICE_AGGREGATE_TYPE,
          aggregateId: invoice.id,
          partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
          payload: { ...buildInvoiceVoidedPayload(invoice, { reason: 'EXPLICIT_INTENT_CANCEL', canceledIntentId }) },
        }),
      );

      this.logger.warn(`Invoice ${invoiceId} VOID — explicit intent cancel (intentId=${canceledIntentId})`);
    });
  }

  /**
   * 터미널 인보이스에 CreateInvoice 가 재수신되면 결과 이벤트를 재발행한다 — subscriber 가
   * 결과를 못 받아 같은 키로 재발행 중이라는 신호(유실 자가치유). 중복 수신은 멱등 마커가 흡수.
   */
  async reEmitTerminalEvent(invoice: Invoice): Promise<void> {
    const meta = invoice.metadata;
    let eventType: string;
    let payload: Record<string, unknown>;

    switch (invoice.status) {
      case 'PAID':
        eventType = InvoiceEventType.PAID;
        payload = { ...buildInvoicePaidPayload(invoice, (meta.lastPaidIntentId as string | undefined) ?? '') };
        break;
      case 'UNCOLLECTIBLE':
        eventType = InvoiceEventType.UNCOLLECTIBLE;
        payload = {
          ...buildInvoiceUncollectiblePayload(invoice, {
            intentId: (meta.lastFailedIntentId as string | null | undefined) ?? null,
            errorCode: (meta.lastErrorCode as string | null | undefined) ?? null,
            errorMessage: (meta.lastErrorMessage as string | null | undefined) ?? null,
          }),
        };
        break;
      case 'MANDATE_REJECTED':
        eventType = InvoiceEventType.MANDATE_REJECTED;
        payload = {
          ...buildMandateRejectedPayload(invoice, {
            reasonCode: (meta.lastErrorCode as string | null | undefined) ?? null,
            reason: (meta.lastErrorMessage as string | null | undefined) ?? null,
          }),
        };
        break;
      case 'VOID':
        // subscriber(membership)가 주도한 void 는 계약이 이미 CANCELLED 라 스케줄러가 재발행하지
        // 않는다 — 여기 도달하는 VOID 는 명시 intent 취소로 종결됐는데 subscriber 가 아직 결과를
        // 못 받아 고착된 케이스뿐이므로 invoice.voided 를 재발행해 폐루프를 닫는다.
        eventType = InvoiceEventType.VOIDED;
        payload = {
          ...buildInvoiceVoidedPayload(invoice, {
            reason: (meta.voidReason as string | null | undefined) ?? null,
            canceledIntentId: (meta.canceledIntentId as string | null | undefined) ?? null,
          }),
        };
        break;
      default:
        return; // 비터미널 — 재발행할 결과 없음
    }

    await this.dbService.db.insert(outboxEvents).values(
      buildOutboxInsertValues({
        eventType,
        aggregateType: INVOICE_AGGREGATE_TYPE,
        aggregateId: invoice.id,
        partitionKey: invoicePartitionKey(invoice.subscriberType, invoice.subscriberRef),
        payload: { ...payload },
      }),
    );
    this.logger.log(`Invoice ${invoice.id} terminal event re-emitted (${eventType}) — 결과 유실 자가치유`);
  }

  /** 비터미널 인보이스를 행잠금으로 확보. 터미널이면 null (멱등 no-op). */
  private async lockNonTerminal(tx: DbTx, invoiceId: string): Promise<Invoice | null> {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), inArray(invoices.status, NON_TERMINAL_STATUSES)))
      .for('update');
    if (!invoice) {
      this.logger.log(`Invoice ${invoiceId} not found or already terminal — skip`);
      return null;
    }
    return invoice;
  }
}
