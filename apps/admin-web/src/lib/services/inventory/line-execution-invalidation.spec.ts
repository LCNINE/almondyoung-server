import { inventoryQueryKeys } from './query-keys';
import { lineExecutionInvalidationKeys } from './line-execution-invalidation';

describe('lineExecutionInvalidationKeys', () => {
  const keys = lineExecutionInvalidationKeys('po-1');

  it('발주 목록과 해당 발주 상세를 무효화한다', () => {
    expect(keys).toContainEqual(inventoryQueryKeys.purchaseOrders());
    expect(keys).toContainEqual(inventoryQueryKeys.purchaseOrder('po-1'));
  });

  it('입고 쿼리 전체를 무효화한다', () => {
    // 첫 라인 실행이 core ensurePlanForPurchaseOrder 로 입고 계획을 만든다.
    // 발주 쿼리만 무효화하면 입고 대기 목록이 방금 생긴 계획을 못 본다.
    // 입고 키는 전부 ['inbounds', ...] 로 시작하므로 루트 하나로 서브트리를 덮는다.
    expect(keys).toContainEqual(inventoryQueryKeys.inbounds);
  });
});
