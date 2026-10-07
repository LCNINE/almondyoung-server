import { DbTx } from '../../inventory/schema/inventory.schema';
import { OrderProgressStage } from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 투영에서 고른다.
 * check 는 도메인이 쓰는 판정 함수를 그대로 쓰고, act 는 도메인 함수만 부른다(상태를 직접 쓰지 않는다).
 * 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 투영(order_progress)에서 볼 칸 */
  readonly situation: { stage: OrderProgressStage; states: readonly string[] };
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(salesOrderId: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(salesOrderId: string, tx: DbTx): Promise<boolean>;
  act(salesOrderId: string, tx: DbTx): Promise<void>;
}

export type ReconcileRuleRef = Pick<OrderReconcileRule, 'name' | 'row' | 'situation'>;
