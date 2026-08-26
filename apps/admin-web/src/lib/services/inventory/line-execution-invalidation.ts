import { inventoryQueryKeys } from './query-keys';

/**
 * 라인 실행(발주 기록·불가 종결) 뒤에 다시 읽어야 하는 것들.
 *
 * 입고 쿼리가 목록에 있는 이유: 라인 실행은 발주만 바꾸는 게 아니다. core 가
 * 첫 실행에서 ensurePlanForPurchaseOrder 로 입고 계획을 만들고, 이후 실행마다
 * 계획 아이템을 붙인다. 발주 키만 무효화하면 입고 대기 화면이 옛 목록을 보여준다.
 */
export function lineExecutionInvalidationKeys(poId: string): readonly (readonly unknown[])[] {
  return [
    inventoryQueryKeys.purchaseOrders(),
    inventoryQueryKeys.purchaseOrder(poId),
    inventoryQueryKeys.inbounds,
  ];
}
