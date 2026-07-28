import { ProductImportPricingBuilder } from './product-import-pricing.builder';
import { comboKey } from '../dto/import.types';
import { ProductRecord } from '../dto/import.types';

function rec(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1, productKey: 'P1', raw: {}, version: {},
    categoryIds: [], categoryNames: [], options: [], variantOverrides: [], errors: [],
    basePrice: 29000, ...over,
  } as ProductRecord;
}

describe('ProductImportPricingBuilder', () => {
  const builder = new ProductImportPricingBuilder();

  it('기본가만 있으면 all_variants override 규칙 1개', () => {
    const dto = builder.build(rec(), new Map());
    expect(dto.basePriceRules).toEqual([
      { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 29000 },
    ]);
    expect(dto.membershipPriceRules).toEqual([]);
    expect(dto.tieredPriceRules).toEqual([]);
  });

  it('멤버십가가 있으면 membership_price all_variants override 를 낸다', () => {
    const dto = builder.build(rec({ membershipPrice: 26000 }), new Map());
    expect(dto.membershipPriceRules).toEqual([
      { layer: 'membership_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 26000 },
    ]);
  });

  it('override 는 variants scope 규칙으로 order 2 부터 붙는다', () => {
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    const dto = builder.build(
      rec({
        variantOverrides: [
          { rowNumber: 1, comboKey: key, basePriceRaw: '31000', membershipPriceRaw: '', basePrice: 31000 },
        ],
      }),
      new Map([[key, 'var-1']]),
    );
    expect(dto.basePriceRules).toHaveLength(2);
    expect(dto.basePriceRules[1]).toEqual({
      layer: 'base_price', order: 2, scopeType: 'variants', scopeTargetIds: ['var-1'],
      operationType: 'override', operationValue: 31000,
    });
  });

  it('comboMap 에 없는 조합은 예외다 — 조용히 버리지 않는다', () => {
    const key = comboKey([{ name: '색상', value: '검정' }]);
    expect(() =>
      builder.build(
        rec({ variantOverrides: [{ rowNumber: 3, comboKey: key, basePriceRaw: '1', membershipPriceRaw: '', basePrice: 1 }] }),
        new Map(),
      ),
    ).toThrow(/조합/);
  });

  it('가격을 안 적은 override 는 규칙을 만들지 않는다 (variantCode 만 지정한 행)', () => {
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    const dto = builder.build(
      rec({ variantOverrides: [{ rowNumber: 1, comboKey: key, basePriceRaw: '', membershipPriceRaw: '', variantCode: 'X' }] }),
      new Map([[key, 'var-1']]),
    );
    expect(dto.basePriceRules).toHaveLength(1);
  });
});
