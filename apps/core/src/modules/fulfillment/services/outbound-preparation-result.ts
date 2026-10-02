import type { SimpleOutboundContext } from './simple-outbound.service';

export type PreparationBlockReason =
  | 'SOURCE_STOCK_CHANGED'
  | 'PLAN_IDENTITY_CHANGED'
  | 'PLAN_NOT_DRAFT'
  | 'SHIPMENT_SNAPSHOT_CHANGED'
  | 'ALLOCATION_INVALID'
  | 'ELIGIBILITY_CHANGED'
  | 'SOURCE_INSUFFICIENT'
  | 'ACTIVE_WORK_REQUIRES_REVIEW'
  | 'REPLAN_LIMIT_REACHED'
  | 'BATCH_NOT_STARTED';
export type OutboundPreparationBlocked = {
  outcome: 'preparation_blocked';
  code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED';
  reasonCode: PreparationBlockReason;
  batchId: string;
  invalidatedPlanId: string | null;
  recovery: 'retry_preparation' | 'review_batch';
};
export type OutboundPreparationResult =
  | { outcome: 'ready'; context: SimpleOutboundContext }
  | OutboundPreparationBlocked;
export type PreparedOutboundResult<T> = T | OutboundPreparationBlocked;
const reasons: readonly string[] = [
  'SOURCE_STOCK_CHANGED',
  'PLAN_IDENTITY_CHANGED',
  'PLAN_NOT_DRAFT',
  'SHIPMENT_SNAPSHOT_CHANGED',
  'ALLOCATION_INVALID',
  'ELIGIBILITY_CHANGED',
  'SOURCE_INSUFFICIENT',
  'ACTIVE_WORK_REQUIRES_REVIEW',
  'REPLAN_LIMIT_REACHED',
  'BATCH_NOT_STARTED',
];

export function isPreparationBlocked(value: unknown): value is OutboundPreparationBlocked {
  return (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    value.outcome === 'preparation_blocked' &&
    'code' in value &&
    value.code === 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' &&
    'reasonCode' in value &&
    typeof value.reasonCode === 'string' &&
    reasons.includes(value.reasonCode) &&
    'batchId' in value &&
    typeof value.batchId === 'string' &&
    'invalidatedPlanId' in value &&
    (value.invalidatedPlanId === null || typeof value.invalidatedPlanId === 'string') &&
    'recovery' in value &&
    (value.recovery === 'retry_preparation' || value.recovery === 'review_batch')
  );
}
export function preparationBlocked(
  batchId: string,
  invalidatedPlanId: string | null,
  reasonCode: PreparationBlockReason,
): OutboundPreparationBlocked {
  return {
    outcome: 'preparation_blocked',
    code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
    reasonCode,
    batchId,
    invalidatedPlanId,
    // BATCH_NOT_STARTED 는 배치 카드의 「작업 시작」을 누른 뒤 다시 준비하면 풀린다 — 배치를 들여다볼 일이 아니다.
    recovery:
      reasonCode === 'SOURCE_INSUFFICIENT' ||
      reasonCode === 'REPLAN_LIMIT_REACHED' ||
      reasonCode === 'BATCH_NOT_STARTED'
        ? 'retry_preparation'
        : 'review_batch',
  };
}
