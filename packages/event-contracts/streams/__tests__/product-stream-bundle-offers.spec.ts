import { PRODUCT_STREAM } from '../product.stream';

const offer = {
  addonMasterId: 'master-b',
  sort: 0,
  allowedVariantIds: null,
  regularRateBp: 1000,
  membershipRateBp: 1500,
  enabled: true,
  startsOn: null,
  endsOn: null,
  label: null,
};

const validPayload = {
  masterId: 'master-a',
  offers: [offer],
  changedAt: '2026-06-09T00:00:00.000Z',
};

describe('PRODUCT_STREAM ProductBundleOffersChanged', () => {
  const schema = PRODUCT_STREAM.events.ProductBundleOffersChanged.schema!;

  it('accepts the full list of add-on offers for a master', () => {
    expect(schema.parse(validPayload).offers).toEqual([offer]);
  });

  it('accepts an empty list, meaning every offer of the master was removed', () => {
    expect(schema.parse({ ...validPayload, offers: [] }).offers).toEqual([]);
  });

  it('accepts a date window, an option allow-list and a label', () => {
    const parsed = schema.parse({
      ...validPayload,
      offers: [
        {
          ...offer,
          allowedVariantIds: ['variant-1', 'variant-2'],
          startsOn: '2026-06-01',
          endsOn: '2026-06-30',
          label: '함께 쓰면 좋아요',
        },
      ],
    });
    expect(parsed.offers[0]).toMatchObject({ startsOn: '2026-06-01', endsOn: '2026-06-30' });
  });

  it.each([
    ['a rate above 99%', { regularRateBp: 10000 }],
    ['a negative rate', { membershipRateBp: -1 }],
    ['a non-integer rate', { regularRateBp: 12.5 }],
    ['a date that is not YYYY-MM-DD', { startsOn: '2026/06/01' }],
    ['an empty allow-list', { allowedVariantIds: [] }],
  ])('rejects %s', (_label, patch) => {
    expect(schema.safeParse({ ...validPayload, offers: [{ ...offer, ...patch }] }).success).toBe(false);
  });

  it('rejects more than five offers', () => {
    const offers = Array.from({ length: 6 }, (_, i) => ({ ...offer, addonMasterId: `master-${i}`, sort: i }));
    expect(schema.safeParse({ ...validPayload, offers }).success).toBe(false);
  });
});

describe('PRODUCT_STREAM ProductMasterActiveVersionChanged bundleOffers', () => {
  const schema = PRODUCT_STREAM.events.ProductMasterActiveVersionChanged.schema!;
  const base = {
    masterId: 'master-a',
    versionId: 'version-1',
    name: '본품',
    previousActiveVersionId: null,
    changeReason: 'published',
    changedAt: '2026-06-09T00:00:00.000Z',
    snapshot: {
      masterId: 'master-a',
      versionId: 'version-1',
      version: 1,
      name: '본품',
      variants: [],
      status: 'active',
      isWholesaleOnly: false,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isOverseas: false,
      isMembershipOnly: false,
      isGiftcard: false,
      discountable: true,
    },
  };

  it('carries the current offers in the snapshot when the master has any', () => {
    const parsed = schema.parse({ ...base, snapshot: { ...base.snapshot, bundleOffers: [offer] } });
    expect(parsed.snapshot?.bundleOffers).toEqual([offer]);
  });

  it('carries the time the offers last changed and rejects a malformed one', () => {
    const changed = { ...base.snapshot, bundleOffers: [offer], bundleOffersChangedAt: '2026-06-15T03:00:00.000Z' };
    expect(schema.parse({ ...base, snapshot: changed }).snapshot?.bundleOffersChangedAt).toBe('2026-06-15T03:00:00.000Z');
    expect(() => schema.parse({ ...base, snapshot: { ...changed, bundleOffersChangedAt: '2026-06-15' } })).toThrow();
  });

  it('keeps snapshots without the key valid', () => {
    expect(schema.parse(base).snapshot).not.toHaveProperty('bundleOffers');
  });
});
