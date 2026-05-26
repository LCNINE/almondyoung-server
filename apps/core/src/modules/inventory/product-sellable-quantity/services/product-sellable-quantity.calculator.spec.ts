import {
  calculateProductSellableQuantity,
  ProductSellableQuantityInput,
  UNBOUNDED_SELLABLE_QUANTITY,
} from './product-sellable-quantity.calculator';

describe('calculateProductSellableQuantity', () => {
  const now = new Date('2026-05-26T00:00:00.000Z');

  function makeInput(overrides: Partial<ProductSellableQuantityInput> = {}): ProductSellableQuantityInput {
    return {
      variantId: 'variant-1',
      variantStatus: 'active',
      activeVersion: {
        masterId: 'master-1',
        versionId: 'version-1',
      },
      matching: {
        id: 'matching-1',
        status: 'matched',
        strategy: 'variant',
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      },
      components: [{ skuId: 'sku-1', requiredQuantity: 1, availableQuantity: 10 }],
      ...overrides,
    };
  }

  it('1:1 variant/SKU 매칭은 SKU available quantity를 그대로 판매가능수량으로 사용한다', () => {
    const result = calculateProductSellableQuantity(makeInput(), { now });

    expect(result.sellableQuantity).toBe(10);
    expect(result.stockBoundQuantity).toBe(10);
    expect(result.reason).toBe('SELLABLE');
  });

  it('multi-SKU 세트 매칭은 가장 부족한 컴포넌트 수량으로 제한된다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        components: [
          { skuId: 'sku-1', requiredQuantity: 1, availableQuantity: 9 },
          { skuId: 'sku-2', requiredQuantity: 1, availableQuantity: 3 },
          { skuId: 'sku-3', requiredQuantity: 1, availableQuantity: 5 },
        ],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(3);
    expect(result.components.map((component) => component.componentSellableQuantity)).toEqual([9, 3, 5]);
  });

  it('매칭이 없으면 판매불가 0으로 표현한다', () => {
    const result = calculateProductSellableQuantity(makeInput({ matching: null, components: [] }), { now });

    expect(result.sellableQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('MATCHING_MISSING');
  });

  it('컴포넌트 재고가 0이면 판매가능수량 0으로 제한된다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        components: [
          { skuId: 'sku-1', requiredQuantity: 1, availableQuantity: 10 },
          { skuId: 'sku-2', requiredQuantity: 1, availableQuantity: 0 },
        ],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.stockBoundQuantity).toBe(0);
    expect(result.reason).toBe('INSUFFICIENT_COMPONENT_STOCK');
  });

  it('컴포넌트 재고가 required quantity보다 적으면 판매가능수량 0으로 제한된다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        components: [{ skuId: 'sku-1', requiredQuantity: 2, availableQuantity: 1 }],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.stockBoundQuantity).toBe(0);
    expect(result.reason).toBe('INSUFFICIENT_COMPONENT_STOCK');
  });

  it('컴포넌트 required quantity가 1보다 크면 floor(available / required)를 사용한다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        components: [{ skuId: 'sku-1', requiredQuantity: 2, availableQuantity: 5 }],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(2);
    expect(result.components[0]).toMatchObject({
      requiredQuantity: 2,
      availableQuantity: 5,
      componentSellableQuantity: 2,
    });
  });

  it('active 버전에 속하지 않은 variant는 판매불가 0으로 표현한다', () => {
    const result = calculateProductSellableQuantity(makeInput({ activeVersion: null }), { now });

    expect(result.sellableQuantity).toBe(0);
    expect(result.reason).toBe('NOT_ACTIVE_VERSION');
  });

  it('inactive variant는 판매불가 0으로 표현한다', () => {
    const result = calculateProductSellableQuantity(makeInput({ variantStatus: 'inactive' }), { now });

    expect(result.sellableQuantity).toBe(0);
    expect(result.reason).toBe('VARIANT_INACTIVE');
  });

  it('pre-stock 판매 정책은 SKU stock-bound 수량이 0이어도 공유 판매가능수량을 열어 둔다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: {
          id: 'matching-1',
          status: 'matched',
          strategy: 'variant',
          preStockSellable: true,
          alwaysSellableZeroStock: false,
        },
        components: [{ skuId: 'sku-1', requiredQuantity: 1, availableQuantity: 0 }],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(UNBOUNDED_SELLABLE_QUANTITY);
    expect(result.stockBoundQuantity).toBe(0);
    expect(result.reason).toBe('PRE_STOCK_SELLABLE');
  });
});
