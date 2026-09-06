import { buildLegacySkuMappings } from './build-legacy-sku-mappings';

const SKU_1 = '11111111-1111-1111-1111-111111111111';
const SKU_2 = '22222222-2222-2222-2222-222222222222';

describe('buildLegacySkuMappings', () => {
  it('fills skuMappings with the same count when every link has a skuId', () => {
    const result = buildLegacySkuMappings([
      { skuId: SKU_1, quantity: 2 },
      { skuId: SKU_2, quantity: 3 },
    ]);

    expect(result).toEqual([
      { skuId: SKU_1, quantity: 2 },
      { skuId: SKU_2, quantity: 3 },
    ]);
  });

  it('returns an empty array when every link only has newSku', () => {
    const result = buildLegacySkuMappings([
      { newSku: { name: 'S / 검정', holderId: 'h1', supplierIds: ['s1'] }, quantity: 1 },
      { newSku: { name: 'M / 검정', holderId: 'h1', supplierIds: ['s1'] }, quantity: 1 },
    ]);

    expect(result).toEqual([]);
  });

  it('keeps only the skuId links when the input is mixed', () => {
    const result = buildLegacySkuMappings([
      { skuId: SKU_1, quantity: 1 },
      { newSku: { name: 'S / 검정', holderId: 'h1', supplierIds: ['s1'] }, quantity: 1 },
      { skuId: SKU_2, quantity: 5 },
    ]);

    expect(result).toEqual([
      { skuId: SKU_1, quantity: 1 },
      { skuId: SKU_2, quantity: 5 },
    ]);
  });

  it('defaults a missing quantity to 1', () => {
    const result = buildLegacySkuMappings([{ skuId: SKU_1 }]);
    expect(result).toEqual([{ skuId: SKU_1, quantity: 1 }]);
  });
});
