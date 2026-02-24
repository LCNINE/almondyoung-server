import { PaymentIntentStatus, ChargeStatus, RefundStatus } from '../schema';

// ─── Payment Intent Events ────────────────────────────────────────────────────

export interface PaymentIntentEventInput {
  intentId: string;
  userId: string;
  status: PaymentIntentStatus;
  payableAmount: number;
  currency: string;
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

export function buildPaymentIntentEventPayload(
  input: PaymentIntentEventInput,
): Record<string, unknown> {
  return {
    intentId: input.intentId,
    userId: input.userId,
    status: input.status,
    payableAmount: input.payableAmount,
    currency: input.currency,
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}

// ─── Charge Events ────────────────────────────────────────────────────────────

export interface ChargeEventInput {
  chargeId: string;
  intentId: string;
  userId: string;
  status: ChargeStatus;
  operation: string;
  amount: number;
  currency: string;
  providerTransactionId?: string;
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

export function buildChargeEventPayload(
  input: ChargeEventInput,
): Record<string, unknown> {
  return {
    chargeId: input.chargeId,
    intentId: input.intentId,
    userId: input.userId,
    status: input.status,
    operation: input.operation,
    amount: input.amount,
    currency: input.currency,
    providerTransactionId: input.providerTransactionId ?? null,
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}

// ─── Refund Events ────────────────────────────────────────────────────────────

export interface RefundEventInput {
  refundId: string;
  chargeId: string;
  intentId: string;
  userId: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

export function buildRefundEventPayload(
  input: RefundEventInput,
): Record<string, unknown> {
  return {
    refundId: input.refundId,
    chargeId: input.chargeId,
    intentId: input.intentId,
    userId: input.userId,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const GATEWAY_AGGREGATE_TYPE = 'PaymentGateway';

export const GatewayEventType = {
  INTENT_CREATED: 'gateway.payment_intent.created',
  INTENT_SUCCEEDED: 'gateway.payment_intent.succeeded',
  INTENT_FAILED: 'gateway.payment_intent.failed',
  INTENT_CANCELED: 'gateway.payment_intent.canceled',
  CHARGE_AUTHORIZED: 'gateway.charge.authorized',
  CHARGE_CAPTURED: 'gateway.charge.captured',
  CHARGE_FAILED: 'gateway.charge.failed',
  CHARGE_CANCELED: 'gateway.charge.canceled',
  REFUND_SUCCEEDED: 'gateway.refund.succeeded',
  REFUND_FAILED: 'gateway.refund.failed',
} as const;

export type GatewayEventType = (typeof GatewayEventType)[keyof typeof GatewayEventType];

function normalizeOccurredAt(occurredAt?: string): string {
  if (!occurredAt) return new Date().toISOString();
  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) {
    throw new Error('GATEWAY_EVENT_PAYLOAD_INVALID: occurredAt must be ISO datetime');
  }
  return new Date(parsed).toISOString();
}
