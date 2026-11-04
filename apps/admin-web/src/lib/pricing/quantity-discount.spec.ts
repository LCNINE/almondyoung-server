import {
  buildTierPrices,
  emptyQuantityDiscountForm,
  formFromResponse,
  formToPayload,
  serverViolations,
  validateQuantityDiscount,
  violationMessage,
  type QuantityDiscountForm,
} from './quantity-discount';

const row = (minQuantity: string, regularPercent: string, membershipPercent: string) => ({
  minQuantity,
  regularPercent,
  membershipPercent,
});

const form = (overrides: Partial<QuantityDiscountForm> = {}): QuantityDiscountForm => ({
  ...emptyQuantityDiscountForm(),
  tiers: [row('3', '5', '10')],
  ...overrides,
});

describe('quantity discount form', () => {
  it('starts enabled, always-on, with no tiers', () => {
    expect(emptyQuantityDiscountForm()).toEqual({
      enabled: true,
      periodMode: 'always',
      startsOn: '',
      endsOn: '',
      tiers: [],
    });
  });

  it('reads a saved table into percent strings and a period', () => {
    expect(
      formFromResponse({
        id: 't1',
        enabled: false,
        startsOn: '2026-12-01',
        endsOn: null,
        tiers: [{ minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 }],
      }),
    ).toEqual({
      enabled: false,
      periodMode: 'period',
      startsOn: '2026-12-01',
      endsOn: '',
      tiers: [row('3', '5', '10')],
    });
  });

  it('builds the request in basis points sorted by minimum quantity', () => {
    expect(formToPayload(form({ tiers: [row('5', '10', '15'), row('3', '5', '10')] }))).toEqual({
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [
        { minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 },
        { minQuantity: 5, regularRateBp: 1000, membershipRateBp: 1500 },
      ],
    });
  });

  it('drops the dates when the period mode is always', () => {
    const payload = formToPayload(form({ periodMode: 'always', startsOn: '2026-12-01', endsOn: '2026-12-31' }));
    expect(payload.startsOn).toBeNull();
    expect(payload.endsOn).toBeNull();
  });

  it('keeps one open end of a period', () => {
    const payload = formToPayload(form({ periodMode: 'period', startsOn: '', endsOn: '2026-12-31' }));
    expect(payload.startsOn).toBeNull();
    expect(payload.endsOn).toBe('2026-12-31');
  });

  it('turns blank or non-numeric cells into values the validator rejects', () => {
    const payload = formToPayload(form({ tiers: [row('', 'abc', '10')] }));
    expect(validateQuantityDiscount(payload, []).map((v) => v.code)).toEqual(
      expect.arrayContaining(['MIN_QUANTITY_INVALID', 'RATE_OUT_OF_RANGE']),
    );
  });
});

describe('quantity discount preview', () => {
  it('prices 10,000 / 8,000 with 5% and 10% at 3 or more', () => {
    expect(
      buildTierPrices({
        basePrice: 10000,
        membershipPrice: 8000,
        tiers: [{ minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 }],
      }),
    ).toEqual({ regular: [{ minQuantity: 3, price: 9500 }], membership: [{ minQuantity: 3, price: 7200 }] });
  });

  it('rounds each unit price down to 10 won', () => {
    const { regular } = buildTierPrices({
      basePrice: 15900,
      membershipPrice: 15900,
      tiers: [{ minQuantity: 2, regularRateBp: 1500, membershipRateBp: 1500 }],
    });
    expect(regular[0].price).toBe(13510);
  });

  it('flags the option and tier where members would pay more than everyone else', () => {
    const violations = validateQuantityDiscount(
      { startsOn: null, endsOn: null, tiers: [{ minQuantity: 3, regularRateBp: 2000, membershipRateBp: 500 }] },
      [{ variantId: 'v1', basePrice: 10000, membershipPrice: 9000 }],
    );
    expect(violations).toEqual([
      { code: 'MEMBER_PRICE_ABOVE_REGULAR', tierIndex: 0, variantId: 'v1', regularPrice: 8000, membershipPrice: 8550 },
    ]);
  });
});

describe('violation messages', () => {
  it('names the option and both prices for a member price above the regular price', () => {
    expect(
      violationMessage(
        { code: 'MEMBER_PRICE_ABOVE_REGULAR', tierIndex: 0, variantId: 'v1', regularPrice: 8000, membershipPrice: 8550 },
        '빨강',
      ),
    ).toBe('빨강: 멤버십 회원가 8,550원이 일반가 8,000원보다 비쌉니다. 멤버십 %를 올려 주세요.');
  });

  it('has a message for every code', () => {
    const codes = [
      'EMPTY_TIERS',
      'TOO_MANY_TIERS',
      'MIN_QUANTITY_INVALID',
      'MIN_QUANTITY_DUPLICATE',
      'RATE_OUT_OF_RANGE',
      'RATE_NOT_INCREASING',
      'MEMBER_PRICE_ABOVE_REGULAR',
      'PERIOD_REVERSED',
      'PERIOD_INVALID_DATE',
    ] as const;
    for (const code of codes) {
      expect(violationMessage({ code })).not.toBe('');
    }
  });

  it('reads violations from a 400 response body', () => {
    const error = {
      response: {
        status: 400,
        data: { message: 'Invalid quantity discount table', errors: [{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }] },
      },
    };
    expect(serverViolations(error)).toEqual([{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }]);
  });

  it('returns no violations for other errors', () => {
    expect(serverViolations(new Error('network'))).toEqual([]);
    expect(serverViolations({ response: { status: 400, data: { message: 'Only draft versions' } } })).toEqual([]);
    expect(serverViolations({ response: { status: 400, data: { errors: [{ path: ['x'] }] } } })).toEqual([]);
  });
});
