import { DbTx } from '../../inventory/schema/inventory.schema';
import {
  OrderProgressStage,
  OrderProgressStateOf,
  ShipmentStage,
  ShipmentStateOf,
} from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/** 재판정 대상의 종류(스펙 D14). 끝난 주문은 주문 종류의 다른 칸이다(D19, 29번이 연다) */
export type ReconcileSubject = 'order' | 'shipment';

/** 규칙이 볼 투영의 칸. 단계와 그 단계의 세부 상태가 짝으로 타입 검사된다(스펙 §11.3) */
export type OrderReconcileSituation = {
  [S in OrderProgressStage]: { readonly stage: S; readonly states: readonly OrderProgressStateOf<S>[] };
}[OrderProgressStage];

/** 상자 규칙이 볼 상자별 판정의 칸(스펙 §11.3·§11.5) */
export type ShipmentReconcileSituation = {
  [S in ShipmentStage]: { readonly stage: S; readonly states: readonly ShipmentStateOf<S>[] };
}[ShipmentStage];

/**
 * 틀(러너·저장소)이 다루는 칸. 세부 상태가 넓은 string 인 것은 통합 스펙이 고유 상태값으로 실데이터와 격리하기
 * 위해서다 — 규칙을 쓰는 계약은 OrderReconcileRule·ShipmentReconcileRule 의 좁은 타입이고 레지스트리는 그것만 받는다.
 */
export type ReconcileSituationRef = { readonly stage: OrderProgressStage; readonly states: readonly string[] };

/** act 의 결과. 'noop' = 할 일이 없었다(사람이 먼저 처리했거나 CAS 에서 짐) — not_needed 로 기록되고 횟수를 올리지 않는다(D13) */
export type ReconcileActResult = 'acted' | 'noop';

/** id 는 대상 종류에 따라 판매주문 id 또는 상자(shipment) id 다 */
interface ReconcileRuleBody {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(id: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(id: string, tx: DbTx): Promise<boolean>;
  act(id: string, tx: DbTx): Promise<ReconcileActResult>;
}

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4·§11.3). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 판정에서 고르고,
 * 실행 직전에 틀이 지금 판정으로 칸을 다시 확인한다(D12). check 는 도메인이 쓰는 판정 함수를 그대로 쓰고,
 * act 는 도메인 함수만 부른다. 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule extends ReconcileRuleBody {
  readonly subject: 'order';
  readonly situation: OrderReconcileSituation;
}

/**
 * 상자 규칙. 후보는 틀이 상자별 판정에서 고르고, 상자에 라인이 있는 주문 중 하나라도 채널 취소 요청·외부 출고·반품·교환이면
 * 틀이 뺀다(D16). 시도 기록은 shipment_reconcile_state 에 남는다(D17).
 */
export interface ShipmentReconcileRule extends ReconcileRuleBody {
  readonly subject: 'shipment';
  readonly situation: ShipmentReconcileSituation;
}

export type ReconcileRule = OrderReconcileRule | ShipmentReconcileRule;

/** 러너가 받는 모양. ReconcileRule 은 그대로 대입된다 */
export interface RunnableReconcileRule extends ReconcileRuleBody {
  readonly subject: ReconcileSubject;
  readonly situation: ReconcileSituationRef;
}

export type ReconcileRuleRef = Pick<RunnableReconcileRule, 'name' | 'row' | 'situation'>;
