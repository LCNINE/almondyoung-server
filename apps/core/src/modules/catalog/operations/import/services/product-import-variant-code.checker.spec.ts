import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import { ProductRecord, NormalizedVariantOverride } from '../dto/import.types';

function override(over: Partial<NormalizedVariantOverride>): NormalizedVariantOverride {
  return { rowNumber: 1, comboKey: '색상=빨강', basePriceRaw: '', membershipPriceRaw: '', ...over };
}

function record(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: {},
    version: {},
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
    ...over,
  };
}

function makeChecker(existing: string[] = []) {
  const reader = { findActiveVariantCodes: jest.fn(async () => new Set(existing)) } as any;
  return { checker: new ProductImportVariantCodeChecker(reader), reader };
}

describe('ProductImportVariantCodeChecker', () => {
  it('같은 코드를 두 행이 요청하면 양쪽 다 오류다', async () => {
    const { checker } = makeChecker();
    const a = record({ rowNumber: 1, productKey: 'P1', variantOverrides: [override({ rowNumber: 1, variantCode: 'SKU-1' })] });
    const b = record({ rowNumber: 2, productKey: 'P2', variantOverrides: [override({ rowNumber: 2, variantCode: 'SKU-1' })] });

    await checker.check([a, b]);

    expect(a.errors.filter((e) => /SKU-1/.test(e.message))).toHaveLength(1);
    expect(b.errors.filter((e) => /SKU-1/.test(e.message))).toHaveLength(1);
    expect(a.errors[0].sheet).toBe('Variants');
  });

  it('같은 상품 안의 중복도 잡는다', async () => {
    const { checker } = makeChecker();
    const a = record({
      variantOverrides: [
        override({ rowNumber: 1, comboKey: '색상=빨강', variantCode: 'SKU-1' }),
        override({ rowNumber: 2, comboKey: '색상=파랑', variantCode: 'SKU-1' }),
      ],
    });

    await checker.check([a]);

    expect(a.errors).toHaveLength(2);
  });

  it('이미 active 상품이 쓰는 코드는 오류다', async () => {
    const { checker, reader } = makeChecker(['SKU-EXISTING']);
    const a = record({ variantOverrides: [override({ variantCode: 'SKU-EXISTING' })] });

    await checker.check([a]);

    expect(reader.findActiveVariantCodes).toHaveBeenCalledWith(['SKU-EXISTING'], undefined);
    expect(a.errors.some((e) => /이미 사용 중/.test(e.message))).toBe(true);
  });

  it('코드가 하나도 없으면 DB 를 조회하지 않는다', async () => {
    const { checker, reader } = makeChecker();

    await checker.check([record()]);

    expect(reader.findActiveVariantCodes).not.toHaveBeenCalled();
  });

  it('충돌이 없으면 오류를 남기지 않는다', async () => {
    const { checker } = makeChecker(['OTHER']);
    const a = record({ variantOverrides: [override({ variantCode: 'SKU-1' })] });

    await checker.check([a]);

    expect(a.errors).toEqual([]);
  });
});
