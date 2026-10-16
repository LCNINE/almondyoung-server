import type { ReconcileMode } from '../order-reconcile.types';

/**
 * «core 에 없음» 규칙 (#1016 45번). 관찰 모드로 먼저 배포하고, 거짓 양성 0 을 본 뒤 PR 로 `act` 로 바꾼다.
 * #1016 «관찰 모드 규칙» 절의 grep 이 이 줄을 찾는다 — 모양을 바꾸지 말 것.
 */
export class MissingOrderRule {
  readonly kind = 'missing_order' as const;
  readonly mode: ReconcileMode = 'observe';
}
