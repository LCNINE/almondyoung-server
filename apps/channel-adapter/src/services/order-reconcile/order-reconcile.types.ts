/** 채널 대사(#1016 45번)의 어휘. 값은 `order_reconcile_findings` 의 varchar 칸에 그대로 들어간다. */
export type FindingKind = 'missing_order' | 'cancel_not_applied';
export type FindingHandling = 'auto' | 'human';
export type HumanReason = 'out_of_window' | 'core_status' | 'event_failure_open' | 'attempts_exhausted';
export type ReconcileMode = 'observe' | 'act';
export type FindingStatus = 'open' | 'resolved' | 'closed';
