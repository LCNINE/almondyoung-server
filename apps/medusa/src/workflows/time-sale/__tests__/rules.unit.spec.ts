import {
  buildPriceListData,
  findConflictingSales,
  planTimeSaleUpdate,
  validateTimeSaleInput,
  type LinkedList,
  type TimeSaleWriteInput,
} from '../rules';

const base: TimeSaleWriteInput = {
  title: '가을 세일',
  starts_at: '2030-01-01T00:00:00.000Z',
  ends_at: '2030-01-08T00:00:00.000Z',
  status: 'active',
  general_prices: [
    { variant_id: 'v1', amount: 900 },
    { variant_id: 'v2', amount: 800 },
  ],
  membership_prices: [{ variant_id: 'v1', amount: 700 }],
};

describe('validateTimeSaleInput', () => {
  it('passes a well-formed input', () => {
    expect(validateTimeSaleInput(base)).toEqual([]);
  });

  it('rejects empty title, inverted period and empty general prices', () => {
    const errors = validateTimeSaleInput({
      ...base,
      title: '  ',
      ends_at: base.starts_at,
      general_prices: [],
      membership_prices: [],
    });
    expect(errors).toHaveLength(3);
  });

  it('rejects non-positive and non-finite amounts', () => {
    const errors = validateTimeSaleInput({
      ...base,
      general_prices: [
        { variant_id: 'v1', amount: 0 },
        { variant_id: 'v2', amount: Number.NaN },
      ],
      membership_prices: [],
    });
    expect(errors).toHaveLength(2);
  });

  it('rejects duplicate variant within one audience', () => {
    const errors = validateTimeSaleInput({
      ...base,
      general_prices: [...base.general_prices, { variant_id: 'v1', amount: 850 }],
    });
    expect(errors.some((e) => e.includes('v1'))).toBe(true);
  });

  it('allows the same variant once in general and once in membership', () => {
    expect(validateTimeSaleInput(base)).toEqual([]);
  });

  it('rejects membership variant missing from general prices', () => {
    const errors = validateTimeSaleInput({
      ...base,
      membership_prices: [{ variant_id: 'v9', amount: 100 }],
    });
    expect(errors.some((e) => e.includes('v9'))).toBe(true);
  });
});

describe('findConflictingSales', () => {
  const other = {
    id: 'tsale_b',
    title: 'B',
    starts_at: '2030-01-05T00:00:00.000Z',
    ends_at: '2030-01-10T00:00:00.000Z',
    status: 'active' as const,
    variantIds: ['v2', 'v3'],
  };
  const candidate = {
    starts_at: base.starts_at,
    ends_at: base.ends_at,
    status: 'active' as const,
    variantIds: ['v1', 'v2'],
  };

  it('reports overlapping active sales sharing a variant', () => {
    expect(findConflictingSales(candidate, [other])).toEqual([{ id: 'tsale_b', title: 'B', variantIds: ['v2'] }]);
  });

  it('ignores sales whose period does not overlap', () => {
    expect(
      findConflictingSales(candidate, [{ ...other, starts_at: base.ends_at, ends_at: '2030-02-01T00:00:00.000Z' }]),
    ).toEqual([]);
  });

  it('ignores draft sales on either side', () => {
    expect(findConflictingSales(candidate, [{ ...other, status: 'draft' }])).toEqual([]);
    expect(findConflictingSales({ ...candidate, status: 'draft' }, [other])).toEqual([]);
  });

  it('ignores itself', () => {
    expect(findConflictingSales({ ...candidate, id: 'tsale_b' }, [other])).toEqual([]);
  });
});

describe('buildPriceListData', () => {
  it('builds a general list with a region rule', () => {
    const data = buildPriceListData({
      title: '가을 세일',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      status: 'draft',
      audience: 'general',
      prices: base.general_prices,
      regionIds: ['reg_1'],
      membershipGroupId: 'cusgroup_1',
    });
    expect(data).toEqual({
      title: '가을 세일',
      description: '타임세일 (전체)',
      type: 'sale',
      status: 'draft',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      rules: { region_id: ['reg_1'] },
      prices: [
        { variant_id: 'v1', amount: 900, currency_code: 'krw' },
        { variant_id: 'v2', amount: 800, currency_code: 'krw' },
      ],
    });
  });

  it('builds a membership list with a customer group rule', () => {
    const data = buildPriceListData({
      title: '가을 세일',
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      status: 'active',
      audience: 'membership',
      prices: base.membership_prices,
      regionIds: ['reg_1'],
      membershipGroupId: 'cusgroup_1',
    });
    expect(data.rules).toEqual({ 'customer.groups.id': ['cusgroup_1'] });
    expect(data.description).toBe('타임세일 (멤버십 구독자)');
  });
});

describe('planTimeSaleUpdate', () => {
  // 현재 DB: 일반 v1=950·v2=850, 멤버십 v1=750 — base(900·800 / 700) 와 전부 다르다.
  const lists: LinkedList[] = [
    {
      id: 'plist_g',
      isMembership: false,
      prices: [
        { id: 'p1', variant_id: 'v1', amount: 950 },
        { id: 'p2', variant_id: 'v2', amount: 850 },
      ],
    },
    { id: 'plist_m', isMembership: true, prices: [{ id: 'p3', variant_id: 'v1', amount: 750 }] },
  ];
  // base 와 같은 가격을 이미 가진 리스트.
  const unchanged: LinkedList[] = [
    {
      id: 'plist_g',
      isMembership: false,
      prices: [
        { id: 'p1', variant_id: 'v2', amount: 800 },
        { id: 'p2', variant_id: 'v1', amount: 900 },
      ],
    },
    { id: 'plist_m', isMembership: true, prices: [{ id: 'p3', variant_id: 'v1', amount: 700 }] },
  ];
  const ctx = { regionIds: ['reg_1'], membershipGroupId: 'cusgroup_1' };

  it('replaces every existing price and updates both lists', () => {
    const plan = planTimeSaleUpdate({ input: base, lists, ...ctx });
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(plan.pricesToCreate).toEqual([
      {
        id: 'plist_g',
        prices: [
          { variant_id: 'v1', amount: 900, currency_code: 'krw' },
          { variant_id: 'v2', amount: 800, currency_code: 'krw' },
        ],
      },
      { id: 'plist_m', prices: [{ variant_id: 'v1', amount: 700, currency_code: 'krw' }] },
    ]);
    expect(plan.listUpdates.map((u) => u.id).sort()).toEqual(['plist_g', 'plist_m']);
    expect(plan.listsToCreate).toEqual([]);
    expect(plan.listIdsToDelete).toEqual([]);
  });

  it('deletes the membership list when membership prices become empty', () => {
    const plan = planTimeSaleUpdate({ input: { ...base, membership_prices: [] }, lists, ...ctx });
    expect(plan.listIdsToDelete).toEqual(['plist_m']);
    expect(plan.pricesToCreate.map((p) => p.id)).toEqual(['plist_g']);
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
    expect(plan.listUpdates.map((u) => u.id)).toEqual(['plist_g']);
  });

  it('creates a membership list when one did not exist', () => {
    const plan = planTimeSaleUpdate({ input: base, lists: [lists[0]], ...ctx });
    expect(plan.listsToCreate).toHaveLength(1);
    expect(plan.listsToCreate[0].rules).toEqual({ 'customer.groups.id': ['cusgroup_1'] });
    expect(plan.pricesToCreate.map((p) => p.id)).toEqual(['plist_g']);
  });

  it('touches no prices when every list already has the same variant→amount set (status-only change)', () => {
    const plan = planTimeSaleUpdate({ input: { ...base, status: 'draft' }, lists: unchanged, ...ctx });
    expect(plan.pricesToCreate).toEqual([]);
    expect(plan.priceIdsToDelete).toEqual([]);
    expect(plan.listUpdates).toEqual([
      { id: 'plist_g', title: base.title, starts_at: base.starts_at, ends_at: base.ends_at, status: 'draft' },
      { id: 'plist_m', title: base.title, starts_at: base.starts_at, ends_at: base.ends_at, status: 'draft' },
    ]);
  });

  it('replaces the whole list when a single amount changes', () => {
    const input = {
      ...base,
      general_prices: [
        { variant_id: 'v1', amount: 900 },
        { variant_id: 'v2', amount: 790 },
      ],
    };
    const plan = planTimeSaleUpdate({ input, lists: unchanged, ...ctx });
    expect(plan.pricesToCreate).toEqual([
      {
        id: 'plist_g',
        prices: [
          { variant_id: 'v1', amount: 900, currency_code: 'krw' },
          { variant_id: 'v2', amount: 790, currency_code: 'krw' },
        ],
      },
    ]);
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
  });

  it('replaces only the general list when membership prices are unchanged', () => {
    const input = { ...base, general_prices: [...base.general_prices, { variant_id: 'v3', amount: 600 }] };
    const plan = planTimeSaleUpdate({ input, lists: unchanged, ...ctx });
    expect(plan.pricesToCreate.map((p) => p.id)).toEqual(['plist_g']);
    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
    expect(plan.listUpdates.map((u) => u.id)).toEqual(['plist_g', 'plist_m']);
  });

  it('replaces a list whose rows are duplicated or unlinked even if amounts match', () => {
    const accumulated: LinkedList[] = [
      {
        id: 'plist_g',
        isMembership: false,
        prices: [
          { id: 'p1', variant_id: 'v1', amount: 900 },
          { id: 'p1b', variant_id: 'v1', amount: 900 },
        ],
      },
    ];
    const one = {
      ...base,
      general_prices: [
        { variant_id: 'v1', amount: 900 },
        { variant_id: 'v2', amount: 800 },
      ],
      membership_prices: [],
    };
    expect(planTimeSaleUpdate({ input: one, lists: accumulated, ...ctx }).priceIdsToDelete.sort()).toEqual([
      'p1',
      'p1b',
    ]);

    const unlinked: LinkedList[] = [
      {
        id: 'plist_g',
        isMembership: false,
        prices: [
          { id: 'p1', variant_id: 'v1', amount: 900 },
          { id: 'p2', variant_id: null, amount: 800 },
        ],
      },
    ];
    expect(planTimeSaleUpdate({ input: one, lists: unlinked, ...ctx }).priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
  });

  it('throws when the general list is missing (broken invariant)', () => {
    expect(() => planTimeSaleUpdate({ input: base, lists: [lists[1]], ...ctx })).toThrow();
  });
});
