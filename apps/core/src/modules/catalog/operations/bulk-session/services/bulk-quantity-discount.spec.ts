import {
  canonicalQuantityDiscount,
  formatQuantityDiscount,
  parseCanonicalQuantityDiscount,
  quantityDiscountPrefillRows,
  readQuantityDiscountRows,
} from './bulk-quantity-discount';

const base = (cells: Record<string, string> = {}) => ({ combination: '', ...cells });
const option = (combination: string, cells: Record<string, string> = {}) => ({
  combination,
  combinationLabel: `색상=${combination}`,
  ...cells,
});
const tier = (minQuantity: number, regular: number, membership: number) => ({
  minQuantity,
  regularRateBp: regular * 100,
  membershipRateBp: membership * 100,
});

describe('readQuantityDiscountRows', () => {
  it('reads the default row in quantity order and treats a blank 사용 as Y', () => {
    const result = readQuantityDiscountRows([
      base({
        tier1MinQuantity: '5',
        tier1RegularRate: '10',
        tier1MembershipRate: '15',
        tier2MinQuantity: '2',
        tier2RegularRate: '5',
        tier2MembershipRate: '10',
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.input).toEqual({
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [tier(2, 5, 10), tier(5, 10, 15)],
      variantOverrides: [],
    });
  });

  it('skips a tier whose three cells are empty, accepts a percent sign and reads a blank rate as no discount', () => {
    const result = readQuantityDiscountRows([
      base({ enabled: 'N', startsOn: '2026-12-01', endsOn: '2026-12-31', tier2MinQuantity: '3', tier2MembershipRate: '7%' }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.input).toEqual({
      enabled: false,
      startsOn: '2026-12-01',
      endsOn: '2026-12-31',
      tiers: [tier(3, 0, 7)],
      variantOverrides: [],
    });
  });

  it('reads option rows as overrides, an option row without tiers meaning no discount', () => {
    const result = readQuantityDiscountRows([
      base({ tier1MinQuantity: '3', tier1RegularRate: '10', tier1MembershipRate: '15' }),
      option('ov-red'),
      option('ov-blue', { tier1MinQuantity: '3', tier1RegularRate: '5', tier1MembershipRate: '6' }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.input?.variantOverrides).toEqual([
      { combination: 'ov-red', tiers: [] },
      { combination: 'ov-blue', tiers: [tier(3, 5, 6)] },
    ]);
  });

  it('accepts overrides without a default row', () => {
    const result = readQuantityDiscountRows([option('ov-red', { tier1MinQuantity: '3', tier1RegularRate: '5', tier1MembershipRate: '6' })]);

    expect(result.errors).toEqual([]);
    expect(result.input).toMatchObject({ enabled: true, tiers: [], variantOverrides: [{ combination: 'ov-red', tiers: [tier(3, 5, 6)] }] });
  });

  it('returns no table when no row has a tier', () => {
    expect(readQuantityDiscountRows([base({ enabled: 'Y', startsOn: '2026-12-01' }), option('ov-red')])).toEqual({
      input: null,
      errors: [],
    });
  });

  it('rejects a tier with a quantity but no rate, or rates without a quantity', () => {
    expect(readQuantityDiscountRows([base({ tier2MinQuantity: '3' })]).errors).toEqual([
      '구간2: 일반%·멤버십% 중 하나는 넣어 주세요.',
    ]);
    expect(readQuantityDiscountRows([base({ tier1RegularRate: '5' })]).errors).toEqual(['구간1: 수량이 비었습니다.']);
  });

  it('rejects non-integer cells, bad 사용 and bad dates', () => {
    const { errors } = readQuantityDiscountRows([
      base({ enabled: 'yes', startsOn: '2026-02-30', tier1MinQuantity: '2.5', tier1RegularRate: '5', tier1MembershipRate: '10' }),
    ]);
    expect(errors).toEqual([
      '사용은 Y 또는 N 이어야 합니다: yes',
      '시작일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다: 2026-02-30',
      '구간1수량은 정수여야 합니다: 2.5',
    ]);
  });

  it('keeps 사용 and dates on the default row only', () => {
    const { errors } = readQuantityDiscountRows([option('ov-red', { enabled: 'N', startsOn: '2026-12-01' })]);
    expect(errors).toEqual(['색상=ov-red: 사용·시작일·종료일은 조합이 빈 행에만 넣습니다.']);
  });

  it('rejects two default rows, the same option twice and an option the product does not have', () => {
    const known = new Set(['ov-red']);
    const { errors } = readQuantityDiscountRows([base(), base(), option('ov-red'), option('ov-red'), option('ov-gone')], known);
    expect(errors).toEqual([
      '조합이 빈 행(기본 구간)은 상품당 한 행만 쓸 수 있습니다.',
      '색상=ov-red: 같은 조합이 두 번 있습니다.',
      '색상=ov-gone: 조합 시트에 없는 조합입니다. 조합 시트의 «조합» 값을 그대로 붙여 넣어 주세요.',
    ]);
  });

  it('reports table rules in the admin screen words, with the option name for an override', () => {
    const { errors } = readQuantityDiscountRows([
      base({ tier1MinQuantity: '3', tier1RegularRate: '0', tier1MembershipRate: '0' }),
      option('ov-red', {
        tier1MinQuantity: '3',
        tier1RegularRate: '10',
        tier1MembershipRate: '15',
        tier2MinQuantity: '5',
        tier2RegularRate: '5',
        tier2MembershipRate: '20',
      }),
    ]);
    expect(errors).toEqual([
      '3개 이상 구간은 일반·멤버십 중 하나는 할인율이 있어야 합니다.',
      '색상=ov-red: 5개 이상 구간의 %가 앞 구간보다 커야 합니다.',
    ]);
  });
});

describe('canonical quantity discount', () => {
  it('is empty when no row has a tier, whatever 사용, dates or no-discount options say', () => {
    expect(canonicalQuantityDiscount([base({ enabled: 'N', startsOn: '2026-12-01' }), option('ov-red')])).toBe('');
    expect(canonicalQuantityDiscount([])).toBe('');
  });

  it('ignores tier order, blank slots, blank 사용, percent signs, blank rates and option row order', () => {
    const a = canonicalQuantityDiscount([
      base({ tier3MinQuantity: '5', tier3RegularRate: '10%', tier3MembershipRate: '15', tier1MinQuantity: '2', tier1MembershipRate: '10' }),
      option('ov-red'),
      option('ov-blue', { tier1MinQuantity: '3', tier1RegularRate: '5', tier1MembershipRate: '6' }),
    ]);
    const b = canonicalQuantityDiscount([
      option('ov-blue', { combinationLabel: '바뀐 이름', tier2MinQuantity: '3', tier2RegularRate: '5', tier2MembershipRate: '6%' }),
      base({ enabled: 'Y', tier1MinQuantity: '2', tier1RegularRate: '0', tier1MembershipRate: '10', tier2MinQuantity: '5', tier2RegularRate: '10', tier2MembershipRate: '15' }),
      option('ov-red'),
    ]);
    expect(a).toBe(b);
    expect(a).toBe('Y|||2:0:10,5:10:15|ov-blue=3:5:6;ov-red=');
  });

  it('keeps a worker-chosen key with separators intact', () => {
    const canonical = canonicalQuantityDiscount([option('color=red;x|y', { tier1MinQuantity: '3', tier1RegularRate: '5', tier1MembershipRate: '6' })]);
    expect(parseCanonicalQuantityDiscount(canonical)?.variantOverrides).toEqual([{ combination: 'color=red;x|y', tiers: [tier(3, 5, 6)] }]);
    expect(formatQuantityDiscount(canonical, (c) => (c === 'color=red;x|y' ? '빨강' : undefined))).toContain('빨강 3개 이상 5%/6%');
  });

  it('round-trips through the parser', () => {
    const canonical = canonicalQuantityDiscount([
      base({ enabled: 'N', endsOn: '2026-12-31' }),
      option('ov-red', { tier1MinQuantity: '4', tier1RegularRate: '5', tier1MembershipRate: '6' }),
      option('ov-blue'),
    ]);
    expect(parseCanonicalQuantityDiscount(canonical)).toEqual({
      enabled: false,
      startsOn: null,
      endsOn: '2026-12-31',
      tiers: [],
      variantOverrides: [
        { combination: 'ov-blue', tiers: [] },
        { combination: 'ov-red', tiers: [tier(4, 5, 6)] },
      ],
    });
    expect(parseCanonicalQuantityDiscount('')).toBeNull();
  });
});

describe('quantity discount prefill', () => {
  it('writes the default row and one row per override that read back to the same canonical value', () => {
    const saved = {
      enabled: true,
      startsOn: '2026-12-01',
      endsOn: null,
      tiers: [tier(5, 10, 15), tier(2, 0, 10)],
      variantOverrides: [
        { combination: 'ov-red', tiers: [] },
        { combination: 'ov-blue', tiers: [tier(3, 5, 6)] },
      ],
    };
    const rows = quantityDiscountPrefillRows(
      saved,
      new Map([
        ['ov-red', '색상=빨강'],
        ['ov-blue', ''],
      ]),
    );

    expect(rows.map((r) => [r.combination, r.combinationLabel, r.enabled])).toEqual([
      ['', '', 'Y'],
      ['ov-red', '색상=빨강', ''],
      ['ov-blue', '', ''],
    ]);
    expect(rows[0].tier1MinQuantity).toBe('2');
    expect(rows[0].tier1RegularRate).toBe('0');
    expect(parseCanonicalQuantityDiscount(canonicalQuantityDiscount(rows))).toEqual({
      ...saved,
      tiers: [tier(2, 0, 10), tier(5, 10, 15)],
      variantOverrides: [saved.variantOverrides[1], saved.variantOverrides[0]],
    });
  });

  it('leaves out overrides for options this version no longer has', () => {
    const rows = quantityDiscountPrefillRows(
      { enabled: true, startsOn: null, endsOn: null, tiers: [tier(3, 5, 10)], variantOverrides: [{ combination: 'ov-gone', tiers: [] }] },
      new Map([['ov-red', '색상=빨강']]),
    );
    expect(rows.map((r) => r.combination)).toEqual(['']);
  });

  it('leaves one empty default row for a product without a table', () => {
    const rows = quantityDiscountPrefillRows(null, new Map());
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0]).every((v) => v === '')).toBe(true);
    expect(canonicalQuantityDiscount(rows)).toBe('');
  });
});

describe('formatQuantityDiscount', () => {
  it('reads like the admin panel, naming options', () => {
    const canonical = 'Y|2026-12-01||3:5:10,5:0:15|ov-blue=3:5:6;ov-red=';
    const names = new Map([
      ['ov-red', '빨강'],
      ['ov-blue', '파랑'],
    ]);
    expect(formatQuantityDiscount(canonical, (c) => names.get(c))).toBe(
      '사용 · 2026-12-01부터 · 기본 3개 이상 5%/10%, 5개 이상 할인 없음/15% · 파랑 3개 이상 5%/6% · 빨강 할인 없음',
    );
  });

  it('says there is no default discount and falls back to a generic option name', () => {
    expect(formatQuantityDiscount('N|||' + '|ov-x=2:1:2', () => undefined)).toBe(
      '사용 안 함 · 상시 · 기본 할인 없음 · 옵션 2개 이상 1%/2%',
    );
    expect(formatQuantityDiscount('', () => undefined)).toBe('(없음)');
  });
});
