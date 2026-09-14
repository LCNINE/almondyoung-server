import { inventoryQueryKeys } from './query-keys';

/**
 * 라인 실행(발주 기록·불가 종결) 뒤에 다시 읽어야 하는 것들.
 *
 * 발주 쪽은 루트 키(purchaseOrdersRoot) 하나만 쓴다 — `purchaseOrders(filters)` 는
 * 위치별 비교인 partialMatchKey 에서 걸러지지 않고(위 query-keys.ts 주석 참조),
 * 루트가 목록·상세 쿼리를 서브트리로 전부 덮으므로 `purchaseOrder(poId)` 를
 * 따로 무효화하는 건 중복이라 뺐다.
 *
 * 입고 이력과 expected-arrivals 도 함께 갱신한다. 수령·취소·잔량 포기는 발주와
 * 입고 회차, 대기 문서 수를 한 번에 바꿀 수 있다.
 * `id` 는 현재 루트 키만 무효화해 사용하지 않지만 호출부 계약과 이후 발주별 캐시
 * 축소를 위해 유지한다.
 */
export function lineExecutionInvalidationKeys(id: string): readonly (readonly unknown[])[] {
  return [inventoryQueryKeys.purchaseOrdersRoot, inventoryQueryKeys.inbounds, inventoryQueryKeys.expectedArrivalsRoot];
}
