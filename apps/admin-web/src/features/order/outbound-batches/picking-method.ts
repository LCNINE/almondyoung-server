import type {
  PickingMethod,
  PickingStrategyName,
} from '@/lib/types/dto/fulfillment';

export type { PickingMethod };

/**
 * core 의 picking-method.contract.ts 와 같은 1:1 대응을 프론트에서 복제한 것이다.
 * admin-web 은 core 모듈을 import 할 수 없어 불가피하며, 이는 승인된 설계 결정이다.
 * 값이 바뀌면 양쪽을 함께 고친다.
 */
export const STRATEGY_BY_PICKING_METHOD: Record<PickingMethod, PickingStrategyName> = {
  individual: 'discrete',
  total_picking: 'aggregate_then_sort',
  multi_order: 'pick_to_tote',
};

export const PICKING_METHOD_LABELS: Record<PickingMethod, string> = {
  individual: '개별 피킹',
  total_picking: '토탈 피킹 (합산 후 분류)',
  multi_order: '멀티오더 피킹 (바구니 카트)',
};

/** 창고가 지원하는 전략으로부터 고를 수 있는 방식만 역파생한다. */
export function methodsForStrategies(supported: PickingStrategyName[]): PickingMethod[] {
  return (Object.keys(STRATEGY_BY_PICKING_METHOD) as PickingMethod[]).filter((method) =>
    supported.includes(STRATEGY_BY_PICKING_METHOD[method])
  );
}
