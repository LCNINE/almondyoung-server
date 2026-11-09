import {
  AddonFacts,
  BundleOfferInput,
  bundleOfferErrorMessage,
  MAX_BUNDLE_OFFERS,
  validateBundleOffers,
} from './bundle-offer.math';

const A = 'master-a';

const addon = (masterId: string, over: Partial<AddonFacts> = {}): AddonFacts => ({
  masterId,
  name: `구성품 ${masterId}`,
  notSellableReason: null,
  variants: [{ variantId: `${masterId}-v1`, basePrice: 10000, membershipPrice: 8000 }],
  ...over,
});

const offer = (addonMasterId: string, over: Partial<BundleOfferInput> = {}): BundleOfferInput => ({
  addonMasterId,
  allowedVariantIds: null,
  regularRateBp: 1000,
  membershipRateBp: 1000,
  enabled: true,
  startsOn: null,
  endsOn: null,
  label: null,
  ...over,
});

const facts = (...list: AddonFacts[]) => new Map(list.map((f) => [f.masterId, f]));

describe('validateBundleOffers', () => {
  it('accepts a valid list and an empty list', () => {
    expect(validateBundleOffers(A, [offer('b')], facts(addon('b')))).toEqual([]);
    expect(validateBundleOffers(A, [], facts())).toEqual([]);
  });

  it(`rejects more than ${MAX_BUNDLE_OFFERS} offers`, () => {
    const ids = Array.from({ length: MAX_BUNDLE_OFFERS + 1 }, (_, i) => `b${i}`);
    const codes = validateBundleOffers(A, ids.map((id) => offer(id)), facts(...ids.map((id) => addon(id)))).map((v) => v.code);
    expect(codes).toContain('TOO_MANY_OFFERS');
  });

  it('rejects the product itself and the same add-on twice', () => {
    const v = validateBundleOffers(A, [offer(A), offer('b'), offer('b')], facts(addon(A), addon('b')));
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SELF_ADDON', offerIndex: 0 }),
        expect.objectContaining({ code: 'DUPLICATE_ADDON', offerIndex: 2 }),
      ]),
    );
  });

  it('rejects an add-on that does not exist or cannot be sold as an add-on', () => {
    const v = validateBundleOffers(
      A,
      [offer('missing'), offer('digital')],
      facts(addon('digital', { notSellableReason: 'digital' })),
    );
    expect(v).toEqual([
      expect.objectContaining({ code: 'ADDON_NOT_FOUND', offerIndex: 0 }),
      expect.objectContaining({ code: 'ADDON_NOT_SELLABLE', offerIndex: 1, reason: 'digital' }),
    ]);
  });

  it('rejects allowed options that do not belong to the add-on', () => {
    const v = validateBundleOffers(A, [offer('b', { allowedVariantIds: ['b-v1', 'other'] })], facts(addon('b')));
    expect(v).toEqual([expect.objectContaining({ code: 'VARIANT_NOT_IN_ADDON', variantId: 'other' })]);
  });

  it.each([
    ['above 99%', { regularRateBp: 10000 }, 'RATE_OUT_OF_RANGE'],
    ['not a whole percent', { membershipRateBp: 150 }, 'RATE_OUT_OF_RANGE'],
    ['negative', { regularRateBp: -100 }, 'RATE_OUT_OF_RANGE'],
    ['both zero', { regularRateBp: 0, membershipRateBp: 0 }, 'RATE_BOTH_ZERO'],
  ])('rejects a rate that is %s', (_l, patch, code) => {
    expect(validateBundleOffers(A, [offer('b', patch)], facts(addon('b'))).map((v) => v.code)).toEqual([code]);
  });

  it('allows a discount for one audience only', () => {
    expect(validateBundleOffers(A, [offer('b', { regularRateBp: 0, membershipRateBp: 500 })], facts(addon('b')))).toEqual([]);
  });

  it('rejects a member bundle price above the regular bundle price, checked per allowed option', () => {
    const b = addon('b', {
      variants: [
        { variantId: 'b-v1', basePrice: 10000, membershipPrice: 8000 },
        { variantId: 'b-v2', basePrice: 10000, membershipPrice: 9900 },
      ],
    });
    const v = validateBundleOffers(A, [offer('b', { regularRateBp: 2000, membershipRateBp: 0 })], facts(b));
    expect(v).toEqual([
      expect.objectContaining({ code: 'MEMBER_PRICE_ABOVE_REGULAR', variantId: 'b-v2', regularPrice: 8000, membershipPrice: 9900 }),
    ]);
    // 그 옵션을 대상에서 빼면 통과
    expect(validateBundleOffers(A, [offer('b', { regularRateBp: 2000, membershipRateBp: 0, allowedVariantIds: ['b-v1'] })], facts(b))).toEqual([]);
  });

  it('rejects an invalid or reversed period and an over-long label', () => {
    const codes = (o: Partial<BundleOfferInput>) => validateBundleOffers(A, [offer('b', o)], facts(addon('b'))).map((v) => v.code);
    expect(codes({ startsOn: '2026-02-30' })).toEqual(['PERIOD_INVALID_DATE']);
    expect(codes({ startsOn: '2026-07-01', endsOn: '2026-06-30' })).toEqual(['PERIOD_REVERSED']);
    expect(codes({ startsOn: '2026-06-30', endsOn: '2026-06-30' })).toEqual([]);
    expect(codes({ label: '가'.repeat(41) })).toEqual(['LABEL_TOO_LONG']);
  });
});

describe('bundleOfferErrorMessage', () => {
  it('names the add-on and counts the rest', () => {
    const offers = [offer('b', { regularRateBp: 10000 }), offer('c', { regularRateBp: 0, membershipRateBp: 0 })];
    const all = facts(addon('b', { name: '파랑 펜' }), addon('c'));
    const message = bundleOfferErrorMessage(validateBundleOffers(A, offers, all), offers, all);
    expect(message).toBe('함께 구매 구성품을 저장하지 못했습니다: 파랑 펜: 할인율은 0~99 사이 정수 %로 넣어 주세요. (외 1건)');
  });
});
