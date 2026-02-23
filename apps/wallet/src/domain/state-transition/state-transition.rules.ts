import type {
  ChargeStatus,
  PaymentIntentStatus,
  PaymentStateEntityType,
  RefundStatus,
} from '../../schema';

type TransitionRules<TStatus extends string> = Partial<
  Record<TStatus, readonly TStatus[]>
>;

// Intent state machine:
// CREATED → PROCESSING → SUCCEEDED (terminal)
//                      → FAILED (terminal)
//                      → REQUIRES_ACTION → PROCESSING
//                      → CREATED (back-transition on confirm failure)
//                      → CANCELED (terminal)
// CREATED → CANCELED
const paymentIntentTransitionRules: TransitionRules<PaymentIntentStatus> = {
  CREATED: ['PROCESSING', 'CANCELED'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'REQUIRES_ACTION', 'CREATED', 'CANCELED'],
  REQUIRES_ACTION: ['PROCESSING', 'FAILED', 'CANCELED'],
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

export function canTransition(
  entityType: PaymentStateEntityType,
  fromStatus: string,
  toStatus: string,
): boolean {
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
    throw new Error(
      `STATE_TRANSITION_NOT_ALLOWED: ${entityType} ${fromStatus} -> ${toStatus}`,
    );
  }
}
