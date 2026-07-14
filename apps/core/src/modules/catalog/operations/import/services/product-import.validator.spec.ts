import { ProductImportValidator } from './product-import.validator';
import { ProductRecord } from '../dto/import.types';

function record(raw: Record<string, string>, options: ProductRecord['options'] = []): ProductRecord {
  return {
    rowNumber: 1,
    productKey: raw.productKey ?? 'P1',
    raw,
    version: {},
    categoryIds: [],
    categoryNames: [],
    options,
    errors: [],
  };
}

describe('ProductImportValidator', () => {
  const validator = new ProductImportValidator();

  it('유효 행은 version 스칼라를 채우고 에러가 없다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', marketPrice: '19000', productType: 'regular_sale', isOverseas: 'Y' }),
    ]);
    expect(rec.errors).toEqual([]);
    expect(rec.version).toMatchObject({
      name: '니트',
      marketPrice: 19000,
      productType: 'regular_sale',
      isOverseas: true,
    });
  });

  it('name 누락은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '  ' })]);
    expect(rec.errors.some((e) => /name/.test(e.message))).toBe(true);
  });

  it('음수/NaN 가격은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', marketPrice: '-5' })]);
    expect(rec.errors.some((e) => /marketPrice/.test(e.message))).toBe(true);
  });

  it('정의되지 않은 enum 은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', productType: 'weird' })]);
    expect(rec.errors.some((e) => /productType/.test(e.message))).toBe(true);
  });

  it('maxQuantity < minQuantity 는 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', minQuantity: '5', maxQuantity: '2' })]);
    expect(rec.errors.some((e) => /maxQuantity/.test(e.message))).toBe(true);
  });

  it('옵션값 중복은 에러', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: 'x' }, [
        { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '빨강' }] },
      ]),
    ]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /중복/.test(e.message))).toBe(true);
  });

  it('variant 조합이 상한(100)을 넘으면 에러', () => {
    const many = { displayName: '색상', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `c${i}` })) };
    const many2 = { displayName: '사이즈', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `s${i}` })) };
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x' }, [many, many2])]);
    expect(rec.errors.some((e) => /조합/.test(e.message))).toBe(true);
  });

  it('빈 name 도 기본값(productType=regular_sale, minQuantity=1)은 채운다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트' })]);
    expect(rec.version).toMatchObject({
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
      ageRestriction: 0,
      minQuantity: 1,
    });
  });
});
