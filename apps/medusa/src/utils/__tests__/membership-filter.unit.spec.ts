import {
  assertProductVisibleToCustomer,
  applyMembershipPriceVisibility,
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
