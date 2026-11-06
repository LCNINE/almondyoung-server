import { CustomError } from '@/lib/api/customError';
import {
  buildTierPrices,
  combinationOf,
  emptyQuantityDiscountForm,
  formFromResponse,
  formToPayload,
  overrideProblems,
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
      overrides: [],
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
      overrides: [],
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
      variantOverrides: [],
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

describe('option overrides in the form', () => {
  const tierBp = (minQuantity: number, regular: number, membership: number) => ({
    minQuantity,
    regularRateBp: regular * 100,
    membershipRateBp: membership * 100,
  });

  it('builds the combination key from option value ids in sorted order', () => {
    expect(combinationOf(['ov-size-l', 'ov-color-red'])).toBe('ov-color-red+ov-size-l');
    expect(combinationOf([])).toBe('');
  });

  it('groups saved overrides that share a table into one card', () => {
    const read = formFromResponse({
      id: 't1',
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [tierBp(3, 10, 15)],
      variantOverrides: [
        { combination: 'ov-red', tiers: [tierBp(3, 5, 6)] },
        { combination: 'ov-blue', tiers: [] },
        { combination: 'ov-pink', tiers: [tierBp(3, 5, 6)] },
      ],
    });
    expect(read.overrides.map(({ combinations, mode, tiers }) => ({ combinations, mode, tiers }))).toEqual([
      { combinations: ['ov-red', 'ov-pink'], mode: 'tiers', tiers: [row('3', '5', '6')] },
      { combinations: ['ov-blue'], mode: 'none', tiers: [] },
    ]);
    expect(new Set(read.overrides.map((o) => o.key)).size).toBe(2);
  });

  it('spreads each card into one override per option', () => {
    const payload = formToPayload(
      form({
        overrides: [
          { key: 'a', combinations: ['ov-red', 'ov-pink'], mode: 'tiers', tiers: [row('6', '7', '8'), row('3', '5', '6')] },
          { key: 'b', combinations: ['ov-blue'], mode: 'none', tiers: [row('3', '1', '1')] },
        ],
      }),
    );
    expect(payload.variantOverrides).toEqual([
      { combination: 'ov-red', tiers: [tierBp(3, 5, 6), tierBp(6, 7, 8)] },
      { combination: 'ov-pink', tiers: [tierBp(3, 5, 6), tierBp(6, 7, 8)] },
      { combination: 'ov-blue', tiers: [] },
    ]);
  });

  it('round-trips a saved table with overrides', () => {
    const saved = {
      id: 't1',
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [],
      variantOverrides: [{ combination: 'ov-red', tiers: [tierBp(3, 10, 15)] }],
    };
    const { id, ...rest } = saved;
    expect(id).toBe('t1');
    expect(formToPayload(formFromResponse(saved))).toEqual(rest);
  });

  it('points out a card with no option and a card with no tier', () => {
    const problems = overrideProblems(
      form({
        overrides: [
          { key: 'a', combinations: [], mode: 'none', tiers: [] },
          { key: 'b', combinations: ['ov-red'], mode: 'tiers', tiers: [] },
          { key: 'c', combinations: ['ov-blue'], mode: 'none', tiers: [] },
        ],
      }),
    );
    expect(problems).toEqual([
      { key: 'a', message: '이 예외를 적용할 옵션을 하나 이상 골라 주세요.' },
      { key: 'b', message: '구간을 넣거나 «할인 없음»을 골라 주세요.' },
    ]);
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
      'RATE_BOTH_ZERO',
      'RATE_NOT_INCREASING',
      'OVERRIDE_DUPLICATE',
      'MEMBER_PRICE_ABOVE_REGULAR',
      'PERIOD_REVERSED',
      'PERIOD_INVALID_DATE',
    ] as const;
    for (const code of codes) {
      expect(violationMessage({ code })).not.toBe('');
    }
  });

  it('reads violations from the error the API client throws for a 400', () => {
    const body = { message: '수량 할인 표와 맞지 않습니다: …', errors: [{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }] };
    const error = new CustomError({ message: body.message, statusCode: 400, response: body });
    expect(serverViolations(error)).toEqual([{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }]);
  });

  it('returns no violations for other errors', () => {
    expect(serverViolations(new Error('network'))).toEqual([]);
    expect(serverViolations(new CustomError({ message: 'Only draft versions', statusCode: 400, response: { message: 'Only draft versions' } }))).toEqual([]);
    expect(serverViolations(new CustomError({ message: 'x', statusCode: 400, response: { errors: [{ path: ['x'] }] } }))).toEqual([]);
  });
});
