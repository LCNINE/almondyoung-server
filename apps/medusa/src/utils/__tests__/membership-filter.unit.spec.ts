import {
  applyMembershipPriceVisibility,
  isMembershipPriceHiddenProduct,
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
  it('metadata.isMembershipOnly=true(boolean/string) 상품을 멤버십가 숨김 대상으로 판정한다', () => {
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: { isMembershipOnly: true } }))).toBe(true);
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: { isMembershipOnly: 'true' } }))).toBe(true);
  });

  it('일반 상품은 숨김 대상이 아니다', () => {
    expect(isMembershipPriceHiddenProduct(makeProduct())).toBe(false);
    expect(isMembershipPriceHiddenProduct(makeProduct({ metadata: null }))).toBe(false);
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
  it('비멤버 products 배열 응답에서 상품을 제거하지 않고 멤버십가만 숨긴다', () => {
    const payload = {
      products: [makeProduct({ metadata: { isMembershipOnly: true } }), makeProduct({ id: 'prod_other' })],
      count: 2,
      offset: 0,
      limit: 12,
    };

    const result = transformStoreProductsPayload(payload, false) as typeof payload;

    expect(result.products).toHaveLength(2);
    expect(result.count).toBe(2);
    // isMembershipOnly 상품: membershipPrice 제거
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
