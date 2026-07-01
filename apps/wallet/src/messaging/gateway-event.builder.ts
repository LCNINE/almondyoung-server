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

export function buildPaymentIntentEventPayload(input: PaymentIntentEventInput): Record<string, unknown> {
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

export function buildChargeEventPayload(input: ChargeEventInput): Record<string, unknown> {
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

export function buildRefundEventPayload(input: RefundEventInput): Record<string, unknown> {
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

/**
 * intent.metadata 에 저장된 구독자 라우팅 정보(subscriberRef/subscriberType/purpose)를 이벤트 payload 의
 * extra 로 뽑아낸다. 정기결제 청구 intent 는 이 값을 metadata 에 담고 있으며, membership 컨슈머는 이 필드로만
 * 계약을 라우팅한다. 성공/실패(cms-settlement-poller)뿐 아니라 취소/만료 경로도 동일하게 실어야 membership 이
 * billingInProgress 선점을 해제할 수 있다(Finding 2). 구독과 무관한 intent 는 값이 undefined 로 무해하다.
 */
export function subscriberExtraFromMetadata(metadata: unknown): Record<string, unknown> {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return {
    subscriberRef: m.subscriberRef as string | undefined,
    subscriberType: m.subscriberType as string | undefined,
    purpose: m.purpose as string | undefined,
  };
}

export const GATEWAY_AGGREGATE_TYPE = 'PaymentGateway';

export const GatewayEventType = {
  INTENT_CREATED: 'payment.intent.created',
  INTENT_AUTHORIZED: 'payment.intent.authorized',
  INTENT_SUCCEEDED: 'payment.intent.succeeded', // legacy: kept for backward compat
  INTENT_FAILED: 'payment.intent.failed',
  INTENT_CANCELED: 'payment.intent.canceled',
  INTENT_CAPTURED: 'payment.intent.captured',
  // 무통장입금 입금 대기 진입 — Medusa 가 주문을 '입금확인중' 으로 선생성하도록 트리거.
  INTENT_AWAITING_DEPOSIT: 'payment.intent.awaiting_deposit',
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
