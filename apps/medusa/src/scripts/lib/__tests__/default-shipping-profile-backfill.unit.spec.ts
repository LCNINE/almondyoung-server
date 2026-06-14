import {
  buildDefaultShippingProfileUpdates,
  isPhysicalPimProductMissingShippingProfile,
} from '../default-shipping-profile-backfill';

describe('default shipping profile backfill helpers', () => {
  it('selects PIM physical products missing shipping profile', () => {
    expect(
      isPhysicalPimProductMissingShippingProfile({
        id: 'prod_1',
        handle: 'master-1',
        metadata: { pimMasterId: 'master-1', fulfillmentKind: 'physical' },
        shipping_profile: null,
        is_giftcard: false,
      }),
    ).toBe(true);
  });

  it('treats missing fulfillmentKind as physical for live recovery', () => {
    expect(
      isPhysicalPimProductMissingShippingProfile({
        id: 'prod_1',
        handle: 'master-1',
        metadata: { pimMasterId: 'master-1' },
        shipping_profile: null,
        is_giftcard: false,
      }),
    ).toBe(true);
  });

  it('skips digital products and products that already have a profile', () => {
    expect(
      isPhysicalPimProductMissingShippingProfile({
        id: 'prod_digital',
        handle: 'digital',
        metadata: { pimMasterId: 'digital', fulfillmentKind: 'digital' },
        shipping_profile: null,
        is_giftcard: false,
      }),
    ).toBe(false);

    expect(
      isPhysicalPimProductMissingShippingProfile({
        id: 'prod_profiled',
        handle: 'profiled',
        metadata: { pimMasterId: 'profiled', fulfillmentKind: 'physical' },
        shipping_profile: { id: 'sp_default' },
        is_giftcard: false,
      }),
    ).toBe(false);
  });

  it('builds workflow update payloads', () => {
    expect(
      buildDefaultShippingProfileUpdates(
        [
          { id: 'prod_1', handle: 'master-1', metadata: { pimMasterId: 'master-1' }, shipping_profile: null },
          { id: 'prod_2', handle: 'master-2', metadata: {}, shipping_profile: null },
        ],
        'sp_default',
      ),
    ).toEqual([{ id: 'prod_1', shipping_profile_id: 'sp_default' }]);
  });
});
