import { DbTx } from '../../inventory/schema/inventory.schema';
import { OrderProgressStage, OrderProgressStateOf } from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/** 규칙이 볼 투영의 칸. 단계와 그 단계의 세부 상태가 짝으로 타입 검사된다(스펙 §11.3) */
export type OrderReconcileSituation = {
  [S in OrderProgressStage]: { readonly stage: S; readonly states: readonly OrderProgressStateOf<S>[] };
}[OrderProgressStage];

/**
 * 틀(러너·저장소)이 다루는 칸. 세부 상태가 넓은 string 인 것은 통합 스펙이 고유 상태값으로 실데이터와 격리하기
 * 위해서다 — 규칙을 쓰는 계약은 OrderReconcileRule 의 좁은 타입이고 레지스트리는 그것만 받는다.
 */
export type ReconcileSituationRef = { readonly stage: OrderProgressStage; readonly states: readonly string[] };

interface ReconcileRuleBody {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(salesOrderId: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(salesOrderId: string, tx: DbTx): Promise<boolean>;
  act(salesOrderId: string, tx: DbTx): Promise<void>;
}

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4·§11.3). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 투영에서 고르고,
 * 실행 직전에 틀이 지금 판정으로 칸을 다시 확인한다(D12). check 는 도메인이 쓰는 판정 함수를 그대로 쓰고,
 * act 는 도메인 함수만 부른다. 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule extends ReconcileRuleBody {
  readonly situation: OrderReconcileSituation;
}

/** 러너가 받는 모양. OrderReconcileRule 은 그대로 대입된다 */
export interface RunnableReconcileRule extends ReconcileRuleBody {
  readonly situation: ReconcileSituationRef;
}

export type ReconcileRuleRef = Pick<RunnableReconcileRule, 'name' | 'row' | 'situation'>;
