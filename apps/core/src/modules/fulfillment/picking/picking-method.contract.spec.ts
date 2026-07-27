import { pickingMethodValues } from '../../inventory/schema/enum-values';
import { STRATEGY_BY_PICKING_METHOD, strategyForPickingMethod } from './picking-method.contract';

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
