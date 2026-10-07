import { isFulfillableMatching, isVoidMatching, physicalSkuLinks } from './fulfillable-matching';

describe('fulfillable matching', () => {
  const link = { skuId: 'sku-1', quantity: 2 };

  it.each([
    ['matched + void', { status: 'matched', strategy: 'void', links: [] }, true],
    ['matched + variant + 링크', { status: 'matched', strategy: 'variant', links: [link] }, true],
    ['matched + variant + 링크 0개(숨은 미매칭)', { status: 'matched', strategy: 'variant', links: [] }, false],
    ['matched + variant + links 없음', { status: 'matched', strategy: 'variant' }, false],
    ['pending', { status: 'pending', strategy: null, links: [link] }, false],
    ['ignored', { status: 'ignored', strategy: 'variant', links: [link] }, false],
    ['매칭 없음', null, false],
  ])('%s → %s', (_label, matching, expected) => {
    expect(isFulfillableMatching(matching)).toBe(expected);
  });

  it('void 는 링크 없이도 쓸 수 있고, 물리 링크는 variant 에서만 나온다', () => {
    expect(isVoidMatching({ status: 'matched', strategy: 'void' })).toBe(true);
    expect(physicalSkuLinks({ status: 'matched', strategy: 'void', links: [link] })).toEqual([]);
    expect(physicalSkuLinks({ status: 'matched', strategy: 'variant', links: [link] })).toEqual([link]);
  });
});
