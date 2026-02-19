import type {
  ManualCancelQueueStatus,
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentLegStatus,
  PaymentStateEntityType,
  RefundRequestStatus,
} from '../../schema';

type TransitionRules<TStatus extends string> = Partial<
  Record<TStatus, readonly TStatus[]>
>;

const paymentIntentTransitionRules: TransitionRules<PaymentIntentStatus> = {
  PENDING: ['IN_PROGRESS', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  IN_PROGRESS: [
    'PARTIALLY_CAPTURED',
    'SUCCEEDED',
    'RECONCILING',
    'EXPIRED',
    'CANCELLED',
    'SUSPENDED',
  ],
  PARTIALLY_CAPTURED: [
    'SUCCEEDED',
    'RECONCILING',
    'EXPIRED',
    'CANCELLED',
    'SUSPENDED',
  ],
  SUSPENDED: ['SUPERSEDED', 'SUPERSEDED_RECONCILE_REQUIRED'],
  RECONCILING: ['FAILED', 'EXPIRED', 'CANCELLED', 'RECONCILE_REQUIRED'],
  RECONCILE_REQUIRED: ['FAILED', 'EXPIRED', 'CANCELLED'],
  SUPERSEDED_RECONCILE_REQUIRED: ['SUPERSEDED'],
};

const paymentLegTransitionRules: TransitionRules<PaymentLegStatus> = {
  PLANNED: ['READY'],
  READY: ['PROCESSING', 'EXPIRED'],
  PROCESSING: [
    'AUTHORIZED',
    'REQUIRES_CUSTOMER_ACTION',
    'REQUIRES_ADMIN_CONFIRMATION',
    'FAILED',
    'EXPIRED',
  ],
  REQUIRES_CUSTOMER_ACTION: ['FAILED', 'EXPIRED'],
  REQUIRES_ADMIN_CONFIRMATION: ['FAILED', 'EXPIRED'],
  AUTHORIZED: ['CAPTURED', 'CANCELING', 'EXPIRED'],
  CAPTURED: ['CANCELING', 'REFUNDING'],
  CANCELING: ['CANCELLED', 'REFUNDED', 'RECONCILE_REQUIRED'],
  REFUNDING: ['REFUNDED', 'RECONCILE_REQUIRED'],
  RECONCILE_REQUIRED: ['CANCELLED', 'REFUNDED'],
};

const paymentAttemptTransitionRules: TransitionRules<PaymentAttemptStatus> = {
  CREATED: ['SENT'],
  SENT: [
    'PENDING_PROVIDER',
    'REQUIRES_ACTION',
    'AUTHORIZED',
    'CAPTURED',
    'CANCEL_REQUESTED',
    'REFUND_REQUESTED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'UNKNOWN',
  ],
  PENDING_PROVIDER: [
    'REQUIRES_ACTION',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'UNKNOWN',
  ],
  REQUIRES_ACTION: [
    'PENDING_PROVIDER',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'UNKNOWN',
  ],
  AUTHORIZED: ['CAPTURED', 'CANCEL_REQUESTED', 'FAILED_FINAL', 'UNKNOWN'],
  CAPTURED: ['REFUND_REQUESTED', 'REFUNDED', 'RECONCILE_REQUIRED', 'UNKNOWN'],
  FAILED_RETRYABLE: ['CREATED', 'FAILED_FINAL', 'RECONCILE_REQUIRED'],
  CANCEL_REQUESTED: [
    'CANCELLED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'RECONCILE_REQUIRED',
    'UNKNOWN',
  ],
  REFUND_REQUESTED: [
    'REFUNDED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'RECONCILE_REQUIRED',
    'UNKNOWN',
  ],
  UNKNOWN: [
    'PENDING_PROVIDER',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED_FINAL',
    'CANCELLED',
    'REFUNDED',
    'RECONCILE_REQUIRED',
  ],
};

const refundRequestTransitionRules: TransitionRules<RefundRequestStatus> = {
  REQUESTED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'RECONCILE_REQUIRED'],
  PARTIALLY_COMPLETED: ['PROCESSING', 'COMPLETED', 'FAILED', 'RECONCILE_REQUIRED'],
};

const manualCancelQueueTransitionRules: TransitionRules<ManualCancelQueueStatus> = {
  QUEUED: ['ASSIGNED', 'PROCESSING', 'CLOSED'],
  ASSIGNED: ['PROCESSING', 'CLOSED'],
  PROCESSING: ['COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
  FAILED_RETRYABLE: ['ASSIGNED', 'PROCESSING', 'CLOSED'],
  FAILED_FINAL: ['CLOSED'],
};

type EntityTransitionRules = {
  INTENT: TransitionRules<PaymentIntentStatus>;
  LEG: TransitionRules<PaymentLegStatus>;
  ATTEMPT: TransitionRules<PaymentAttemptStatus>;
  REFUND_REQUEST: TransitionRules<RefundRequestStatus>;
  MANUAL_CANCEL_QUEUE_ITEM: TransitionRules<ManualCancelQueueStatus>;
};

export const STATE_TRANSITION_RULES: EntityTransitionRules = {
  INTENT: paymentIntentTransitionRules,
  LEG: paymentLegTransitionRules,
  ATTEMPT: paymentAttemptTransitionRules,
  REFUND_REQUEST: refundRequestTransitionRules,
  MANUAL_CANCEL_QUEUE_ITEM: manualCancelQueueTransitionRules,
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
