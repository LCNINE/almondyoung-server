import {
  calculateProductSellableQuantity,
  ProductSellableQuantityInput,
  UNBOUNDED_SELLABLE_QUANTITY,
} from './product-sellable-quantity.calculator';
import {
  hasProductSellableQuantityProjectionChanged,
  toProductSellableQuantityChangedPayload,
} from './product-sellable-quantity.service';

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

  it('matched + void 전략은 SKU 링크 없이 재고 비제한 판매가능수량으로 계산한다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: {
          id: 'matching-1',
          status: 'matched',
          strategy: 'void',
          preStockSellable: false,
          alwaysSellableZeroStock: false,
        },
        components: [],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(UNBOUNDED_SELLABLE_QUANTITY);
    expect(result.stockBoundQuantity).toBe(UNBOUNDED_SELLABLE_QUANTITY);
    expect(result.isSellable).toBe(true);
    expect(result.reason).toBe('SELLABLE');
  });

  it('matched + void 전략도 판매기간 전이면 판매불가로 계산한다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        activeVersion: {
          masterId: 'master-1',
          versionId: 'version-1',
          salesStartDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        matching: {
          id: 'matching-1',
          status: 'matched',
          strategy: 'void',
          preStockSellable: false,
          alwaysSellableZeroStock: false,
        },
        components: [],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('SALES_NOT_STARTED');
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

  it('pending 매칭은 전략 미결정 상태로 판매불가 0을 반환한다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: {
          id: 'matching-1',
          status: 'pending',
          strategy: null,
          preStockSellable: true,
          alwaysSellableZeroStock: false,
        },
        components: [],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('MATCHING_PENDING');
  });

  it('legacy ignored 매칭은 void 전략이 있어도 미해결 상태로 판매불가 0을 반환한다', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: {
          id: 'matching-1',
          status: 'ignored',
          strategy: 'void',
          preStockSellable: true,
          alwaysSellableZeroStock: false,
        },
        components: [],
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('MATCHING_IGNORED');
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

  it('manual out-of-stock override projects zero even without matching or SKU links', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: null,
        components: [],
        availabilityOverride: 'manual_out_of_stock',
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.stockBoundQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('MANUAL_OUT_OF_STOCK');
    expect(result.availabilityOverride).toBe('manual_out_of_stock');
  });

  it('manual out-of-stock override wins over void strategy but not over inactive variant', () => {
    const voidResult = calculateProductSellableQuantity(
      makeInput({
        availabilityOverride: 'manual_out_of_stock',
        matching: {
          id: 'matching-1',
          status: 'matched',
          strategy: 'void',
          preStockSellable: true,
          alwaysSellableZeroStock: true,
        },
        components: [],
      }),
      { now },
    );

    expect(voidResult.sellableQuantity).toBe(0);
    expect(voidResult.isSellable).toBe(false);
    expect(voidResult.reason).toBe('MANUAL_OUT_OF_STOCK');

    const inactiveResult = calculateProductSellableQuantity(
      makeInput({
        variantStatus: 'inactive',
        availabilityOverride: 'manual_out_of_stock',
      }),
      { now },
    );

    expect(inactiveResult.reason).toBe('VARIANT_INACTIVE');
  });

  it('ProductSellableQuantityChanged payload는 원인 없이 현재 projection 상태를 담는다', () => {
    const projection = calculateProductSellableQuantity(makeInput(), { now });

    expect(toProductSellableQuantityChangedPayload(projection)).toEqual({
      variantId: 'variant-1',
      masterId: 'master-1',
      versionId: 'version-1',
      matchingId: 'matching-1',
      sellableQuantity: 10,
      stockBoundQuantity: 10,
      isSellable: true,
      reason: 'SELLABLE',
      availabilityOverride: null,
      calculatedAt: now.toISOString(),
    });
  });

  it('projection 비교는 calculatedAt 변화만으로 변경됐다고 보지 않는다', () => {
    const projection = calculateProductSellableQuantity(makeInput(), { now });

    expect(
      hasProductSellableQuantityProjectionChanged(projection, {
        masterId: projection.masterId,
        versionId: projection.versionId,
        matchingId: projection.matchingId,
        sellableQuantity: projection.sellableQuantity,
        stockBoundQuantity: projection.stockBoundQuantity,
        isSellable: projection.isSellable,
        reason: projection.reason,
      }),
    ).toBe(false);
  });
});
