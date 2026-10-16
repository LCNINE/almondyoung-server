import type { ReconcileMode } from '../order-reconcile.types';

/** «취소 미반영» 규칙 (#1016 45번). 전환은 `MissingOrderRule` 과 따로 한다. */
export class CancelNotAppliedRule {
  readonly kind = 'cancel_not_applied' as const;
  readonly mode: ReconcileMode = 'observe';
}
