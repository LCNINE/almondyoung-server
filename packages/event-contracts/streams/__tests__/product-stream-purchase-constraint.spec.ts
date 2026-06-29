import { PRODUCT_STREAM } from '../product.stream';

const validPayload = {
  masterId: 'master-1',
  versionId: 'version-1',
  name: '회원 전용 립밤',
  previousActiveVersionId: null,
  changeReason: 'published',
  changedAt: '2026-06-09T00:00:00.000Z',
  snapshot: {
    masterId: 'master-1',
    versionId: 'version-1',
    version: 3,
    name: '회원 전용 립밤',
    variants: [
      {
        id: 'variant-1',
        variantName: '기본 품목',
        sku: 'variant-1',
        isDefault: true,
        status: 'active',
        basePrice: 10000,
      },
    ],
    status: 'active',
    isWholesaleOnly: false,
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isOverseas: false,
    isMembershipOnly: false,
    isGiftcard: false,
    discountable: true,
    purchaseConstraint: {
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    },
  },
};

describe('PRODUCT_STREAM ProductMasterActiveVersionChanged purchaseConstraint', () => {
  const schema = PRODUCT_STREAM.events.ProductMasterActiveVersionChanged.schema!;

  it('accepts a purchase constraint in the active product snapshot', () => {
    const parsed = schema.parse(validPayload);

    expect(parsed.snapshot?.purchaseConstraint).toEqual({
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });

  it('carries membership visibility policies in the active product snapshot', () => {
    const parsed = schema.parse({
      ...validPayload,
      snapshot: {
        ...validPayload.snapshot,
        hideMembershipPriceForNonMembers: true,
        isMembershipOnly: true,
        isVisibleToMembersOnly: true,
      },
    });

    expect(parsed.snapshot?.hideMembershipPriceForNonMembers).toBe(true);
    expect(parsed.snapshot?.isMembershipOnly).toBe(true);
    expect(parsed.snapshot?.isVisibleToMembersOnly).toBe(true);
  });

  it('accepts null lifetimeQuantityLimit as no quantity limit', () => {
    expect(() =>
      schema.parse({
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          purchaseConstraint: {
            requiresMembership: true,
            lifetimeQuantityLimit: null,
          },
        },
      }),
    ).not.toThrow();
  });

  it('allows purchaseConstraint to be omitted when no constraint exists', () => {
    const { purchaseConstraint: _removed, ...snapshot } = validPayload.snapshot;

    expect(() => schema.parse({ ...validPayload, snapshot })).not.toThrow();
  });

  it('rejects zero lifetimeQuantityLimit', () => {
    expect(() =>
      schema.parse({
        ...validPayload,
        snapshot: {
          ...validPayload.snapshot,
          purchaseConstraint: {
            requiresMembership: false,
            lifetimeQuantityLimit: 0,
          },
        },
      }),
    ).toThrow();
  });
});
