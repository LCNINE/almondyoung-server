import {
  InvoicePaidPayload,
  InvoicePaymentFailedPayload,
  InvoiceUncollectiblePayload,
  InvoiceVoidedPayload,
  MandateRejectedPayload,
} from '@packages/event-contracts/streams/payment.stream';
import { Invoice } from '../types';

// ADR-0027 §4-2. 인보이스가 자기 subscriberRef 로 결과를 발행한다 — membership 은 이 상관키로만 라우팅.
// payload 계약은 event-contracts(PAYMENT_STREAM)가 SoT — 발행/소비가 같은 타입을 공유한다.
export const INVOICE_AGGREGATE_TYPE = 'Invoice';

export const InvoiceEventType = {
  PAID: 'invoice.paid',
  PAYMENT_FAILED: 'invoice.payment_failed',
  UNCOLLECTIBLE: 'invoice.uncollectible',
  MANDATE_REJECTED: 'mandate.rejected',
  // 운영자/사용자의 명시 intent 취소로 인보이스가 VOID 종결됨 — 청구가 소멸했으므로
  // subscriber 는 선적용 자격을 회수해야 한다(안 그러면 무료 고착).
  VOIDED: 'invoice.voided',
} as const;

export type InvoiceEventType = (typeof InvoiceEventType)[keyof typeof InvoiceEventType];

export function invoicePartitionKey(subscriberType: string, subscriberRef: string): string {
  return `${subscriberType}:${subscriberRef}`;
}

export function buildInvoicePaidPayload(invoice: Invoice, intentId: string): InvoicePaidPayload {
  return {
    invoiceId: invoice.id,
    subscriberType: invoice.subscriberType,
    subscriberRef: invoice.subscriberRef,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    amount: invoice.amountDue,
    currency: invoice.currency,
    intentId,
    paidAt: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
  };
}

export function buildInvoicePaymentFailedPayload(
  invoice: Invoice,
  input: {
    intentId: string | null;
    attemptCount: number;
    nextAttemptAt: Date;
    errorCode: string | null;
    errorMessage: string | null;
  },
): InvoicePaymentFailedPayload {
  return {
    invoiceId: invoice.id,
    subscriberType: invoice.subscriberType,
    subscriberRef: invoice.subscriberRef,
    attemptCount: input.attemptCount,
    maxAttempts: invoice.maxAttempts,
    nextAttemptAt: input.nextAttemptAt.toISOString(),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    intentId: input.intentId,
    occurredAt: new Date().toISOString(),
  };
}

export function buildInvoiceUncollectiblePayload(
  invoice: Invoice,
  input: { intentId: string | null; errorCode: string | null; errorMessage: string | null },
): InvoiceUncollectiblePayload {
  return {
    invoiceId: invoice.id,
    subscriberType: invoice.subscriberType,
    subscriberRef: invoice.subscriberRef,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    intentId: input.intentId,
    occurredAt: new Date().toISOString(),
  };
}

export function buildMandateRejectedPayload(
  invoice: Invoice,
  input: { reasonCode: string | null; reason: string | null },
): MandateRejectedPayload {
  return {
    invoiceId: invoice.id,
    billingMethodId: invoice.billingMethodId,
    subscriberType: invoice.subscriberType,
    subscriberRef: invoice.subscriberRef,
    reasonCode: input.reasonCode,
    reason: input.reason,
    occurredAt: new Date().toISOString(),
  };
}

export function buildInvoiceVoidedPayload(
  invoice: Invoice,
  input: { reason: string | null; canceledIntentId: string | null },
): InvoiceVoidedPayload {
  return {
    invoiceId: invoice.id,
    subscriberType: invoice.subscriberType,
    subscriberRef: invoice.subscriberRef,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    reason: input.reason,
    intentId: input.canceledIntentId,
    occurredAt: new Date().toISOString(),
  };
}
