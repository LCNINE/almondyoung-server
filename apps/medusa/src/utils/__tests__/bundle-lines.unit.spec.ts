import { planBundleLines, priceKey, releasedLineUpdate, type BundleCartLine, type BundleOfferView, type BundlePlanContext } from '../bundle-lines';

const NOW = new Date('2026-06-15T03:00:00.000Z');

const offer = (over: Partial<BundleOfferView> = {}): BundleOfferView => ({
  product_id: 'prod_a',
  addon_product_id: 'prod_b',
  allowed_variant_ids: null,
  regular_rate_bp: 1000,
  membership_rate_bp: 2000,
  enabled: true,
  starts_at: null,
  ends_at: null,
  ...over,
});

let seq = 0;
const line = (over: Partial<BundleCartLine>): BundleCartLine => ({
  id: `line_${++seq}`,
  product_id: 'prod_b',
  variant_id: 'var_b1',
  quantity: 1,
  unit_price: 10000,
  compare_at_unit_price: null,
  is_custom_price: false,
  created_at: new Date(Date.UTC(2026, 5, 15, 0, seq)),
  bundle_parent_product_id: null,
  bundle_rates: null,
  ...over,
});
const aLine = (quantity: number, variant_id = 'var_a1') => line({ product_id: 'prod_a', variant_id, quantity, unit_price: 20000 });
const bLine = (quantity: number, over: Partial<BundleCartLine> = {}) =>
  line({ quantity, is_custom_price: true, bundle_parent_product_id: 'prod_a', ...over });

const ctx = (over: Partial<BundlePlanContext> = {}): BundlePlanContext => ({
  offers: [offer()],
  sellableProducts: new Set(['prod_a', 'prod_b', 'prod_c']),
  isMember: false,
  now: NOW,
  basis: new Map([
    ['var_b1', { regular: 10000, membership: 8000 }],
    ['var_b2', { regular: 10000, membership: 8000 }],
  ]),
  // 고객에게 그 수량에 붙는 가격(Medusa 계산가). 테스트는 수량과 무관하게 정가로 둔다.
  priceAt: new Map(
    [1, 2, 3, 4, 5].flatMap((q) => [
      [priceKey('var_b1', q), 10000],
      [priceKey('var_b2', q), 10000],
    ]),
  ),
  ...over,
});

describe('planBundleLines', () => {
  it('does nothing for a cart without bundle lines', () => {
    expect(planBundleLines([aLine(1), line({})], ctx())).toEqual({ changes: [], missingPrices: [] });
  });

  it('prices a bundle line at the regular rate for a guest and the membership rate for a member', () => {
    const b = bLine(1, { unit_price: 10000 });
    expect(planBundleLines([aLine(1), b], ctx()).changes).toEqual([
      { type: 'set_bundle', line_id: b.id, quantity: 1, unit_price: 9000, compare_at_unit_price: 10000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
    ]);
    // 회원: 멤버십가 8,000 × 80% = 6,400, 할인 전 가격은 회원이 원래 내는 값(계산가)
    expect(planBundleLines([aLine(1), b], ctx({ isMember: true })).changes).toEqual([
      { type: 'set_bundle', line_id: b.id, quantity: 1, unit_price: 6400, compare_at_unit_price: 10000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
    ]);
  });

  it('writes nothing when the line already has the right price', () => {
    const b = bLine(1, { unit_price: 9000, compare_at_unit_price: 10000, bundle_rates: { regular_rate_bp: 1000, membership_rate_bp: 2000 } });
    expect(planBundleLines([aLine(1), b], ctx()).changes).toEqual([]);
  });

  it('limits the discount to the total quantity of the product across its options, filling lines in the order they were added', () => {
    const first = bLine(2, { variant_id: 'var_b1' });
    const second = bLine(2, { variant_id: 'var_b2' });
    const plan = planBundleLines([aLine(2, 'var_a1'), aLine(1, 'var_a2'), first, second], ctx());
    expect(plan.changes).toEqual([
      { type: 'set_bundle', line_id: first.id, quantity: 2, unit_price: 9000, compare_at_unit_price: 10000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
      { type: 'set_bundle', line_id: second.id, quantity: 1, unit_price: 9000, compare_at_unit_price: 10000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
      { type: 'move_overflow', from_line_id: second.id, variant_id: 'var_b2', quantity: 1, into_line_id: null, into_quantity: 1, unit_price: 10000, compare_at_unit_price: null },
    ]);
  });

  it('merges the overflow into an existing normal line of the same option at its new quantity price', () => {
    const b = bLine(3);
    const normal = line({ quantity: 1, unit_price: 10000 });
    const priceAt = ctx().priceAt;
    priceAt.set(priceKey('var_b1', 3), 9500);
    const plan = planBundleLines([aLine(1), b, normal], ctx({ priceAt }));
    expect(plan.changes).toContainEqual({
      type: 'move_overflow',
      from_line_id: b.id,
      variant_id: 'var_b1',
      quantity: 2,
      into_line_id: normal.id,
      into_quantity: 3,
      unit_price: 9500, compare_at_unit_price: null,
    });
  });

  it.each([
    ['the main product left the cart', [] as BundleCartLine[], ctx(), 'parent_removed'],
    ['the offer was removed', [aLine(1)], ctx({ offers: [] }), 'offer_removed'],
    ['the offer is switched off', [aLine(1)], ctx({ offers: [offer({ enabled: false })] }), 'disabled'],
    ['the period ended', [aLine(1)], ctx({ offers: [offer({ ends_at: new Date('2026-06-14T14:59:59.999Z') })] }), 'out_of_period'],
    ['the period has not started', [aLine(1)], ctx({ offers: [offer({ starts_at: new Date('2026-06-15T15:00:00.000Z') })] }), 'out_of_period'],
    ['the option is no longer allowed', [aLine(1)], ctx({ offers: [offer({ allowed_variant_ids: ['var_b2'] })] }), 'offer_removed'],
    ['the add-on is no longer on sale', [aLine(1)], ctx({ sellableProducts: new Set(['prod_a']) }), 'offer_removed'],
    ['the main product is no longer on sale', [aLine(1)], ctx({ sellableProducts: new Set(['prod_b']) }), 'parent_removed'],
  ])('releases the line to its normal price when %s', (_l, others, c, reason) => {
    const b = bLine(2, { unit_price: 9000 });
    expect(planBundleLines([...others, b], c).changes).toEqual([{ type: 'release', line_id: b.id, unit_price: 10000, compare_at_unit_price: null, reason }]);
  });

  it('keeps the normal price when a tier or sale price is already cheaper than the bundle price', () => {
    const b = bLine(1, { unit_price: 9000 });
    const priceAt = ctx().priceAt;
    priceAt.set(priceKey('var_b1', 1), 8500);
    expect(planBundleLines([aLine(1), b], ctx({ priceAt })).changes).toEqual([
      { type: 'release', line_id: b.id, unit_price: 8500, compare_at_unit_price: null, reason: 'not_cheaper' },
    ]);
  });

  it('rewrites the line when only the offer rates changed, so the order keeps the rates that priced it', () => {
    const b = bLine(1, { unit_price: 9000, compare_at_unit_price: 10000, bundle_rates: { regular_rate_bp: 1000, membership_rate_bp: 1500 } });
    expect(planBundleLines([aLine(1), b], ctx()).changes).toEqual([
      { type: 'set_bundle', line_id: b.id, quantity: 1, unit_price: 9000, compare_at_unit_price: 10000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
    ]);
  });

  it('reports the prices it needs instead of guessing', () => {
    const b = bLine(4);
    const plan = planBundleLines([aLine(4), b], ctx({ priceAt: new Map() }));
    expect(plan.changes).toEqual([]);
    expect(plan.missingPrices).toEqual([{ variant_id: 'var_b1', quantity: 4 }]);
  });

  it('counts limits separately per main product', () => {
    const offers = [offer(), offer({ product_id: 'prod_c' })];
    const underA = bLine(1, { bundle_parent_product_id: 'prod_a' });
    const underC = bLine(1, { bundle_parent_product_id: 'prod_c' });
    const plan = planBundleLines([aLine(1), line({ product_id: 'prod_c', variant_id: 'var_c1' }), underA, underC], ctx({ offers }));
    expect(plan.changes.map((c) => c.type)).toEqual(['set_bundle', 'set_bundle']);
  });
});

describe('releasedLineUpdate', () => {
  it('removes the bundle marker with an empty string so the cart module merge drops the key', () => {
    const update = releasedLineUpdate(
      { type: 'release', line_id: 'line_x', unit_price: 10000, compare_at_unit_price: null, reason: 'parent_removed' },
      NOW,
    );
    expect(update).toEqual({
      is_custom_price: false,
      unit_price: 10000,
      compare_at_unit_price: null,
      metadata: { bundle: '', bundle_released: { reason: 'parent_removed', at: NOW.toISOString() } },
    });
  });
});

describe('planBundleLines — prices of lines returned to normal', () => {
  it('releases a custom-priced line that lost its bundle marker', () => {
    const forged = line({ quantity: 3, unit_price: 8000, is_custom_price: true, bundle_parent_product_id: null });
    expect(planBundleLines([aLine(1), forged], ctx()).changes).toEqual([
      { type: 'release', line_id: forged.id, unit_price: 10000, compare_at_unit_price: null, reason: 'invalid' },
    ]);
  });

  it('gives released and overflow lines the sale comparison price like a normal line', () => {
    const c = ctx({
      isMember: true,
      priceAt: new Map([1, 2, 3].map((q) => [priceKey('var_b1', q), 8000])),
      compareAt: new Map([1, 2, 3].map((q) => [priceKey('var_b1', q), 10000])),
    });
    const released = bLine(1, { unit_price: 6400 });
    expect(planBundleLines([released], c).changes).toEqual([
      { type: 'release', line_id: released.id, unit_price: 8000, compare_at_unit_price: 10000, reason: 'parent_removed' },
    ]);
    const over = bLine(3, { unit_price: 6400, compare_at_unit_price: 8000, bundle_rates: { regular_rate_bp: 1000, membership_rate_bp: 2000 } });
    expect(planBundleLines([aLine(1), over], c).changes).toEqual([
      { type: 'set_bundle', line_id: over.id, quantity: 1, unit_price: 6400, compare_at_unit_price: 8000, regular_rate_bp: 1000, membership_rate_bp: 2000 },
      { type: 'move_overflow', from_line_id: over.id, variant_id: 'var_b1', quantity: 2, into_line_id: null, into_quantity: 2, unit_price: 8000, compare_at_unit_price: 10000 },
    ]);
  });
});

describe('planBundleLines — bundle markers on normal lines', () => {
  it('clears a bundle marker the customer wrote on a normal-priced line, keeping its price', () => {
    const forged = line({ quantity: 2, unit_price: 10000, has_bundle_marker: true });
    expect(planBundleLines([aLine(1), forged], ctx()).changes).toEqual([
      { type: 'release', line_id: forged.id, unit_price: 10000, compare_at_unit_price: null, reason: 'invalid' },
    ]);
  });
});
