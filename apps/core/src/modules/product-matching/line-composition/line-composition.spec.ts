import {
  blocksFulfillment,
  compositionFromMatching,
  compositionItemsProblem,
  isOutsourcedLine,
  sameComposition,
  isDigitalFulfillmentLine,
  LineForComposition,
  matchingFailureReason,
  resolveLineComposition,
} from './line-composition';

const physical: LineForComposition = {
  id: 'l1',
  fulfillmentKind: null,
  requiresShipping: null,
  compositionSource: null,
  almondDesignId: null,
};
const variant = (links: Array<{ skuId: string; quantity: number }>) => ({
  status: 'matched',
  strategy: 'variant',
  links,
});

describe('resolveLineComposition', () => {
  it('디지털 라인은 매칭을 보지 않고 digital', () => {
    expect(resolveLineComposition({ ...physical, fulfillmentKind: 'digital' }, [], null)).toEqual({ kind: 'digital' });
    expect(resolveLineComposition({ ...physical, requiresShipping: false }, [], null)).toEqual({ kind: 'digital' });
  });

  it('resolves an almond line as outsourced even without matching', () => {
    const line = { ...physical, almondDesignId: 'd1' };
    expect(resolveLineComposition(line, [], null)).toEqual({ kind: 'outsourced' });
    expect(isOutsourcedLine(line)).toBe(true);
    expect(isOutsourcedLine(physical)).toBe(false);
    expect(isOutsourcedLine({})).toBe(false);
  });

  it('굳힌 라인은 상품매칭이 무엇이든 굳힌 구성을 쓴다(SKU 순 정렬)', () => {
    const r = resolveLineComposition(
      { ...physical, compositionSource: 'operator' },
      [
        { skuId: 'b', qtyPerUnit: 1 },
        { skuId: 'a', qtyPerUnit: 2 },
      ],
      { status: 'matched', strategy: 'void', links: [] },
    );
    expect(r).toEqual({
      kind: 'frozen',
      source: 'operator',
      items: [
        { skuId: 'a', qtyPerUnit: 2 },
        { skuId: 'b', qtyPerUnit: 1 },
      ],
    });
  });

  it('출처가 있는데 구성 행이 없으면 불변식 위반으로 던진다', () => {
    expect(() => resolveLineComposition({ ...physical, compositionSource: 'matching' }, [], null)).toThrow(
      /invariant/i,
    );
  });

  it('안 굳힌 라인은 실물 링크가 있으면 follow — 수량 0·누락은 1 로 읽는다(옛 FO 생성과 같다)', () => {
    const r = resolveLineComposition(
      physical,
      [],
      variant([
        { skuId: 's1', quantity: 0 },
        { skuId: 's2', quantity: 3 },
      ]),
    );
    expect(r).toEqual({
      kind: 'follow',
      items: [
        { skuId: 's1', qtyPerUnit: 1 },
        { skuId: 's2', qtyPerUnit: 3 },
      ],
    });
  });

  it('안 굳힌 라인의 void 매칭은 void', () => {
    expect(resolveLineComposition(physical, [], { status: 'matched', strategy: 'void', links: [] })).toEqual({
      kind: 'void',
    });
  });

  it('그 밖은 missing + 사유', () => {
    expect(resolveLineComposition(physical, [], null)).toEqual({ kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' });
    expect(resolveLineComposition(physical, [], variant([]))).toEqual({
      kind: 'missing',
      reason: 'NO_PRODUCT_SKU_MATCHING',
    });
  });
});

describe('matchingFailureReason', () => {
  it('옛 FO 생성의 사유 규칙을 그대로 낸다', () => {
    expect(matchingFailureReason(null)).toBe('NO_PRODUCT_SKU_MATCHING');
    expect(
      matchingFailureReason({ status: 'ignored', strategy: 'variant', links: [{ skuId: 's', quantity: 1 }] }),
    ).toBe('LEGACY_PRODUCT_MATCHING_IGNORED');
    expect(matchingFailureReason({ status: 'pending', strategy: null })).toBe('PRODUCT_MATCHING_UNRESOLVED');
    expect(matchingFailureReason({ status: 'matched', strategy: 'option' })).toBe(
      'PRODUCT_MATCHING_STRATEGY_UNRESOLVED',
    );
    expect(matchingFailureReason({ status: 'matched', strategy: 'variant', links: [] })).toBe(
      'NO_PRODUCT_SKU_MATCHING',
    );
  });
});

describe('isDigitalFulfillmentLine', () => {
  it('null 은 물리로 본다', () => {
    expect(isDigitalFulfillmentLine({ fulfillmentKind: null, requiresShipping: null })).toBe(false);
  });
});

describe('blocksFulfillment', () => {
  it('유효 수량이 남은 missing 만 FO 생성을 막는다', () => {
    const missing = { kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' } as const;
    expect(blocksFulfillment({ fulfillableQuantity: 1, resolution: missing })).toBe(true);
    expect(blocksFulfillment({ fulfillableQuantity: 0, resolution: missing })).toBe(false);
    expect(blocksFulfillment({ fulfillableQuantity: 1, resolution: { kind: 'void' } })).toBe(false);
  });
});

describe('compositionFromMatching', () => {
  it('실물 링크가 있으면 follow(SKU 순, 수량 0 은 1)', () => {
    const matching = variant([
      { skuId: 'b', quantity: 2 },
      { skuId: 'a', quantity: 0 },
    ]);
    expect(compositionFromMatching(matching)).toEqual({
      kind: 'follow',
      items: [
        { skuId: 'a', qtyPerUnit: 1 },
        { skuId: 'b', qtyPerUnit: 2 },
      ],
    });
  });
  it('매칭이 없으면 missing', () => {
    expect(compositionFromMatching(null)).toEqual({ kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' });
  });
});

describe('sameComposition', () => {
  it('순서와 무관하게 같은 (SKU, 1개당 수량) 집합이면 같다', () => {
    expect(
      sameComposition(
        [
          { skuId: 'a', qtyPerUnit: 1 },
          { skuId: 'b', qtyPerUnit: 2 },
        ],
        [
          { skuId: 'b', qtyPerUnit: 2 },
          { skuId: 'a', qtyPerUnit: 1 },
        ],
      ),
    ).toBe(true);
    expect(sameComposition([{ skuId: 'a', qtyPerUnit: 1 }], [{ skuId: 'a', qtyPerUnit: 2 }])).toBe(false);
    expect(sameComposition([{ skuId: 'a', qtyPerUnit: 1 }], [])).toBe(false);
  });
});

describe('compositionItemsProblem', () => {
  it('비었거나 SKU 가 겹치거나 수량이 양의 정수가 아니면 사유를 낸다', () => {
    expect(compositionItemsProblem([])).toMatch(/empty/);
    expect(
      compositionItemsProblem([
        { skuId: 'a', qtyPerUnit: 1 },
        { skuId: 'a', qtyPerUnit: 2 },
      ]),
    ).toMatch(/duplicate/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 0 }])).toMatch(/positive/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 1.5 }])).toMatch(/positive/);
    expect(compositionItemsProblem([{ skuId: 'a', qtyPerUnit: 3 }])).toBeNull();
  });
});
