import { pickingMethodValues } from '../../inventory/schema/enum-values';
import {
  isSimpleOutboundSupportedMethod,
  STRATEGY_BY_PICKING_METHOD,
  strategyForPickingMethod,
} from './picking-method.contract';

describe('picking method contract', () => {
  it('maps every picking method to exactly one strategy', () => {
    expect(STRATEGY_BY_PICKING_METHOD).toEqual({
      individual: 'discrete',
      total_picking: 'aggregate_then_sort',
      multi_order: 'pick_to_tote',
    });
  });

  it('covers every enum value declared in the schema', () => {
    for (const method of pickingMethodValues) {
      expect(strategyForPickingMethod(method)).toBeDefined();
    }
    expect(Object.keys(STRATEGY_BY_PICKING_METHOD).sort()).toEqual([...pickingMethodValues].sort());
  });

  it('never maps two methods to the same strategy', () => {
    const strategies = Object.values(STRATEGY_BY_PICKING_METHOD);
    expect(new Set(strategies).size).toBe(strategies.length);
  });
});

describe('simple outbound supported methods', () => {
  it('개별피킹만 단순출고가 감당한다', () => {
    expect(isSimpleOutboundSupportedMethod('individual')).toBe(true);
  });

  it('토탈피킹·멀티오더는 감당하지 못한다', () => {
    expect(isSimpleOutboundSupportedMethod('total_picking')).toBe(false);
    expect(isSimpleOutboundSupportedMethod('multi_order')).toBe(false);
  });

  // 방식 이름이 아니라 전략에 매달려 있어야 한다 — 나중에 discrete 로 매핑되는
  // 방식이 추가되면 단순출고가 자동으로 그것을 받아야 하기 때문이다.
  it('discrete 전략으로 매핑되는 방식만 통과시킨다', () => {
    for (const method of pickingMethodValues) {
      expect(isSimpleOutboundSupportedMethod(method)).toBe(strategyForPickingMethod(method) === 'discrete');
    }
  });
});
