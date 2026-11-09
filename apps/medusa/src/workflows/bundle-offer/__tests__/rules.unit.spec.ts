import { isStaleBundleOfferSync, planBundleOfferSync, type AddonProduct, type BundleOfferSyncItem } from '../rules';

const item = (addon: string, over: Partial<BundleOfferSyncItem> = {}): BundleOfferSyncItem => ({
  addon_pim_master_id: addon,
  allowed_pim_variant_ids: null,
  regular_rate_bp: 1000,
  membership_rate_bp: 1500,
  enabled: true,
  starts_at: null,
  ends_at: null,
  label: null,
  sort: 0,
  ...over,
});

const addon = (handle: string, id: string, variants: Array<[string, string]>): AddonProduct => ({
  id,
  handle,
  variants: variants.map(([vid, pim]) => ({ id: vid, pim_variant_id: pim })),
});

describe('planBundleOfferSync', () => {
  const addons = new Map([
    ['master-b', addon('master-b', 'prod_b', [['var_b1', 'pim-b1'], ['var_b2', 'pim-b2']])],
    ['master-c', addon('master-c', 'prod_c', [['var_c1', 'pim-c1']])],
  ]);

  it('turns PIM ids into store ids and keeps the given order', () => {
    const plan = planBundleOfferSync('prod_a', [item('master-c', { sort: 0 }), item('master-b', { sort: 1, allowed_pim_variant_ids: ['pim-b2'] })], addons);

    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toEqual([
      expect.objectContaining({ product_id: 'prod_a', addon_product_id: 'prod_c', addon_pim_master_id: 'master-c', allowed_variant_ids: null, sort: 0 }),
      expect.objectContaining({ product_id: 'prod_a', addon_product_id: 'prod_b', allowed_variant_ids: ['var_b2'], sort: 1 }),
    ]);
  });

  it('carries rates, switch, period and label as given', () => {
    const [row] = planBundleOfferSync(
      'prod_a',
      [item('master-b', { regular_rate_bp: 0, membership_rate_bp: 500, enabled: false, starts_at: '2026-05-31T15:00:00.000Z', ends_at: null, label: '같이 쓰면 좋아요' })],
      addons,
    ).rows;
    expect(row).toMatchObject({
      regular_rate_bp: 0,
      membership_rate_bp: 500,
      enabled: false,
      starts_at: new Date('2026-05-31T15:00:00.000Z'),
      ends_at: null,
      label: '같이 쓰면 좋아요',
    });
  });

  it('skips an add-on that is not in the store, the product itself, and an allow-list with no option left in the store', () => {
    const self = new Map([...addons, ['master-a', addon('master-a', 'prod_a', [['var_a1', 'pim-a1']])]]);
    const plan = planBundleOfferSync(
      'prod_a',
      [item('missing'), item('master-a'), item('master-b', { allowed_pim_variant_ids: ['pim-gone'] }), item('master-c')],
      self,
    );
    expect(plan.rows.map((r) => r.addon_product_id)).toEqual(['prod_c']);
    expect(plan.skipped).toEqual([
      { addon_pim_master_id: 'missing', reason: 'addon_not_in_store' },
      { addon_pim_master_id: 'master-a', reason: 'addon_is_self' },
      { addon_pim_master_id: 'master-b', reason: 'no_allowed_variant_in_store' },
    ]);
  });

  it('drops only the allowed options that are missing in the store', () => {
    const [row] = planBundleOfferSync('prod_a', [item('master-b', { allowed_pim_variant_ids: ['pim-b1', 'pim-gone'] })], addons).rows;
    expect(row.allowed_variant_ids).toEqual(['var_b1']);
  });

  it('returns no rows for an empty list', () => {
    expect(planBundleOfferSync('prod_a', [], addons)).toEqual({ rows: [], skipped: [] });
  });
});

describe('isStaleBundleOfferSync', () => {
  const stored = new Date('2026-06-15T03:00:00.000Z');
  it('skips a replacement older than the last applied one', () => {
    expect(isStaleBundleOfferSync('2026-06-15T02:59:59.999Z', stored)).toBe(true);
  });
  it('applies a newer or equal replacement, the first one, and one without a revision', () => {
    expect(isStaleBundleOfferSync('2026-06-15T03:00:00.000Z', stored)).toBe(false);
    expect(isStaleBundleOfferSync('2026-06-15T03:00:01.000Z', stored)).toBe(false);
    expect(isStaleBundleOfferSync('2026-06-15T02:00:00.000Z', null)).toBe(false);
    expect(isStaleBundleOfferSync(undefined, stored)).toBe(false);
  });
});
