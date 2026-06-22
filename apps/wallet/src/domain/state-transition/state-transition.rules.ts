import type { ChargeStatus, PaymentIntentStatus, PaymentStateEntityType, RefundStatus } from '../../schema';

type TransitionRules<TStatus extends string> = Partial<Record<TStatus, readonly TStatus[]>>;

// Intent state machine:
// CREATED → PROCESSING → AUTHORIZED (terminal-ish: capture pending)
//                      → FAILED (terminal)
//                      → REQUIRES_ACTION → PROCESSING
//                                        → AUTHORIZED (terminal-ish, e.g. Toss confirm)
//                                        → CREATED (back-transition on confirm failure)
//                      → AWAITING_DEPOSIT → AUTHORIZED (admin 입금확인) | CANCELED (만료/취소) | FAILED
//                      → PENDING_SETTLEMENT (CMS batch: awaiting async result)
//                      → CREATED (back-transition on confirm failure)
//                      → CANCELED (terminal)
// PENDING_SETTLEMENT → AUTHORIZED (poll: withdrawal succeeded)
//                    → FAILED (poll: withdrawal failed)
//                    → CANCELED (admin/system cancel)
// AUTHORIZED → CAPTURED (terminal) | PARTIALLY_CAPTURED | CANCELED (terminal)
// PARTIALLY_CAPTURED → CAPTURED (admin resolve) | CANCELED (admin cancel)
// SUCCEEDED → CAPTURED | CANCELED  (backward compat: legacy data)
// CREATED → CANCELED | FAILED (stuck intent 강제 종료)
const paymentIntentTransitionRules: TransitionRules<PaymentIntentStatus> = {
  CREATED: ['PROCESSING', 'FAILED', 'CANCELED'],
  PROCESSING: ['AUTHORIZED', 'FAILED', 'REQUIRES_ACTION', 'AWAITING_DEPOSIT', 'PENDING_SETTLEMENT', 'CREATED', 'CANCELED'],
  REQUIRES_ACTION: ['PROCESSING', 'AUTHORIZED', 'FAILED', 'CREATED', 'CANCELED'],
  AWAITING_DEPOSIT: ['AUTHORIZED', 'CANCELED', 'FAILED'],
  PENDING_SETTLEMENT: ['AUTHORIZED', 'FAILED', 'CANCELED'],
  AUTHORIZED: ['CAPTURED', 'PARTIALLY_CAPTURED', 'CANCELED'],
  PARTIALLY_CAPTURED: ['CAPTURED', 'CANCELED'],
  SUCCEEDED: ['CAPTURED', 'CANCELED'], // backward compat: existing SUCCEEDED records
};

// Charge state machine:
// CREATED → PENDING | SUCCEEDED | FAILED | CANCELED | REQUIRES_ACTION
// PENDING → SUCCEEDED | FAILED | CANCELED | REQUIRES_ACTION
// REQUIRES_ACTION → PENDING | SUCCEEDED | FAILED | CANCELED
// SUCCEEDED → REFUNDED (terminal after refund)
const chargeTransitionRules: TransitionRules<ChargeStatus> = {
  CREATED: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REQUIRES_ACTION'],
  PENDING: ['SUCCEEDED', 'FAILED', 'CANCELED', 'REQUIRES_ACTION'],
  REQUIRES_ACTION: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'],
  SUCCEEDED: ['REFUNDED'],
};

// Refund state machine:
// PENDING → SUCCEEDED | FAILED
// FAILED → PENDING (retry)
const refundTransitionRules: TransitionRules<RefundStatus> = {
  PENDING: ['SUCCEEDED', 'FAILED'],
  FAILED: ['PENDING'],
};

type EntityTransitionRules = {
  INTENT: TransitionRules<PaymentIntentStatus>;
  CHARGE: TransitionRules<ChargeStatus>;
  REFUND: TransitionRules<RefundStatus>;
};

export const STATE_TRANSITION_RULES: EntityTransitionRules = {
  INTENT: paymentIntentTransitionRules,
  CHARGE: chargeTransitionRules,
  REFUND: refundTransitionRules,
};

export function canTransition(entityType: PaymentStateEntityType, fromStatus: string, toStatus: string): boolean {
  const entityRules = STATE_TRANSITION_RULES[entityType] as TransitionRules<string>;
  const allowedNext = entityRules[fromStatus] ?? [];
  return allowedNext.includes(toStatus);
}

export function assertTransitionAllowed(
  entityType: PaymentStateEntityType,
  fromStatus: string,
  toStatus: string,
): void {
  if (!canTransition(entityType, fromStatus, toStatus)) {
    throw new Error(`STATE_TRANSITION_NOT_ALLOWED: ${entityType} ${fromStatus} -> ${toStatus}`);
  }
}
