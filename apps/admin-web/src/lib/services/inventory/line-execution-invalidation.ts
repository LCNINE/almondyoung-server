import { inventoryQueryKeys } from './query-keys';

/**
 * 라인 실행(발주 기록·불가 종결) 뒤에 다시 읽어야 하는 것들.
 *
 * 발주 쪽은 루트 키(purchaseOrdersRoot) 하나만 쓴다 — `purchaseOrders(filters)` 는
 * 위치별 비교인 partialMatchKey 에서 걸러지지 않고(위 query-keys.ts 주석 참조),
 * 루트가 목록·상세 쿼리를 서브트리로 전부 덮으므로 `purchaseOrder(poId)` 를
 * 따로 무효화하는 건 중복이라 뺐다.
 *
 * 입고 쿼리가 목록에 있는 이유: 라인 실행은 발주만 바꾸는 게 아니다. core 가
 * 첫 실행에서 ensurePlanForPurchaseOrder 로 입고 계획을 만들고, 이후 실행마다
 * 계획 아이템을 붙인다. 발주 키만 무효화하면 입고 대기 화면이 옛 목록을 보여준다.
 *
 * `id` 파라미터는 지금은 안 쓰지만 시그니처에 남겨둔다 — 호출부가 이미 넘기고
 * 있고, 나중에 발주별로 무효화를 좁혀야 할 때(예: 다른 발주 캐시는 건드리지
 * 않기) 다시 필요해질 수 있다. 이름을 `poId` 가 아니라 `id` 로 둔 이유: 이 함수는
 * 안 쓰는 인자라 호출부마다 실제로 다른 종류의 id 를 넘긴다 — `useCancelPurchaseOrder`
 * 는 poId, `useClosePlanItem`/`useReceiveFromPlan` 은 planId/planItemId 를 넘긴다.
 * 어차피 쓰지 않으므로 어느 쪽을 넘겨도 동작은 같다(최종 전체 리뷰 발견 M3).
 */
export function lineExecutionInvalidationKeys(id: string): readonly (readonly unknown[])[] {
  return [inventoryQueryKeys.purchaseOrdersRoot, inventoryQueryKeys.inbounds];
}
