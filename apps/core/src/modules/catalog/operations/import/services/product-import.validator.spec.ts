import { ProductImportValidator } from './product-import.validator';
import { ProductImportNormalizer } from './product-import.normalizer';
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
    variantOverrides: [],
    errors: [],
  };
}

describe('ProductImportValidator', () => {
  const validator = new ProductImportValidator();

  it('유효 행은 version 스칼라를 채우고 에러가 없다', () => {
    const [rec] = validator.validate([
      record({
        productKey: 'P1',
        name: '니트',
        basePrice: '29000',
        marketPrice: '19000',
        productType: 'regular_sale',
        isOverseas: 'Y',
      }),
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

  it('sortOrder 중복은 에러', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: 'x' }, [
        { displayName: '사이즈', values: [{ displayName: 'S' }], sortOrder: 1 },
        { displayName: '색상', values: [{ displayName: '빨강' }], sortOrder: 1 },
      ]),
    ]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /sortOrder 중복/.test(e.message))).toBe(true);
  });

  it('명시 sortOrder(1) 와 공란 행의 fallback(등장 순서 1) 이 충돌해도 잡아낸다', () => {
    // 실제 엑셀에서 재현 가능한 패턴: 한 행만 sortOrder 를 명시(1)하고, 나머지는 비워둔다.
    // fallback 은 "비어있는 행끼리의 등장 순서"라 1부터 다시 시작하므로 명시값 1 과 충돌한다.
    const normalizer = new ProductImportNormalizer();
    const [normalized] = normalizer.normalize(
      {
        products: [{ rowNumber: 1, cells: { productKey: 'P1', name: 'x' } }],
        options: [
          { rowNumber: 1, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S', sortOrder: '1' } },
          { rowNumber: 2, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강', sortOrder: '' } },
        ],
        variants: [],
      },
      [],
    );
    expect(normalized.options.map((o) => o.sortOrder)).toEqual([1, 1]); // 충돌 재현(normalizer 는 검증하지 않음)

    const [rec] = validator.validate([normalized]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /sortOrder 중복/.test(e.message))).toBe(true);
  });

  it('variant 조합이 상한(100)을 넘으면 에러', () => {
    const many = { displayName: '색상', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `c${i}` })) };
    const many2 = { displayName: '사이즈', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `s${i}` })) };
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x' }, [many, many2])]);
    expect(rec.errors.some((e) => /조합/.test(e.message))).toBe(true);
  });

  it('빈 name 도 기본값(productType=regular_sale, minQuantity=1)은 채운다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '29000' })]);
    expect(rec.version).toMatchObject({
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
      ageRestriction: 0,
      minQuantity: 1,
    });
  });

  it('basePrice 누락은 오류다 — 0원 게시 차단', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
  });

  it('basePrice 0 은 오류다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '0' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
  });

  it('유효한 basePrice/membershipPrice 는 숫자로 채워진다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000' }),
    ]);
    expect(rec.errors).toEqual([]);
    expect(rec.basePrice).toBe(29000);
    expect(rec.membershipPrice).toBe(26000);
  });

  it('membershipPrice 가 basePrice 보다 크면 오류다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '31000' }),
    ]);
    expect(rec.errors.some((e) => /membershipPrice/.test(e.message))).toBe(true);
  });

  it('variant override 가격도 검증하고 숫자로 채운다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        combination: [{ name: '색상', value: '빨강' }],
        basePriceRaw: '31000',
        membershipPriceRaw: '',
      },
      {
        rowNumber: 2,
        comboKey: '색상=파랑',
        combination: [{ name: '색상', value: '파랑' }],
        basePriceRaw: '-1',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(out.variantOverrides[0].basePrice).toBe(31000);
    expect(out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 2)).toBe(true);
  });

  it('membershipPrice 만 오버라이드한 조합은 상속된 basePrice 와 비교한다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        combination: [{ name: '색상', value: '빨강' }],
        basePriceRaw: '',
        membershipPriceRaw: '31000',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(
      out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 1 && /membershipPrice/.test(e.message)),
    ).toBe(true);
  });

  it('basePrice 만 오버라이드한 조합은 상품의 membershipPrice 를 상속해 비교한다 — 안 그러면 회원이 더 비싸게 산다', () => {
    // 회귀 재현: basePrice=29000/membershipPrice=26000 인 상품에서 한 조합만 basePrice=25000 으로
    // 낮추고 membershipPrice 는 비워둔다. 상속을 안 하면(override.membershipPrice 가 undefined 라
    // base>member 비교 자체가 스킵) 이 조합은 base 25000 인데 상품 레벨 membership 규칙(26000, order1
    // all_variants)이 그대로 적용돼 멤버가 비회원보다 더 비싸게 사는 상품이 검증을 통과해버린다.
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '사이즈=S',
        combination: [{ name: '사이즈', value: 'S' }],
        basePriceRaw: '25000',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(out.variantOverrides[0].basePrice).toBe(25000);
    expect(out.variantOverrides[0].membershipPrice).toBeUndefined();
    expect(
      out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 1 && /membershipPrice/.test(e.message)),
    ).toBe(true);
  });

  it('basePrice 가 정수가 아니면(소수) 오류다 — pricingRulesSetSchema 의 operationValue 는 int 다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '29000.5' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message) && /정수/.test(e.message))).toBe(true);
    expect(rec.basePrice).toBeUndefined();
  });

  it('지수표기라도 정수값(2.9e4=29000)이면 basePrice 로 정상 채워진다 — 정수 가드가 과잉차단하지 않는다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '2.9e4' })]);
    expect(rec.errors).toEqual([]);
    expect(rec.basePrice).toBe(29000);
  });

  it('membershipPrice 가 정수가 아니면(소수) 오류다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000.9' }),
    ]);
    expect(rec.errors.some((e) => /membershipPrice/.test(e.message) && /정수/.test(e.message))).toBe(true);
    expect(rec.membershipPrice).toBeUndefined();
  });

  it('variant override 의 basePrice 가 정수가 아니면(소수) 오류다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        combination: [{ name: '색상', value: '빨강' }],
        basePriceRaw: '31000.5',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(
      out.errors.some(
        (e) => e.sheet === 'Variants' && e.rowNumber === 1 && /basePrice/.test(e.message) && /정수/.test(e.message),
      ),
    ).toBe(true);
    expect(out.variantOverrides[0].basePrice).toBeUndefined();
  });
});
