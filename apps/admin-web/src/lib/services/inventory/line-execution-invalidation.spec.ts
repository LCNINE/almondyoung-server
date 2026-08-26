import { inventoryQueryKeys } from './query-keys';
import { lineExecutionInvalidationKeys } from './line-execution-invalidation';

describe('lineExecutionInvalidationKeys', () => {
  const keys = lineExecutionInvalidationKeys('po-1');

  it('발주 쿼리를 루트 키로 무효화한다', () => {
    expect(keys).toContainEqual(inventoryQueryKeys.purchaseOrdersRoot);
  });

  it('꼬리에 undefined 가 달린 키를 쓰지 않는다', () => {
    // ['purchase-orders', undefined] 는 아무것도 무효화하지 못한다. partialMatchKey 는
    // 접두사 일치가 아니라 위치별 비교라 typeof {} !== typeof undefined 에서 걸리고,
    // 목록 쿼리는 항상 필터 객체를 싣는다(query-core 5.90.5 실측).
    expect(keys.some((key) => key.length === 2 && key[1] === undefined)).toBe(false);
  });

  it('입고 쿼리 전체를 무효화한다', () => {
    // 첫 라인 실행이 core ensurePlanForPurchaseOrder 로 입고 계획을 만든다.
    // 입고 키는 전부 ['inbounds', ...] 로 시작하므로 루트 하나로 서브트리를 덮는다.
    expect(keys).toContainEqual(inventoryQueryKeys.inbounds);
  });
});
