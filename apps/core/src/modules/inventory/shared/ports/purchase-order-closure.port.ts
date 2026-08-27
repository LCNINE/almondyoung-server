import { DbTx } from '../../schema/inventory.schema';

/**
 * 입고 → 조달의 유일한 통로. 계약이 `shared/` 에 있는 이유는 어느 쪽도 상대의 내부를
 * 가리키지 않게 하기 위해서다 (ADR-0032 · #724 항목 7 스펙 §5).
 *
 * **호출 방향과 의존 방향은 다르다.** 호출은 inbound → procurement 로 흐르지만 모듈
 * 의존은 procurement → inbound 한 방향을 유지한다. 입고는 발주 상태값이 무엇인지,
 * 종결 조건이 무엇인지 모른다 — "계획이 닫혔다" 는 사실만 통보한다.
 *
 * 이 저장소에 포트/어댑터 선례가 없다. 직접 UPDATE 대신 이 모양을 고른 결정적 이유는
 * 잠금 취득 지점을 늘리지 않기 위해서다 — PO 행 → 라인 행 불변식을 어기면 ABBA 교착이
 * 40P01 → 500 으로 나간다.
 */
export const PURCHASE_ORDER_CLOSURE = Symbol('PurchaseOrderClosurePort');

export interface PurchaseOrderClosurePort {
  /** 이 발주에 붙은 입고 계획이 닫혔다. 발주를 종결할지는 조달이 판단한다. */
  onPlanClosed(poId: string, tx: DbTx): Promise<void>;
}
