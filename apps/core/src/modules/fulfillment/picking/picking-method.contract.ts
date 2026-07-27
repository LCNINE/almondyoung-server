import type { PickingMethodEnum } from '../../inventory/schema/enum-values';
import type { PickingStrategyName } from './picking-strategy.interface';

/**
 * 배치의 피킹 "방식"(현장 용어)과 코드 "전략"의 1:1 대응. 두 축이 어긋나는 것을
 * 막는 단일 출처다 — plan 은 전략을 고르지 않고 이 맵으로 배치 방식에서 파생한다.
 *
 * `satisfies Record<PickingMethodEnum, ...>` 가 핵심이다. picking_method enum 에
 * 값이 추가되면 이 맵을 갱신하지 않는 한 컴파일이 깨진다.
 */
export const STRATEGY_BY_PICKING_METHOD = {
  individual: 'discrete',
  total_picking: 'aggregate_then_sort',
  multi_order: 'pick_to_tote',
} as const satisfies Record<PickingMethodEnum, PickingStrategyName>;

export function strategyForPickingMethod(method: PickingMethodEnum): PickingStrategyName {
  return STRATEGY_BY_PICKING_METHOD[method];
}
