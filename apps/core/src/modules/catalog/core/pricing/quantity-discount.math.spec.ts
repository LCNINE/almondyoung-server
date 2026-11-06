import {
  buildSaleTierPrices,
  buildTierPrices,
  discountedPrice,
  floor10,
  quantityDiscountErrorMessage,
  sortTiers,
  validateQuantityDiscount,
} from './quantity-discount.math';

const tier = (minQuantity: number, regularPct: number, membershipPct: number) => ({
  minQuantity,
  regularRateBp: regularPct * 100,
  membershipRateBp: membershipPct * 100,
});

const variant = { variantId: 'v1', basePrice: 10000, membershipPrice: 8000 };

describe('quantity discount math', () => {
  describe('price', () => {
    it('floors to 10 won', () => {
      expect(floor10(13515)).toBe(13510);
      expect(floor10(13510)).toBe(13510);
      expect(floor10(9)).toBe(0);
    });

    it('takes 15% off 15,900 and floors to 13,510', () => {
      expect(discountedPrice(15900, 1500)).toBe(13510);
    });

    it('computes regular tiers from the base price and member tiers from the membership price', () => {
      const result = buildTierPrices({ basePrice: 10000, membershipPrice: 8000, tiers: [tier(3, 5, 10)] });

      expect(result.regular).toEqual([{ minQuantity: 3, price: 9500 }]);
      expect(result.membership).toEqual([{ minQuantity: 3, price: 7200 }]);
    });

    it('returns tiers in ascending minimum quantity', () => {
      const result = buildTierPrices({ basePrice: 10000, membershipPrice: 10000, tiers: [tier(5, 10, 15), tier(3, 5, 10)] });

      expect(result.regular.map((t) => t.minQuantity)).toEqual([3, 5]);
      expect(result.membership.map((t) => t.minQuantity)).toEqual([3, 5]);
    });
  });

  describe('validation', () => {
    const codes = (tiers: ReturnType<typeof tier>[], period = { startsOn: null, endsOn: null } as { startsOn: string | null; endsOn: string | null }) =>
      validateQuantityDiscount({ tiers, ...period }, [variant]).map((v) => v.code);

    it('accepts a valid two-tier table', () => {
      expect(codes([tier(3, 5, 10), tier(5, 10, 15)])).toEqual([]);
    });

    it('rejects a tier where the member price ends up above the regular price, naming the variant and both prices', () => {
      const violations = validateQuantityDiscount(
        { tiers: [tier(3, 20, 5)], startsOn: null, endsOn: null },
        [{ variantId: 'v9', basePrice: 10000, membershipPrice: 9000 }],
      );

      expect(violations).toEqual([
        { code: 'MEMBER_PRICE_ABOVE_REGULAR', tierIndex: 0, variantId: 'v9', regularPrice: 8000, membershipPrice: 8550 },
      ]);
    });

    it('allows the member price to equal the regular price', () => {
      const violations = validateQuantityDiscount(
        { tiers: [tier(3, 10, 10)], startsOn: null, endsOn: null },
        [{ variantId: 'v1', basePrice: 10000, membershipPrice: 10000 }],
      );
      expect(violations).toEqual([]);
    });

    it.each([
      [1, 'MIN_QUANTITY_INVALID'],
      [0, 'MIN_QUANTITY_INVALID'],
      [2.5, 'MIN_QUANTITY_INVALID'],
    ])('rejects minimum quantity %p', (minQuantity, code) => {
      expect(codes([tier(minQuantity, 5, 10)])).toContain(code);
    });

    it('rejects duplicate minimum quantities', () => {
      expect(codes([tier(3, 5, 10), tier(3, 10, 15)])).toContain('MIN_QUANTITY_DUPLICATE');
    });

    it.each([
      [{ minQuantity: 3, regularRateBp: 10000, membershipRateBp: 1000 }],
      [{ minQuantity: 3, regularRateBp: 550, membershipRateBp: 1000 }],
      [{ minQuantity: 3, regularRateBp: 500, membershipRateBp: -100 }],
    ])('rejects a rate outside whole percents from 0 to 99: %p', (t) => {
      expect(codes([t])).toContain('RATE_OUT_OF_RANGE');
    });

    it('rejects more than five tiers', () => {
      const tiers = [2, 3, 4, 5, 6, 7].map((q, i) => tier(q, i + 1, i + 2));
      expect(codes(tiers)).toContain('TOO_MANY_TIERS');
    });

    it('rejects a regular rate that does not strictly increase', () => {
      expect(codes([tier(3, 10, 10), tier(5, 10, 15)])).toContain('RATE_NOT_INCREASING');
    });

    it('rejects a member rate that decreases', () => {
      expect(codes([tier(3, 5, 15), tier(5, 10, 10)])).toContain('RATE_NOT_INCREASING');
    });

    it('judges increase in ascending quantity order even when the input is unsorted', () => {
      expect(codes([tier(5, 10, 15), tier(3, 5, 10)])).toEqual([]);
      expect(sortTiers([tier(5, 10, 15), tier(3, 5, 10)]).map((t) => t.minQuantity)).toEqual([3, 5]);
    });

    it('rejects a period that ends before it starts', () => {
      expect(codes([tier(3, 5, 10)], { startsOn: '2026-11-10', endsOn: '2026-11-09' })).toContain('PERIOD_REVERSED');
    });

    it('accepts a one-day period and open-ended periods', () => {
      expect(codes([tier(3, 5, 10)], { startsOn: '2026-11-10', endsOn: '2026-11-10' })).toEqual([]);
      expect(codes([tier(3, 5, 10)], { startsOn: '2026-11-10', endsOn: null })).toEqual([]);
      expect(codes([tier(3, 5, 10)], { startsOn: null, endsOn: '2026-11-10' })).toEqual([]);
    });

    it.each(['2026-02-30', '2026-13-01', '2026-04-31', '2025-02-29'])('rejects a calendar date that does not exist: %s', (day) => {
      expect(codes([tier(3, 5, 10)], { startsOn: day, endsOn: null })).toContain('PERIOD_INVALID_DATE');
      expect(codes([tier(3, 5, 10)], { startsOn: null, endsOn: day })).toContain('PERIOD_INVALID_DATE');
    });

    it('accepts a leap day', () => {
      expect(codes([tier(3, 5, 10)], { startsOn: '2028-02-29', endsOn: null })).toEqual([]);
    });

    it('rejects an empty table', () => {
      expect(codes([])).toEqual(['EMPTY_TIERS']);
    });
  });
});

describe('quantityDiscountErrorMessage', () => {
  const tiers = [tier(5, 10, 15), tier(3, 30, 10)];

  it('names the tier and both prices when members would pay more', () => {
    expect(
      quantityDiscountErrorMessage(
        [{ code: 'MEMBER_PRICE_ABOVE_REGULAR', tierIndex: 0, variantId: 'v1', regularPrice: 7000, membershipPrice: 7200 }],
        tiers,
      ),
    ).toBe(
      '수량 할인 표와 맞지 않습니다: 3개 이상 구간에서 멤버십 회원가 7,200원이 일반가 7,000원보다 비쌉니다. 멤버십 %를 올리거나 정가·멤버십가를 확인해 주세요.',
    );
  });

  it('shows the first reason and counts the rest', () => {
    expect(
      quantityDiscountErrorMessage(
        [{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }, { code: 'PERIOD_REVERSED' }],
        tiers,
      ),
    ).toBe('수량 할인 표와 맞지 않습니다: 5개 이상 구간의 %가 앞 구간보다 커야 합니다. (외 1건)');
  });
});

describe('one audience only', () => {
  const v = [{ variantId: 'v1', basePrice: 10000, membershipPrice: 9000 }];
  const check = (tiers: ReturnType<typeof tier>[]) =>
    validateQuantityDiscount({ tiers, startsOn: null, endsOn: null }, v).map((x) => x.code);

  it('accepts a members-only table and sells no regular tier price', () => {
    const tiers = [tier(3, 0, 10), tier(6, 0, 20)];
    expect(check(tiers)).toEqual([]);
    expect(buildSaleTierPrices({ basePrice: 10000, membershipPrice: 9000, tiers })).toEqual({
      regular: [],
      membership: [
        { minQuantity: 3, price: 8100 },
        { minQuantity: 6, price: 7200 },
      ],
    });
  });

  it('keeps one preview row per tier so the admin table lines up', () => {
    const result = buildTierPrices({ basePrice: 10000, membershipPrice: 9000, tiers: [tier(3, 0, 10)] });
    expect(result.regular).toEqual([{ minQuantity: 3, price: 10000 }]);
  });

  it('lets one audience start later than the other', () => {
    expect(check([tier(3, 0, 10), tier(6, 5, 20)])).toEqual([]);
  });

  it('rejects a tier where both rates are zero', () => {
    expect(check([tier(3, 0, 0)])).toEqual(['RATE_BOTH_ZERO']);
  });

  it('rejects a zero after a positive rate in the same column', () => {
    expect(check([tier(3, 5, 10), tier(6, 0, 20)])).toEqual(['RATE_NOT_INCREASING']);
  });

  it('still rejects members paying more than everyone else', () => {
    expect(check([tier(3, 20, 0)])).toEqual(['MEMBER_PRICE_ABOVE_REGULAR']);
  });

  it('explains a tier with no rate in plain words', () => {
    expect(quantityDiscountErrorMessage([{ code: 'RATE_BOTH_ZERO', tierIndex: 0 }], [tier(3, 0, 0)])).toBe(
      '수량 할인 표와 맞지 않습니다: 3개 이상 구간은 일반·멤버십 중 하나는 할인율이 있어야 합니다.',
    );
  });
});
