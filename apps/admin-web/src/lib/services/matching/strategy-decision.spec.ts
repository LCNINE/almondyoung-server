import {
  getMatchingStrategyDecisionLabel,
  isMatchingStrategyDecisionComplete,
} from './strategy-decision';

describe('matching strategy decision semantics', () => {
  it('counts matched + variant and matched + void as strategy decision complete', () => {
    expect(
      isMatchingStrategyDecisionComplete({
        status: 'matched',
        strategy: 'variant',
        skuLinkCount: 1,
      })
    ).toBe(true);
    expect(
      isMatchingStrategyDecisionComplete({
        status: 'matched',
        strategy: 'variant',
        links: [{ skuId: 'sku_1', quantity: 1 }],
      })
    ).toBe(true);
    expect(
      isMatchingStrategyDecisionComplete({
        status: 'matched',
        strategy: 'void',
      })
    ).toBe(true);
  });

  it('does not count pending or legacy ignored as strategy decision complete', () => {
    expect(
      isMatchingStrategyDecisionComplete({
        status: 'matched',
        strategy: 'variant',
        skuLinkCount: 0,
      })
    ).toBe(false);
    expect(
      isMatchingStrategyDecisionComplete({ status: 'pending', strategy: null })
    ).toBe(false);
    expect(
      isMatchingStrategyDecisionComplete({
        status: 'ignored',
        strategy: 'void',
      })
    ).toBe(false);
  });

  it('uses canonical admin labels for each decision state', () => {
    expect(
      getMatchingStrategyDecisionLabel({
        status: 'matched',
        strategy: 'variant',
        skuLinkCount: 1,
      })
    ).toBe('SKU 구성 매칭');
    expect(
      getMatchingStrategyDecisionLabel({
        status: 'matched',
        strategy: 'variant',
        skuLinkCount: 0,
      })
    ).toBe('SKU 구성 매칭 불완전');
    expect(
      getMatchingStrategyDecisionLabel({ status: 'matched', strategy: 'void' })
    ).toBe('재고상품 비매칭');
    expect(
      getMatchingStrategyDecisionLabel({ status: 'pending', strategy: null })
    ).toBe('전략 미결정');
    expect(
      getMatchingStrategyDecisionLabel({
        status: 'ignored',
        strategy: 'variant',
      })
    ).toBe('레거시 감사 대상');
  });
});
