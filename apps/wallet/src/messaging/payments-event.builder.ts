import { PaymentReferenceType, PaymentIntentStatus } from '../schema';

interface PaymentIntentPayloadInput {
  intentId: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  userId: string;
  status: PaymentIntentStatus;
  payableAmount: number;
  currency: string;
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

interface RefundAllocationItem {
  legId: string;
  amount: number;
}

interface RefundPayloadInput {
  refundId: string;
  intentId: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  userId: string;
  refundAmount: number;
  currency: string;
  allocation: RefundAllocationItem[];
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

export function buildPaymentIntentEventPayload(
  input: PaymentIntentPayloadInput,
): Record<string, unknown> {
  assertNonEmptyString('intentId', input.intentId);
  assertReferenceType(input.referenceType);
  assertNonEmptyString('referenceId', input.referenceId);
  assertNonEmptyString('userId', input.userId);
  assertNonEmptyString('status', input.status);
  assertAmount('payableAmount', input.payableAmount, {
    allowZero: true,
  });
  assertNonEmptyString('currency', input.currency);

  return {
    intentId: input.intentId,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    userId: input.userId,
    status: input.status,
    payableAmount: input.payableAmount,
    currency: input.currency,
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}

export function buildRefundEventPayload(
  input: RefundPayloadInput,
): Record<string, unknown> {
  assertNonEmptyString('refundId', input.refundId);
  assertNonEmptyString('intentId', input.intentId);
  assertReferenceType(input.referenceType);
  assertNonEmptyString('referenceId', input.referenceId);
  assertNonEmptyString('userId', input.userId);
  assertAmount('refundAmount', input.refundAmount, { allowZero: false });
  assertNonEmptyString('currency', input.currency);

  if (!Array.isArray(input.allocation) || input.allocation.length === 0) {
    throw new Error(
      'PAYMENTS_EVENT_PAYLOAD_INVALID: allocation must contain at least one item',
    );
  }

  for (const item of input.allocation) {
    assertNonEmptyString('allocation.legId', item.legId);
    assertAmount('allocation.amount', item.amount, { allowZero: false });
  }

  return {
    refundId: input.refundId,
    intentId: input.intentId,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    userId: input.userId,
    refundAmount: input.refundAmount,
    currency: input.currency,
    allocation: input.allocation,
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}

function assertReferenceType(value: PaymentReferenceType): void {
  if (value !== 'STORE_ORDER' && value !== 'SUBSCRIPTION_BILLING') {
    throw new Error(`PAYMENTS_EVENT_PAYLOAD_INVALID: unsupported referenceType=${value}`);
  }
}

function assertAmount(
  field: string,
  value: number,
  options: {
    allowZero: boolean;
  },
): void {
  if (!Number.isInteger(value)) {
    throw new Error(`PAYMENTS_EVENT_PAYLOAD_INVALID: ${field} must be an integer`);
  }

  if (options.allowZero) {
    if (value < 0) {
      throw new Error(`PAYMENTS_EVENT_PAYLOAD_INVALID: ${field} must be >= 0`);
    }
    return;
  }

  if (value <= 0) {
    throw new Error(`PAYMENTS_EVENT_PAYLOAD_INVALID: ${field} must be > 0`);
  }
}

function assertNonEmptyString(field: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `PAYMENTS_EVENT_PAYLOAD_INVALID: ${field} must be a non-empty string`,
    );
  }
}

function normalizeOccurredAt(occurredAt?: string): string {
  if (!occurredAt) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) {
    throw new Error('PAYMENTS_EVENT_PAYLOAD_INVALID: occurredAt must be ISO datetime');
  }

  return new Date(parsed).toISOString();
}

