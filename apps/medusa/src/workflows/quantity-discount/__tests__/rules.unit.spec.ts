import { listTitle, periodKey, planQuantityDiscountSync, type CurrentTierPrice, type QuantityDiscountListRow } from '../rules';

const ctx = { regionIds: ['reg_kr'], membershipGroupId: 'cusgroup_m' };
const always = { starts_at: null, ends_at: null };

const row = (audience: 'general' | 'membership', min_quantity: number, price_list_id: string, period_key = 'always'): QuantityDiscountListRow => ({
  audience,
  min_quantity,
  period_key,
  price_list_id,
});

describe('quantity discount rules', () => {
  describe('periodKey', () => {
    it('is always for a table without a period', () => {
      expect(periodKey(null)).toBe('always');
      expect(periodKey(always)).toBe('always');
    });

    it('uses KST dates and marks an open side', () => {
      expect(periodKey({ starts_at: '2026-11-09T15:00:00.000Z', ends_at: '2026-11-12T14:59:59.999Z' })).toBe('20261110-20261112');
      expect(periodKey({ starts_at: '2026-11-09T15:00:00.000Z', ends_at: null })).toBe('20261110-open');
      expect(periodKey({ starts_at: null, ends_at: '2026-11-12T14:59:59.999Z' })).toBe('open-20261112');
    });
  });

  it('names lists for people, with the period only when there is one', () => {
    expect(listTitle('general', 3, 'always')).toBe('Tiered Prices - Min 3');
    expect(listTitle('membership', 3, '20261110-20261112')).toBe('Member Tiered Prices - Min 3 - 20261110-20261112');
  });

  it('creates a general and a member list for a new table and puts the prices in them', () => {
    const plan = planQuantityDiscountSync({
      input: {
        period: { starts_at: '2026-11-09T15:00:00.000Z', ends_at: null },
        general: [{ variant_id: 'v1', min_quantity: 3, amount: 9500 }],
        membership: [{ variant_id: 'v1', min_quantity: 3, amount: 7200 }],
      },
      rows: [],
      adoptable: {},
      listStates: {},
      current: [],
      ...ctx,
    });

    expect(plan.listsToCreate).toEqual([
      expect.objectContaining({
        key: 'general:3:20261110-open',
        row: { audience: 'general', min_quantity: 3, period_key: '20261110-open', starts_at: '2026-11-09T15:00:00.000Z', ends_at: null },
        data: expect.objectContaining({
          title: 'Tiered Prices - Min 3 - 20261110-open',
          type: 'sale',
          status: 'active',
          starts_at: '2026-11-09T15:00:00.000Z',
          rules: { region_id: ['reg_kr'] },
        }),
      }),
      expect.objectContaining({
        key: 'membership:3:20261110-open',
        data: expect.objectContaining({ rules: { 'customer.groups.id': ['cusgroup_m'] } }),
      }),
    ]);
    expect(plan.listsToCreate[0].data).not.toHaveProperty('ends_at');
    expect(plan.pricesToCreate).toEqual([
      { key: 'general:3:20261110-open', variant_id: 'v1', min_quantity: 3, amount: 9500 },
      { key: 'membership:3:20261110-open', variant_id: 'v1', min_quantity: 3, amount: 7200 },
    ]);
    expect(plan.priceIdsToDelete).toEqual([]);
  });

  it('writes nothing when the prices are already there', () => {
    const current: CurrentTierPrice[] = [
      { id: 'p1', price_list_id: 'pl_g3', variant_id: 'v1', min_quantity: 3, amount: 9500 },
      { id: 'p2', price_list_id: 'pl_m3', variant_id: 'v1', min_quantity: 3, amount: 7200 },
    ];

    const plan = planQuantityDiscountSync({
      input: {
        period: null,
        general: [{ variant_id: 'v1', min_quantity: 3, amount: 9500 }],
        membership: [{ variant_id: 'v1', min_quantity: 3, amount: 7200 }],
      },
      rows: [row('general', 3, 'pl_g3'), row('membership', 3, 'pl_m3')],
      adoptable: {},
      listStates: {
        pl_g3: { status: 'active', starts_at: null, ends_at: null, rules: { region_id: ['reg_kr'] } },
        pl_m3: { status: 'active', starts_at: null, ends_at: null, rules: { 'customer.groups.id': ['cusgroup_m'] } },
      },
      current,
      ...ctx,
    });

    expect(plan).toMatchObject({ listsToCreate: [], adopt: [], listUpdates: [], pricesToCreate: [], priceIdsToDelete: [] });
    expect(plan.resultListIds.sort()).toEqual(['pl_g3', 'pl_m3']);
  });

  it('replaces a changed price and leaves the unchanged one alone', () => {
    const plan = planQuantityDiscountSync({
      input: {
        period: null,
        general: [
          { variant_id: 'v1', min_quantity: 3, amount: 9000 },
          { variant_id: 'v2', min_quantity: 3, amount: 9500 },
        ],
        membership: [],
      },
      rows: [row('general', 3, 'pl_g3')],
      adoptable: {},
      listStates: {},
      current: [
        { id: 'p1', price_list_id: 'pl_g3', variant_id: 'v1', min_quantity: 3, amount: 9500 },
        { id: 'p2', price_list_id: 'pl_g3', variant_id: 'v2', min_quantity: 3, amount: 9500 },
      ],
      ...ctx,
    });

    expect(plan.pricesToCreate).toEqual([{ key: 'general:3:always', variant_id: 'v1', min_quantity: 3, amount: 9000 }]);
    expect(plan.priceIdsToDelete).toEqual(['p1']);
  });

  it('takes every tier price out when the table is gone', () => {
    const plan = planQuantityDiscountSync({
      input: { period: null, general: [], membership: [] },
      rows: [row('general', 3, 'pl_g3'), row('membership', 3, 'pl_m3')],
      adoptable: {},
      listStates: {},
      current: [
        { id: 'p1', price_list_id: 'pl_g3', variant_id: 'v1', min_quantity: 3, amount: 9500 },
        { id: 'p2', price_list_id: 'pl_m3', variant_id: 'v1', min_quantity: 3, amount: 7200 },
      ],
      ...ctx,
    });

    expect(plan.priceIdsToDelete.sort()).toEqual(['p1', 'p2']);
    expect(plan.pricesToCreate).toEqual([]);
    expect(plan.resultListIds).toEqual([]);
  });

  it('moves prices to the new period lists when the period changes', () => {
    const plan = planQuantityDiscountSync({
      input: {
        period: { starts_at: '2026-11-09T15:00:00.000Z', ends_at: '2026-11-12T14:59:59.999Z' },
        general: [{ variant_id: 'v1', min_quantity: 3, amount: 9500 }],
        membership: [],
      },
      rows: [row('general', 3, 'pl_g3')],
      adoptable: {},
      listStates: {},
      current: [{ id: 'p1', price_list_id: 'pl_g3', variant_id: 'v1', min_quantity: 3, amount: 9500 }],
      ...ctx,
    });

    expect(plan.listsToCreate.map((l) => l.key)).toEqual(['general:3:20261110-20261112']);
    expect(plan.priceIdsToDelete).toEqual(['p1']);
  });

  it('adopts an existing unlinked always-on general list with the exact title instead of making a duplicate', () => {
    const plan = planQuantityDiscountSync({
      input: { period: null, general: [{ variant_id: 'v1', min_quantity: 2, amount: 13510 }], membership: [] },
      rows: [],
      adoptable: { 'Tiered Prices - Min 2': ['pl_legacy2'], 'Tiered Prices - Min 20': ['pl_legacy20'] },
      listStates: { pl_legacy2: { status: 'active', starts_at: null, ends_at: null, rules: { region_id: ['reg_kr'] } } },
      current: [{ id: 'p_old', price_list_id: 'pl_legacy2', variant_id: 'v1', min_quantity: 2, amount: 13000 }],
      ...ctx,
    });

    expect(plan.listsToCreate).toEqual([]);
    expect(plan.adopt).toEqual([
      { key: 'general:2:always', price_list_id: 'pl_legacy2', row: expect.objectContaining({ audience: 'general', min_quantity: 2, period_key: 'always' }) },
    ]);
    expect(plan.pricesToCreate).toEqual([{ key: 'general:2:always', variant_id: 'v1', min_quantity: 2, amount: 13510 }]);
    expect(plan.priceIdsToDelete).toEqual(['p_old']);
    expect(plan.knownListIdByKey).toEqual({ 'general:2:always': 'pl_legacy2' });
  });

  it('drops an adoptable legacy list price even when the product no longer has that tier', () => {
    const plan = planQuantityDiscountSync({
      input: { period: null, general: [{ variant_id: 'v1', min_quantity: 2, amount: 13510 }], membership: [] },
      rows: [],
      adoptable: { 'Tiered Prices - Min 2': ['pl_legacy2'], 'Tiered Prices - Min 3': ['pl_legacy3'] },
      listStates: { pl_legacy2: { status: 'active', starts_at: null, ends_at: null, rules: { region_id: ['reg_kr'] } } },
      current: [
        { id: 'p2', price_list_id: 'pl_legacy2', variant_id: 'v1', min_quantity: 2, amount: 13000 },
        { id: 'p3', price_list_id: 'pl_legacy3', variant_id: 'v1', min_quantity: 3, amount: 26000 },
      ],
      ...ctx,
    });

    expect(plan.priceIdsToDelete.sort()).toEqual(['p2', 'p3']);
  });

  describe('keeping the lists it uses in the shape the price engine needs', () => {
    const okState = { status: 'active', starts_at: null, ends_at: null, rules: { region_id: ['reg_kr'] } };
    const one = { period: null, general: [{ variant_id: 'v1', min_quantity: 3, amount: 9500 }], membership: [] };

    it('brings an existing list back to every current region', () => {
      const plan = planQuantityDiscountSync({
        input: one,
        rows: [row('general', 3, 'pl_g3')],
        adoptable: {},
        listStates: { pl_g3: okState },
        current: [],
        regionIds: ['reg_kr', 'reg_jp'],
        membershipGroupId: 'cusgroup_m',
      });

      expect(plan.listUpdates).toEqual([
        { id: 'pl_g3', status: 'active', starts_at: null, ends_at: null, rules: { region_id: ['reg_kr', 'reg_jp'] } },
      ]);
    });

    it('reactivates a list someone switched to draft', () => {
      const plan = planQuantityDiscountSync({
        input: one,
        rows: [row('general', 3, 'pl_g3')],
        adoptable: {},
        listStates: { pl_g3: { ...okState, status: 'draft' } },
        current: [],
        ...ctx,
      });

      expect(plan.listUpdates).toEqual([expect.objectContaining({ id: 'pl_g3', status: 'active' })]);
    });

    it('gives an adopted legacy list without rules the region rule, so it ties with the membership list', () => {
      const plan = planQuantityDiscountSync({
        input: one,
        rows: [],
        adoptable: { 'Tiered Prices - Min 3': ['pl_legacy3'] },
        listStates: { pl_legacy3: { ...okState, rules: {} } },
        current: [],
        ...ctx,
      });

      expect(plan.adopt.map((a) => a.price_list_id)).toEqual(['pl_legacy3']);
      expect(plan.listUpdates).toEqual([expect.objectContaining({ id: 'pl_legacy3', rules: { region_id: ['reg_kr'] } })]);
    });

    it('treats region order as the same rule', () => {
      const plan = planQuantityDiscountSync({
        input: one,
        rows: [row('general', 3, 'pl_g3')],
        adoptable: {},
        listStates: { pl_g3: { ...okState, rules: { region_id: ['reg_b', 'reg_a'] } } },
        current: [],
        regionIds: ['reg_a', 'reg_b'],
        membershipGroupId: 'cusgroup_m',
      });

      expect(plan.listUpdates).toEqual([]);
    });

    it('does not pick one of several legacy lists with the same title, and clears the product from all of them', () => {
      const plan = planQuantityDiscountSync({
        input: one,
        rows: [],
        adoptable: { 'Tiered Prices - Min 3': ['pl_dup_a', 'pl_dup_b'] },
        listStates: {},
        current: [
          { id: 'pa', price_list_id: 'pl_dup_a', variant_id: 'v1', min_quantity: 3, amount: 9500 },
          { id: 'pb', price_list_id: 'pl_dup_b', variant_id: 'v1', min_quantity: 3, amount: 9500 },
        ],
        ...ctx,
      });

      expect(plan.adopt).toEqual([]);
      expect(plan.listsToCreate.map((l) => l.key)).toEqual(['general:3:always']);
      expect(plan.priceIdsToDelete.sort()).toEqual(['pa', 'pb']);
    });
  });

  it('refuses member tiers without the membership group', () => {
    expect(() =>
      planQuantityDiscountSync({
        input: { period: null, general: [], membership: [{ variant_id: 'v1', min_quantity: 3, amount: 7200 }] },
        rows: [],
        adoptable: {},
      listStates: {},
        current: [],
        regionIds: ['reg_kr'],
        membershipGroupId: '',
      }),
    ).toThrow('MEDUSA_MEMBERSHIP_GROUP_ID');
  });
});
