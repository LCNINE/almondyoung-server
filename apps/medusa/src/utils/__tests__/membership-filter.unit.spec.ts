import {
  assertProductVisibleToCustomer,
  applyMembershipPriceVisibility,
  applyPurchaseGateForNonMember,
  requiresMembershipToPurchase,
  filterProductsForMemberState,
  isMembershipPriceHiddenProduct,
  isVisibleToMembersOnlyProduct,
  sanitizeProductForNonMember,
  transformStoreProductsPayload,
  type MembershipProduct,
} from '../membership-filter';

const makeProduct = (overrides: Partial<MembershipProduct> = {}): MembershipProduct => ({
  id: 'prod_normal',
  metadata: { isMembershipOnly: false, brand: 'almond' },
  variants: [
    {
      id: 'variant_1',
      metadata: { membershipPrice: 9900, sku: 'SKU-1' },
    },
  ],
  ...overrides,
});

describe('isMembershipPriceHiddenProduct', () => {
  it('metadata.hideMembershipPriceForNonMembers=true(boolean/string) 상품을 멤버십가 숨김 대상으로 판정한다', () => {
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: { hideMembershipPriceForNonMembers: true } }))).toBe(
      true,
    );
    expect(
      isMembershipPriceHiddenProduct(makeProduct({ metadata: { hideMembershipPriceForNonMembers: 'true' } })),
    ).toBe(true);
  });

  it('legacy metadata.isMembershipOnly=true(boolean/string)도 멤버십가 숨김 대상으로 판정한다', () => {
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: { isMembershipOnly: true } }))).toBe(true);
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: { isMembershipOnly: 'true' } }))).toBe(true);
  });

  it('일반 상품은 숨김 대상이 아니다', () => {
    expect(isMembershipPriceHiddenProduct(makeProduct())).toBe(false);
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: null }))).toBe(false);
  });
});

describe('members-only product visibility', () => {
  it('metadata.isVisibleToMembersOnly=true(boolean/string) 상품을 회원 전용 노출 대상으로 판정한다', () => {
    expect(isVisibleToMembersOnlyProduct(makeProduct({ metadata: { isVisibleToMembersOnly: true } }))).toBe(true);
    expect(isVisibleToMembersOnlyProduct(makeProduct({ metadata: { isVisibleToMembersOnly: 'true' } }))).toBe(true);
  });

  it('비멤버 products 배열에서 members-only 상품을 제거한다', () => {
    const products = [
      makeProduct({ id: 'prod_members_only', metadata: { isVisibleToMembersOnly: true } }),
      makeProduct({ id: 'prod_public' }),
    ];

    expect(filterProductsForMemberState(products, false).map((product) => product.id)).toEqual(['prod_public']);
  });

  it('멤버 products 배열에서는 members-only 상품을 유지한다', () => {
    const products = [
      makeProduct({ id: 'prod_members_only', metadata: { isVisibleToMembersOnly: true } }),
      makeProduct({ id: 'prod_public' }),
    ];

    expect(filterProductsForMemberState(products, true)).toHaveLength(2);
  });

  it('비멤버 단건 members-only 상품 접근을 차단한다', () => {
    const product = makeProduct({ metadata: { isVisibleToMembersOnly: true } });
    expect(() => assertProductVisibleToCustomer(product, false)).toThrow('멤버십 회원 전용 상품입니다.');
    expect(() => assertProductVisibleToCustomer(product, true)).not.toThrow();
  });
});

describe('sanitizeProductForNonMember', () => {
  it('isMembershipOnly=true 상품도 비멤버 응답에서 제거되지 않고 반환된다', () => {
    const product = makeProduct({ metadata: { isMembershipOnly: true } });
    const result = sanitizeProductForNonMember(product);

    expect(result.id).toBe(product.id);
    expect(result.metadata).toEqual({ isMembershipOnly: true });
    expect(result.variants).toHaveLength(1);
  });

  it('variant.metadata의 membershipPrice만 제거하고 나머지 metadata는 유지한다', () => {
    const product = makeProduct({
      metadata: { isMembershipOnly: true },
      variants: [
        {
          id: 'variant_1',
          metadata: {
            membershipPrice: 9900,
            membership_price: 9900,
            membershipprice: 9900,
            sku: 'SKU-1',
          },
        },
      ],
    });

    const result = sanitizeProductForNonMember(product);

    expect(result.variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
    expect(result.variants?.[0]?.id).toBe('variant_1');
  });

  it('숨김 대상이 아닌 상품은 그대로 반환한다', () => {
    const product = makeProduct();
    expect(sanitizeProductForNonMember(product)).toBe(product);
  });

  it('variant.metadata가 없는 경우에도 안전하게 동작한다', () => {
    const product = makeProduct({
      metadata: { isMembershipOnly: true },
      variants: [{ id: 'variant_1', metadata: null }],
    });

    const result = sanitizeProductForNonMember(product);
    expect(result.variants?.[0]?.metadata).toBeNull();
  });
});

describe('applyMembershipPriceVisibility', () => {
  it('멤버에게는 멤버십가 숫자를 유지한다', () => {
    const product = makeProduct({ metadata: { isMembershipOnly: true } });
    const result = applyMembershipPriceVisibility(product, true);

    expect(result.variants?.[0]?.metadata?.membershipPrice).toBe(9900);
  });

  it('비멤버에게는 멤버십가 숫자를 제거한다', () => {
    const product = makeProduct({ metadata: { isMembershipOnly: true } });
    const result = applyMembershipPriceVisibility(product, false);

    expect(result.metadata?.isMembershipOnly).toBe(true);
    expect(result.variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
  });
});

describe('transformStoreProductsPayload', () => {
  it('비멤버 products 배열 응답에서 members-only 상품을 제거하고 멤버십가를 숨긴다', () => {
    const payload = {
      products: [
        makeProduct({ metadata: { hideMembershipPriceForNonMembers: true } }),
        makeProduct({ id: 'prod_members_only', metadata: { isVisibleToMembersOnly: true } }),
        makeProduct({ id: 'prod_other' }),
      ],
      count: 3,
      offset: 0,
      limit: 12,
    };

    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.products).toHaveLength(2);
    expect(result.count).toBe(3);
    expect(result.products.map((product) => product.id)).toEqual(['prod_normal', 'prod_other']);
    // hideMembershipPriceForNonMembers 상품: membershipPrice 제거
    expect(result.products[0].variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
    // 일반 상품: membershipPrice 유지
    expect(result.products[1].variants?.[0]?.metadata?.membershipPrice).toBe(9900);
  });

  it('멤버 응답에서는 멤버십가 숫자를 유지한다', () => {
    const payload = {
      products: [makeProduct({ metadata: { isMembershipOnly: true } })],
      count: 1,
    };

    const result = transformStoreProductsPayload(payload, true) as typeof payload;
    expect(result.products[0].variants?.[0]?.metadata?.membershipPrice).toBe(9900);
  });

  it('단건 product 응답(/store/products/:id)도 처리한다', () => {
    const payload = { product: makeProduct({ metadata: { isMembershipOnly: 'true' } }) };
    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.product.id).toBe('prod_normal');
    expect(result.product.variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
  });

  it('products/product가 없는 payload는 그대로 반환한다', () => {
    const payload = { regions: [] };
    expect(transformStoreProductsPayload(payload, false)).toBe(payload);
    expect(transformStoreProductsPayload(null, false)).toBeNull();
  });
});

const makeMembersOnlyPurchaseProduct = (): MembershipProduct => ({
  id: 'prod_members_purchase',
  metadata: { pimPurchaseConstraint: { requiresMembership: true, lifetimeQuantityLimit: null } },
  variants: [
    {
      id: 'variant_in_stock',
      manage_inventory: true,
      allow_backorder: true,
      inventory_quantity: 7,
      metadata: { sku: 'SKU-1', inboundDate: '2026-07-22', inboundApproximate: true },
    },
  ],
});

describe('requiresMembershipToPurchase', () => {
  it('pimPurchaseConstraint.requiresMembership=true(boolean/string)를 멤버십 전용 구매로 판정한다', () => {
    expect(requiresMembershipToPurchase(makeMembersOnlyPurchaseProduct())).toBe(true);
    expect(
      requiresMembershipToPurchase(makeProduct({ metadata: { pimPurchaseConstraint: { requiresMembership: 'true' } } })),
    ).toBe(true);
  });

  it('제약이 없거나 requiresMembership=false면 대상이 아니다', () => {
    expect(requiresMembershipToPurchase(makeProduct())).toBe(false);
    expect(requiresMembershipToPurchase(makeProduct({ metadata: { pimPurchaseConstraint: null } }))).toBe(false);
    expect(
      requiresMembershipToPurchase(makeProduct({ metadata: { pimPurchaseConstraint: { requiresMembership: false } } })),
    ).toBe(false);
  });

  it('metadata 가 없으면 게이트를 걸지 않는다(fail-open) — 조회 시 fields 에 metadata 가 있어야 한다', () => {
    expect(requiresMembershipToPurchase({ id: 'prod_no_metadata' })).toBe(false);
  });
});

describe('applyPurchaseGateForNonMember', () => {
  it('비회원에게는 재고가 있어도 품절로 덮는다 (세 값 모두)', () => {
    const gated = applyPurchaseGateForNonMember(makeMembersOnlyPurchaseProduct(), false);
    const variant = gated.variants?.[0];

    // 셋 중 하나라도 빠지면 스토어프론트가 판매 가능으로 판정한다.
    expect(variant?.manage_inventory).toBe(true);
    expect(variant?.allow_backorder).toBe(false);
    expect(variant?.inventory_quantity).toBe(0);
  });

  it('비회원에게는 재입고 예정일을 숨기고 나머지 variant metadata 는 보존한다', () => {
    const gated = applyPurchaseGateForNonMember(makeMembersOnlyPurchaseProduct(), false);

    expect(gated.variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
  });

  it('멤버 응답은 재고/백오더/재입고예정일을 그대로 둔다', () => {
    const original = makeMembersOnlyPurchaseProduct();
    const result = applyPurchaseGateForNonMember(original, true);

    expect(result).toBe(original);
    expect(result.variants?.[0]?.inventory_quantity).toBe(7);
    expect(result.variants?.[0]?.metadata?.inboundDate).toBe('2026-07-22');
  });

  it('멤버십 전용 구매 상품이 아니면 비회원이어도 건드리지 않는다', () => {
    const original = makeProduct();
    expect(applyPurchaseGateForNonMember(original, false)).toBe(original);
  });
});

describe('transformStoreProductsPayload - 멤버십 전용 구매 게이트', () => {
  it('목록 응답에서 비회원에게 품절로 덮는다', () => {
    const payload = { products: [makeMembersOnlyPurchaseProduct()], count: 1 };
    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.products[0].variants?.[0]?.inventory_quantity).toBe(0);
    expect(result.products[0].variants?.[0]?.allow_backorder).toBe(false);
    expect(result.products[0].variants?.[0]?.metadata).toEqual({ sku: 'SKU-1' });
  });

  it('단건 응답에서도 비회원에게 품절로 덮는다', () => {
    const payload = { product: makeMembersOnlyPurchaseProduct() };
    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.product.variants?.[0]?.inventory_quantity).toBe(0);
    expect(result.product.variants?.[0]?.allow_backorder).toBe(false);
  });

  it('멤버에게는 목록/단건 모두 재고를 그대로 노출한다', () => {
    const list = transformStoreProductsPayload({ products: [makeMembersOnlyPurchaseProduct()], count: 1 }, true) as {
      products: MembershipProduct[];
    };
    const single = transformStoreProductsPayload({ product: makeMembersOnlyPurchaseProduct() }, true) as {
      product: MembershipProduct;
    };

    expect(list.products[0].variants?.[0]?.inventory_quantity).toBe(7);
    expect(single.product.variants?.[0]?.inventory_quantity).toBe(7);
  });

  it('구매 게이트가 걸려도 노출 차단(isVisibleToMembersOnly)과 독립이다 — 비회원 목록에 남는다', () => {
    const payload = { products: [makeMembersOnlyPurchaseProduct()], count: 1 };
    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.products).toHaveLength(1);
  });
});
